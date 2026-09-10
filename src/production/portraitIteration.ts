import {spawn} from 'node:child_process';
import path from 'node:path';
import type {MedAvatarProject} from '../core/schema.js';
import {prepareRenderProps} from './renderProps.js';

type PortraitIterationMode = 'still' | 'preview' | 'render';

type FrameRange = {
  sceneId: string;
  start: number;
  end: number;
  duration: number;
};

const ENTRY = 'remotion/index.tsx';
const COMPOSITION = 'MedAvatarVideo';
const PREVIEW_SCALE = 0.5;
const PREVIEW_SECONDS = 8;
const PREVIEW_CONTEXT_SECONDS = 0.5;

const run = (command: string, args: string[]) => new Promise<void>((resolve, reject) => {
  const child = spawn(command, args, {stdio: 'inherit', shell: process.platform === 'win32'});
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  child.on('error', reject);
});

const optionValue = (args: string[], name: string) => {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) {
    const value = inline.slice(name.length + 1);
    if (!value) throw new Error(`${name} requires a value`);
    return value;
  }
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
};

const hasFlag = (args: string[], name: string) => args.includes(name);

const positiveNumber = (value: string | undefined, fallback: number, label: string) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be a positive number`);
  return parsed;
};

const nonNegativeNumber = (value: string | undefined, fallback: number, label: string) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be zero or greater`);
  return parsed;
};

export const sceneFrameRanges = (project: MedAvatarProject): FrameRange[] => {
  let cursor = 0;
  return project.scenes.map((scene) => {
    const duration = Math.max(1, Math.round(scene.durationInSeconds * project.video.fps));
    const range = {sceneId: scene.id, start: cursor, end: cursor + duration - 1, duration};
    cursor += duration;
    return range;
  });
};

export const resolveSceneFrameRange = (project: MedAvatarProject, sceneId: string) => {
  const range = sceneFrameRanges(project).find((candidate) => candidate.sceneId === sceneId);
  if (!range) {
    throw new Error(`Unknown scene id: ${sceneId}. Available: ${project.scenes.map((scene) => scene.id).join(', ')}`);
  }
  return range;
};

export const resolvePreviewFrameRange = (project: MedAvatarProject, sceneId?: string) => {
  const fps = project.video.fps;
  const ranges = sceneFrameRanges(project);
  const selected = sceneId ? resolveSceneFrameRange(project, sceneId) : ranges[0];
  const totalFrames = ranges.at(-1)!.end + 1;
  const context = Math.round(PREVIEW_CONTEXT_SECONDS * fps);
  const maxFrames = Math.max(1, Math.round(PREVIEW_SECONDS * fps));
  const start = Math.max(0, selected.start - context);
  const naturalEnd = Math.min(totalFrames - 1, selected.end + context);
  const end = Math.min(naturalEnd, start + maxFrames - 1);
  return {sceneId: selected.sceneId, start, end, duration: end - start + 1};
};

const validateFrames = (value: string) => {
  if (!/^\d+-\d+$/.test(value)) {
    throw new Error('--frames must be an inclusive range such as 120-319; use portrait:still for a single frame');
  }
  const [rawStart, rawEnd] = value.split('-');
  const start = Number(rawStart);
  const end = Number(rawEnd);
  if (end < start) throw new Error('--frames end must be greater than or equal to start');
  return {start, end, value};
};

const outputDimensions = (project: MedAvatarProject, scale: number) =>
  `${Math.round(project.video.width * scale)}×${Math.round(project.video.height * scale)}`;

const warnTimeline = (source: 'actual' | 'estimated', stale: boolean) => {
  if (stale) console.warn('• timed media is stale; preview/render will omit stale narration/avatar assets');
  else if (source !== 'actual') console.warn('• timed media is missing; preview/render uses estimated scene timing');
};

