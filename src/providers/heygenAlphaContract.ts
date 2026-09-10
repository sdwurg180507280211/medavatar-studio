import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  HeyGenAvatarProvider,
  HeyGenMediaToolError,
  HeyGenTransparencyError,
  assertHeyGenAlphaInspectionAvailable,
  inspectTransparentWebm,
} from './heygen.js';

const run = (command: string, args: string[]) => new Promise<void>((resolve, reject) => {
  const child = spawn(command, args, {stdio: ['ignore', 'ignore', 'pipe']});
  const stderr: Buffer[] = [];
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  child.once('error', reject);
  child.once('close', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`${command} exited with ${code}: ${Buffer.concat(stderr).toString('utf8').trim()}`));
  });
});

const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200,
  headers: {'content-type': 'application/json'},
});

const withMockHeyGen = async (video: Buffer, callback: () => Promise<void>) => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith('/v3/assets') && init?.method === 'POST') {
      return jsonResponse({data: {asset_id: 'asset-test'}});
    }
    if (url.endsWith('/v3/videos') && init?.method === 'POST') {
      return jsonResponse({data: {video_id: 'video-test', output_format: 'webm'}});
    }
    if (url.endsWith('/v3/videos/video-test')) {
      return jsonResponse({
        data: {
          id: 'video-test',
          status: 'completed',
          video_url: 'https://download.test/avatar.webm',
          output_format: 'webm',
        },
      });
    }
    if (url === 'https://download.test/avatar.webm') {
      return new Response(video, {status: 200, headers: {'content-type': 'video/webm'}});
    }
    throw new Error(`Unexpected fetch in HeyGen Alpha contract: ${url}`);
  }) as typeof fetch;
  try {
    await callback();
  } finally {
    globalThis.fetch = previousFetch;
  }
  return calls;
};

const main = async () => {
  await assertHeyGenAlphaInspectionAvailable();
  const root = await mkdtemp(path.join(tmpdir(), 'medavatar-heygen-alpha-'));
  const transparent = path.join(root, 'transparent.webm');
  const opaque = path.join(root, 'opaque.webm');
  const audio = path.join(root, 'audio.wav');
  const output = path.join(root, 'avatar.webm');
  try {
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi',
      '-i', 'color=c=black@0.0:s=64x64:d=0.24,format=yuva420p',
      '-c:v', 'libvpx-vp9',
      '-auto-alt-ref', '0',
      '-pix_fmt', 'yuva420p',
      transparent,
    ]);
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi',
      '-i', 'color=c=red:s=64x64:d=0.24',
      '-c:v', 'libvpx-vp9',
      opaque,
    ]);
    await writeFile(audio, Buffer.alloc(32, 1));

    const alpha = await inspectTransparentWebm(transparent);
    if (alpha.sampledPixels <= 0 || alpha.transparentPixels + alpha.semiTransparentPixels <= 0) {
      throw new Error('transparent fixture did not expose decoded Alpha pixels');
    }

    let rejectedOpaque = false;
    try {
      await inspectTransparentWebm(opaque);
    } catch (error) {
      rejectedOpaque = error instanceof HeyGenTransparencyError;
    }
    if (!rejectedOpaque) throw new Error('opaque WebM must be rejected as a transparency error');

    await writeFile(output, 'last-known-good-avatar');
    const provider = new HeyGenAvatarProvider('test-key', 'test-avatar', {pollIntervalMs: 1});
    let rejectedGeneratedOpaque = false;
    await withMockHeyGen(await readFile(opaque), async () => {
      try {
        await provider.render({audioPath: audio, outputPath: output, title: 'contract'});
      } catch (error) {
        rejectedGeneratedOpaque = error instanceof HeyGenTransparencyError;
      }
    });
    if (!rejectedGeneratedOpaque) throw new Error('opaque generated WebM must be rejected');
    if ((await readFile(output, 'utf8')) !== 'last-known-good-avatar') {
      throw new Error('failed generated WebM must not replace the previous avatar');
    }

    const previousFfmpeg = process.env.FFMPEG_BIN;
    let fetchCalls = 0;
    process.env.FFMPEG_BIN = path.join(root, 'missing-ffmpeg');
    try {
      let rejectedMissingTool = false;
      const previousFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        throw new Error('network must not be called when Alpha tooling is unavailable');
      }) as typeof fetch;
      try {
        await provider.render({audioPath: audio, outputPath: output, title: 'contract'});
      } catch (error) {
        rejectedMissingTool = error instanceof HeyGenMediaToolError;
      } finally {
        globalThis.fetch = previousFetch;
      }
      if (!rejectedMissingTool) throw new Error('missing ffmpeg must be reported as a media-tool error');
      if (fetchCalls !== 0) throw new Error('missing media tooling must fail before any HeyGen network call');
    } finally {
      if (previousFfmpeg === undefined) delete process.env.FFMPEG_BIN;
      else process.env.FFMPEG_BIN = previousFfmpeg;
    }

    console.log('✓ HeyGen Alpha contract: transparent accepted, opaque rejected, old asset preserved, tooling fails before network');
  } finally {
    await rm(root, {recursive: true, force: true});
  }
};

await main();
