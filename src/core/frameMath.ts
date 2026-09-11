import type {Scene} from './schema.js';

export type SceneFrameInput = Pick<Scene, 'id' | 'durationInSeconds'>;

export type SceneFrameSpan = {
  sceneId: string;
  index: number;
  startFrame: number;
  durationInFrames: number;
  endFrame: number;
};

const assertPositiveFinite = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }
};

export const secondsToDurationFrames = (seconds: number, fps: number) => {
  assertPositiveFinite(seconds, 'seconds');
  assertPositiveFinite(fps, 'fps');
  return Math.max(1, Math.round(seconds * fps));
};

export const buildSceneFrameTimeline = (
  scenes: readonly SceneFrameInput[],
  fps: number,
): SceneFrameSpan[] => {
  assertPositiveFinite(fps, 'fps');
  let startFrame = 0;
  return scenes.map((scene, index) => {
    const durationInFrames = secondsToDurationFrames(scene.durationInSeconds, fps);
    const span: SceneFrameSpan = {
      sceneId: scene.id,
      index,
      startFrame,
      durationInFrames,
      endFrame: startFrame + durationInFrames,
    };
    startFrame = span.endFrame;
    return span;
  });
};

export const getTimelineDurationInFrames = (
  scenes: readonly SceneFrameInput[],
  fps: number,
) => buildSceneFrameTimeline(scenes, fps).at(-1)?.endFrame ?? 0;

export const getProjectDurationInFrames = (project: {
  video: {fps: number};
  scenes: readonly SceneFrameInput[];
}) => Math.max(project.video.fps, getTimelineDurationInFrames(project.scenes, project.video.fps));

export const framesToSeconds = (frames: number, fps: number) => {
  assertPositiveFinite(fps, 'fps');
  return frames / fps;
};
