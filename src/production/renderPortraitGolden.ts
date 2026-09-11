import {spawn} from 'node:child_process';
import path from 'node:path';
import {buildSceneFrameTimeline} from '../core/frameMath.js';
import {ensureDir, writeJson} from '../core/io.js';
import {prepareRenderProps} from './renderProps.js';

const projectName = 'portrait-demo';

const run = (command: string, args: string[]) => new Promise<void>((resolve, reject) => {
  const child = spawn(command, args, {stdio: 'inherit', shell: process.platform === 'win32'});
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  child.on('error', reject);
});

const ensureCiCjkFonts = async () => {
  if (process.env.CI !== 'true' || process.platform !== 'linux') return;
  await run('sudo', ['apt-get', 'update', '-qq']);
  await run('sudo', ['apt-get', 'install', '-y', '--no-install-recommends', 'fonts-noto-cjk']);
};

const main = async () => {
  await ensureCiCjkFonts();
  const {paths, state} = await prepareRenderProps(projectName);
  if (state.effective.video.width !== 1080 || state.effective.video.height !== 1920) {
    throw new Error('portrait-demo must render at 1080x1920');
  }

  const goldenDir = path.join(paths.output, 'golden');
  await ensureDir(goldenDir);

  const timeline = buildSceneFrameTimeline(state.effective.scenes, state.effective.video.fps);
  const frames = timeline.map((span) => {
    const frame = span.startFrame + Math.min(
      span.durationInFrames - 1,
      Math.max(0, Math.round(span.durationInFrames * 0.52)),
    );
    return {
      sceneId: span.sceneId,
      frame,
      file: `${String(span.index + 1).padStart(2, '0')}-${span.sceneId}.png`,
    };
  });

  await writeJson(path.join(goldenDir, 'manifest.json'), {
    projectName,
    width: state.effective.video.width,
    height: state.effective.video.height,
    fps: state.effective.video.fps,
    frames,
  });

  for (const golden of frames) {
    await run('pnpm', [
      'exec',
      'remotion',
      'still',
      'remotion/index.tsx',
      'MedAvatarVideo',
      path.join(goldenDir, golden.file),
      `--props=${paths.props}`,
      `--frame=${golden.frame}`,
    ]);
  }

  console.log(`✓ portrait golden frames -> ${path.relative(process.cwd(), goldenDir)}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
