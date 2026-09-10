import {randomUUID} from 'node:crypto';
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {AvatarProvider} from './types.js';

export const HEYGEN_AVATAR_ASPECT_RATIO = '9:16' as const;

type HeyGenVideo = {
  id: string;
  status: string;
  video_url?: string | null;
  failure_message?: string | null;
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
    const json = (await response.json()) as {data: {asset_id: string}};
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
        output_format: 'webm',
        audio_asset_id: audioAssetId,
      }),
    });
    if (!response.ok) {
      throw new Error(`HeyGen video create failed: ${response.status} ${await response.text()}`);
    }
    const json = (await response.json()) as {data: {video_id: string}};
    return json.data.video_id;
  }

  private async getVideo(videoId: string): Promise<HeyGenVideo> {
    const response = await fetch(`https://api.heygen.com/v3/videos/${encodeURIComponent(videoId)}`, {
      headers: this.headers(),
    });
    if (!response.ok) {
      throw new Error(`HeyGen video status failed: ${response.status} ${await response.text()}`);
    }
    const json = (await response.json()) as {data: HeyGenVideo};
    return json.data;
  }

  private async waitForVideo(videoId: string) {
    const started = Date.now();
    const timeoutMs = this.options.timeoutMs ?? 20 * 60 * 1000;
    const pollIntervalMs = this.options.pollIntervalMs ?? 5000;
    while (Date.now() - started < timeoutMs) {
      const video = await this.getVideo(videoId);
      if (video.status === 'completed' && video.video_url) return video.video_url;
      if (video.status === 'failed') {
        throw new Error(`HeyGen render failed: ${video.failure_message ?? 'unknown error'}`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(`HeyGen render timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
  }

  async render({audioPath, outputPath, title}: {audioPath: string; outputPath: string; title?: string}) {
    const assetId = await this.uploadAudio(audioPath);
    const videoId = await this.createVideo(assetId, title);
    const videoUrl = await this.waitForVideo(videoId);
    const response = await fetch(videoUrl);
    if (!response.ok) throw new Error(`HeyGen download failed: ${response.status}`);
    await mkdir(path.dirname(outputPath), {recursive: true});
    await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
    return {videoPath: outputPath, videoId, assetId};
  }
}