export const runPortraitIteration = async (
  mode: PortraitIterationMode,
  projectName: string,
  args: string[] = [],
) => {
  const {paths, state, assets} = await prepareRenderProps(projectName);
  const project = state.effective;
  if (project.video.height <= project.video.width) {
    throw new Error(`portrait iteration requires a portrait project, got ${project.video.width}x${project.video.height}`);
  }
  warnTimeline(state.timeline.source, state.timeline.stale);

  const sceneId = optionValue(args, '--scene');
  const output = optionValue(args, '--output');
  const dryRun = hasFlag(args, '--dry-run');
  const timedAssets = [assets.narration ? 'narration' : null, assets.avatar || assets.avatarChapters?.length ? 'avatar' : null]
    .filter(Boolean)
    .join('+') || 'none';

  let remotionArgs: string[];
  let target: string;
  let summary: string;

  if (mode === 'still') {
    const scale = positiveNumber(optionValue(args, '--scale'), PREVIEW_SCALE, '--scale');
    const explicitFrame = optionValue(args, '--frame');
    const atSeconds = optionValue(args, '--at');
    if (explicitFrame !== undefined && sceneId) throw new Error('Use either --frame or --scene, not both');
    if (explicitFrame !== undefined && atSeconds !== undefined) throw new Error('--at can only be used with --scene');

    let frame = 0;
    if (explicitFrame !== undefined) {
      frame = Math.round(nonNegativeNumber(explicitFrame, 0, '--frame'));
    } else {
      const selected = resolveSceneFrameRange(project, sceneId ?? project.scenes[0].id);
      const offset = atSeconds === undefined
        ? Math.floor(selected.duration / 2)
        : Math.round(nonNegativeNumber(atSeconds, 0, '--at') * project.video.fps);
      frame = selected.start + Math.min(selected.duration - 1, offset);
    }

    target = output ?? path.join(paths.output, 'portrait-still.png');
    remotionArgs = [
      'exec', 'remotion', 'still', ENTRY, COMPOSITION, target,
      `--props=${paths.props}`,
      `--frame=${frame}`,
      `--scale=${scale}`,
    ];
    summary = `still frame ${frame}, ${outputDimensions(project, scale)}`;
  } else if (mode === 'preview') {
    const scale = positiveNumber(optionValue(args, '--scale'), PREVIEW_SCALE, '--scale');
    const concurrency = optionValue(args, '--concurrency') ?? '75%';
    const explicitFrames = optionValue(args, '--frames');
    if (explicitFrames && sceneId) throw new Error('Use either --frames or --scene, not both');

    const range = explicitFrames
      ? validateFrames(explicitFrames)
      : resolvePreviewFrameRange(project, sceneId);
    target = output ?? path.join(paths.output, 'portrait-preview.mp4');
    remotionArgs = [
      'exec', 'remotion', 'render', ENTRY, COMPOSITION, target,
      `--props=${paths.props}`,
      '--codec=h264',
      `--scale=${scale}`,
      `--frames=${'value' in range ? range.value : `${range.start}-${range.end}`}`,
      '--x264-preset=superfast',
      `--concurrency=${concurrency}`,
    ];
    summary = `preview frames ${range.start}-${range.end}, ${outputDimensions(project, scale)}, x264 superfast`;
  } else {
    if (sceneId || optionValue(args, '--frames') || optionValue(args, '--frame') || optionValue(args, '--at')) {
      throw new Error('portrait:render always renders the full timeline; use portrait:preview or portrait:still for partial renders');
    }
    const concurrency = optionValue(args, '--concurrency');
    target = output ?? paths.finalVideo;
    remotionArgs = [
      'exec', 'remotion', 'render', ENTRY, COMPOSITION, target,
      `--props=${paths.props}`,
      '--codec=h264',
      ...(concurrency ? [`--concurrency=${concurrency}`] : []),
    ];
    summary = `full render ${project.video.width}×${project.video.height}`;
  }

  console.log(`• visual-only ${mode}: ${summary}`);
  console.log(`• reused timed assets: ${timedAssets}; provider calls: disabled`);
  console.log(`• output -> ${path.relative(process.cwd(), target)}`);
  if (dryRun) {
    console.log(`• dry run -> pnpm ${remotionArgs.join(' ')}`);
    return;
  }
  await run('pnpm', remotionArgs);
};

const mode = process.argv[2] as PortraitIterationMode | undefined;
const projectName = process.argv[3];
if (!mode || !['still', 'preview', 'render'].includes(mode) || !projectName) {
  throw new Error('Usage: tsx src/production/portraitIteration.ts <still|preview|render> <project> [--scene <id>] [--frames <start-end>] [--at <seconds>]');
}
await runPortraitIteration(mode, projectName, process.argv.slice(4));
