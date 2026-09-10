import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {AvatarProvider, AvatarRenderResult} from './types.js';

export const HEYGEN_AVATAR_ASPECT_RATIO = '9:16' as const;
export const HEYGEN_OUTPUT_FORMAT = 'webm' as const;

export class HeyGenMediaToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeyGenMediaToolError';
  }
}

export class HeyGenTransparencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeyGenTransparencyError';
  }
}

const validateOutputFormat = (value: unknown, source: string) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${source} returned an invalid output_format.`);
  }
  if (value.toLowerCase() !== HEYGEN_OUTPUT_FORMAT) {
    throw new Error(`${source} returned output_format=${value}; expected ${HEYGEN_OUTPUT_FORMAT}.`);
  }
  return value;
};

type CommandResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: Buffer;
};

const captureCommand = (command: string, args: string[]): Promise<Buffer> => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  child.once('error', (error) => reject(new Error(`Could not run ${command}: ${error.message}`)));
  child.once('close', (code, signal) => {
    if (code === 0) {
      resolve(Buffer.concat(stdout));
      return;
    }
    const result: CommandResult = {code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr)};
    const detail = result.stderr.toString('utf8').trim();
    reject(new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}${detail ? `: ${detail}` : ''}`));
  });
});

export type HeyGenAlphaInspectionOptions = {
  ffprobeBin?: string;
  ffmpegBin?: string;
};

const mediaBins = (options: HeyGenAlphaInspectionOptions = {}) => ({
  ffprobeBin: options.ffprobeBin ?? process.env.FFPROBE_BIN ?? 'ffprobe',
  ffmpegBin: options.ffmpegBin ?? process.env.FFMPEG_BIN ?? 'ffmpeg',
});

export const assertHeyGenAlphaInspectionAvailable = async (
  options: HeyGenAlphaInspectionOptions = {},
) => {
  const {ffprobeBin, ffmpegBin} = mediaBins(options);
  try {
    await captureCommand(ffprobeBin, ['-version']);
  } catch (error) {
    throw new HeyGenMediaToolError(
      `HeyGen Alpha validation requires ffprobe (${ffprobeBin}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let decoders: Buffer;
  try {
    decoders = await captureCommand(ffmpegBin, ['-hide_banner', '-decoders']);
  } catch (error) {
    throw new HeyGenMediaToolError(
      `HeyGen Alpha validation requires ffmpeg (${ffmpegBin}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!decoders.toString('utf8').includes('libvpx-vp9')) {
    throw new HeyGenMediaToolError(
      `HeyGen Alpha validation requires an ffmpeg build with the libvpx-vp9 decoder (${ffmpegBin}).`,
    );
  }
};

export type HeyGenAlphaInspection = {
  alphaMode?: string;
  transparentPixels: number;
  semiTransparentPixels: number;
  sampledPixels: number;
};

type HeyGenProbe = {
  streams?: Array<{
    tags?: Record<string, string | undefined>;
  }>;
};

export const inspectTransparentWebm = async (
  file: string,
  options: HeyGenAlphaInspectionOptions = {},
): Promise<HeyGenAlphaInspection> => {
  await assertHeyGenAlphaInspectionAvailable(options);
  const {ffprobeBin, ffmpegBin} = mediaBins(options);

  let probeOutput: Buffer;
  try {
    probeOutput = await captureCommand(ffprobeBin, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name:stream_tags=ALPHA_MODE',
      '-of', 'json',
      file,
    ]);
  } catch (error) {
    throw new HeyGenTransparencyError(
      `Could not inspect HeyGen WebM ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let probe: HeyGenProbe;
  try {
    probe = JSON.parse(probeOutput.toString('utf8')) as HeyGenProbe;
  } catch (error) {
    throw new HeyGenTransparencyError(`Could not parse ${ffprobeBin} output for ${file}: ${String(error)}`);
  }
  const tags = probe.streams?.[0]?.tags ?? {};
  const alphaMode = tags.ALPHA_MODE ?? tags.alpha_mode;
  if (!alphaMode || alphaMode === '0') {
    throw new HeyGenTransparencyError(
      `HeyGen returned ${file} without ALPHA_MODE metadata. The selected Avatar may not be matting-enabled.`,
    );
  }

  let alphaBytes: Buffer;
  try {
    alphaBytes = await captureCommand(ffmpegBin, [
      '-hide_banner',
      '-loglevel', 'error',
      '-c:v', 'libvpx-vp9',
      '-i', file,
      '-map', '0:v:0',
      '-frames:v', '5',
      '-vf', 'alphaextract',
      '-pix_fmt', 'gray',
      '-f', 'rawvideo',
      '-',
    ]);
  } catch (error) {
    throw new HeyGenTransparencyError(
      `Could not decode Alpha pixels from ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let transparentPixels = 0;
  let semiTransparentPixels = 0;
  for (const value of alphaBytes) {
    if (value === 0) transparentPixels += 1;
    else if (value < 255) semiTransparentPixels += 1;
  }
  const inspection = {
    alphaMode,
    transparentPixels,
    semiTransparentPixels,
    sampledPixels: alphaBytes.length,
  } satisfies HeyGenAlphaInspection;
  if (alphaBytes.length === 0 || transparentPixels + semiTransparentPixels === 0) {
    throw new HeyGenTransparencyError(
      `HeyGen returned ${file} without decoded transparency `
      + `(ALPHA_MODE=${alphaMode}). The selected Avatar may not be matting-enabled.`,
    );
  }
  return inspection;
};

const fileExists = async (file: string) => stat(file).then(() => true).catch(() => false);

const promoteValidatedFile = async (candidate: string, outputPath: string) => {
  try {
    await rename(candidate, outputPath);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== 'win32' || !code || !['EEXIST', 'EPERM', 'EACCES'].includes(code)) throw error;
  }

  // Windows can reject rename-over-existing. Keep a rollback copy so a failed
  // promotion never destroys the last validated paid asset.
  const backup = `${outputPath}.backup-${randomUUID()}`;
  const hadOutput = await fileExists(outputPath);
  if (hadOutput) await rename(outputPath, backup);
  try {
    await rename(candidate, outputPath);
    if (hadOutput) await rm(backup, {force: true});
  } catch (error) {
    if (hadOutput) {
      await rm(outputPath, {force: true});
      await rename(backup, outputPath).catch(() => undefined);
    }
    throw error;
  }
};

type HeyGenVideo = {
  id: string;
  status: string;
  video_url?: string | null;
  failure_message?: string | null;
  output_format?: unknown;
};

type HeyGenCreateResponse = {
  data?: {
    video_id: string;
    status?: string;
    output_format?: unknown;
  };
};

export class HeyGenAvatarProvider implements AvatarProvider {
  constructor(
    private readonly apiKey: string,
    private readonly avatarId: string,
    private readonly options: {
      resolution?: '720p' | '1080p' | '4k';
      pollIntervalMs?: number;
      timeoutMs?: number;
    } = {},
  ) {}

  private headers(extra?: HeadersInit): HeadersInit {
    return {'x-api-key': this.apiKey, ...extra};
  }

  private async uploadAudio(audioPath: string) {
    const info = await stat(audioPath);
    if (info.size > 32 * 1024 * 1024) {
      throw new Error('HeyGen direct asset upload is limited to 32 MB. Split the chapter or use a large-file upload flow.');
    }
    const bytes = new Uint8Array(await readFile(audioPath));
    const ext = path.extname(audioPath).toLowerCase();
    const mime = ext === '.wav' ? 'audio/wav' : 'audio/mpeg';
    const form = new FormData();
    form.append('file', new Blob([bytes], {type: mime}), path.basename(audioPath));
    const response = await fetch('https://api.heygen.com/v3/assets', {
      method: 'POST',
      headers: this.headers({'Idempotency-Key': randomUUID()}),
      body: form,
    });
    if (!response.ok) {
      throw new Error(`HeyGen asset upload failed: ${response.status} ${await response.text()}`);
    }
    const json = (await response.json()) as {data?: {asset_id?: unknown}};
    if (!json.data || typeof json.data.asset_id !== 'string' || json.data.asset_id.length === 0) {
      throw new Error('HeyGen asset upload response did not include data.asset_id.');
    }
    return json.data.asset_id;
  }

  private async createVideo(audioAssetId: string, title?: string) {
    const response = await fetch('https://api.heygen.com/v3/videos', {
      method: 'POST',
      headers: this.headers({
        'content-type': 'application/json',
        'Idempotency-Key': randomUUID(),
      }),
      body: JSON.stringify({
        type: 'avatar',
        avatar_id: this.avatarId,
        title,
        resolution: this.options.resolution ?? '1080p',
        aspect_ratio: HEYGEN_AVATAR_ASPECT_RATIO,
        output_format: HEYGEN_OUTPUT_FORMAT,
        audio_asset_id: audioAssetId,
      }),
    });
    if (!response.ok) {
      throw new Error(`HeyGen video create failed: ${response.status} ${await response.text()}`);
    }
    const json = (await response.json()) as HeyGenCreateResponse;
    if (!json.data || typeof json.data.video_id !== 'string' || json.data.video_id.length === 0) {
      throw new Error('HeyGen video create response did not include data.video_id.');
    }
    const apiOutputFormat = validateOutputFormat(json.data.output_format, 'HeyGen video create response');
    return {
      videoId: json.data.video_id,
      apiOutputFormat,
    };
  }

  private async getVideo(videoId: string): Promise<HeyGenVideo> {
    const response = await fetch(`https://api.heygen.com/v3/videos/${encodeURIComponent(videoId)}`, {
      headers: this.headers(),
    });
    if (!response.ok) {
      throw new Error(`HeyGen video status failed: ${response.status} ${await response.text()}`);
    }
    const json = (await response.json()) as {data?: HeyGenVideo};
    if (!json.data || typeof json.data.status !== 'string') {
      throw new Error(`HeyGen video status response for ${videoId} did not include data.status.`);
    }
    return json.data;
  }

  private async waitForVideo(videoId: string) {
    const started = Date.now();
    const timeoutMs = this.options.timeoutMs ?? 20 * 60 * 1000;
    const pollIntervalMs = this.options.pollIntervalMs ?? 5000;
    while (Date.now() - started < timeoutMs) {
      const video = await this.getVideo(videoId);
      const status = video.status.toLowerCase();
      if (status === 'completed' && video.video_url) {
        validateOutputFormat(video.output_format, `HeyGen completed video ${videoId}`);
        return video;
      }
      if (status === 'failed') {
        throw new Error(`HeyGen render failed: ${video.failure_message ?? 'unknown error'}`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(`HeyGen render timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
  }

  async render({audioPath, outputPath, title}: {audioPath: string; outputPath: string; title?: string}) {
    // Fail before the first paid/network operation when local validation cannot run.
    await assertHeyGenAlphaInspectionAvailable();

    const assetId = await this.uploadAudio(audioPath);
    const created = await this.createVideo(assetId, title);
    const completed = await this.waitForVideo(created.videoId);
    const response = await fetch(completed.video_url!);
    if (!response.ok) throw new Error(`HeyGen download failed: ${response.status}`);
    await mkdir(path.dirname(outputPath), {recursive: true});

    const candidate = path.join(
      path.dirname(outputPath),
      `.${path.basename(outputPath)}.${randomUUID()}.pending.webm`,
    );
    await rm(candidate, {force: true});
    try {
      await writeFile(candidate, Buffer.from(await response.arrayBuffer()));
      const alpha = await inspectTransparentWebm(candidate);
      await promoteValidatedFile(candidate, outputPath);
      return {
        videoPath: outputPath,
        videoId: created.videoId,
        assetId,
        requestedOutputFormat: HEYGEN_OUTPUT_FORMAT,
        outputFormat: validateOutputFormat(completed.output_format, `HeyGen completed video ${created.videoId}`)
          ?? created.apiOutputFormat
          ?? HEYGEN_OUTPUT_FORMAT,
        transparent: true,
        alphaMode: alpha.alphaMode,
      } satisfies AvatarRenderResult;
    } finally {
      await rm(candidate, {force: true});
    }
  }
}
