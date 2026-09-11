import {secondsToDurationFrames} from './frameMath';
import type {
  AnimationOverlay,
  CompositionBasis,
  CompositionOverlay,
  CompositionRect,
  MedAvatarProject,
  PresenterSegment,
  Scene,
  SceneComposition,
  TextOverlay,
  VisualSegment,
} from './schema';

export type CompositionItem = PresenterSegment | VisualSegment | CompositionOverlay;
export type CompositionTrackKind = 'presenter' | 'visual' | 'overlay';
export type CompositionCalibrationStatus = {
  state: 'current' | 'stale' | 'unverified';
  reasons: string[];
};

export const isFrameInRange = (
  frame: number,
  range: {startFrame: number; endFrame: number},
) => frame >= range.startFrame && frame < range.endFrame;

export const findActiveCompositionItem = <T extends {startFrame: number; endFrame: number}>(
  items: readonly T[] | undefined,
  frame: number,
): T | undefined => items?.find((item) => isFrameInRange(frame, item));

export const compositionItemIds = (composition: SceneComposition | undefined) => new Set([
  ...(composition?.presenter ?? []).map((item) => item.id),
  ...(composition?.visual ?? []).map((item) => item.id),
  ...(composition?.overlays ?? []).map((item) => item.id),
]);

export const nextCompositionItemId = (
  composition: SceneComposition | undefined,
  prefix: string,
) => {
  const existing = compositionItemIds(composition);
  for (let index = 1; index < 10000; index += 1) {
    const id = `${prefix}-${String(index).padStart(2, '0')}`;
    if (!existing.has(id)) return id;
  }
  throw new Error(`Unable to allocate composition id for ${prefix}`);
};

const withPlaybackSplit = <T extends VisualSegment | AnimationOverlay>(
  item: T,
  splitFrame: number,
  rightId: string,
): [T, T] => {
  const offset = item.playbackOffsetFrame ?? 0;
  const rightOffset = offset + splitFrame - item.startFrame;
  return [
    {...item, endFrame: splitFrame} as T,
    {...item, id: rightId, startFrame: splitFrame, playbackOffsetFrame: rightOffset} as T,
  ];
};

export const splitCompositionItem = <T extends CompositionItem>(
  item: T,
  splitFrame: number,
  rightId: string,
): [T, T] => {
  if (!Number.isInteger(splitFrame) || splitFrame <= item.startFrame || splitFrame >= item.endFrame) {
    throw new Error('splitFrame must be an integer strictly inside the item range');
  }
  if ('type' in item && item.type === 'animation') {
    return withPlaybackSplit(item, splitFrame, rightId) as [T, T];
  }
  if (!('type' in item) && 'playbackOffsetFrame' in item) {
    return withPlaybackSplit(item, splitFrame, rightId) as [T, T];
  }
  return [
    {...item, endFrame: splitFrame} as T,
    {...item, id: rightId, startFrame: splitFrame} as T,
  ];
};

export const replaceCompositionItem = (
  composition: SceneComposition,
  itemId: string,
  replacement: CompositionItem | CompositionItem[],
): SceneComposition => {
  const replacements = Array.isArray(replacement) ? replacement : [replacement];
  const replace = <T extends CompositionItem>(items: T[] | undefined): T[] | undefined => {
    if (!items?.some((item) => item.id === itemId)) return items;
    return items.flatMap((item) => item.id === itemId ? replacements as T[] : [item]);
  };
  return {
    ...composition,
    presenter: replace(composition.presenter),
    visual: replace(composition.visual),
    overlays: replace(composition.overlays),
  };
};

export const removeCompositionItem = (
  composition: SceneComposition,
  itemId: string,
): SceneComposition => ({
  ...composition,
  presenter: composition.presenter?.filter((item) => item.id !== itemId),
  visual: composition.visual?.filter((item) => item.id !== itemId),
  overlays: composition.overlays?.filter((item) => item.id !== itemId),
});

export const getCompositionItem = (
  composition: SceneComposition | undefined,
  itemId: string | undefined,
): CompositionItem | undefined => {
  if (!composition || !itemId) return undefined;
  return [
    ...(composition.presenter ?? []),
    ...(composition.visual ?? []),
    ...(composition.overlays ?? []),
  ].find((item) => item.id === itemId);
};

export const isTextOverlay = (item: CompositionItem): item is TextOverlay =>
  'type' in item && item.type === 'text';

export const isAnimationOverlay = (item: CompositionItem): item is AnimationOverlay =>
  'type' in item && item.type === 'animation';

export const fingerprintNarration = (text: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export const makeCompositionBasis = (
  scene: Pick<Scene, 'text'>,
  sceneDurationInFrames: number,
  video: {fps: number; width: number; height: number},
): CompositionBasis => ({
  fps: video.fps,
  sceneDurationInFrames,
  videoWidth: video.width,
  videoHeight: video.height,
  narrationFingerprint: fingerprintNarration(scene.text),
});

export const getCompositionCalibrationStatus = (
  scene: Scene,
  video: MedAvatarProject['video'],
): CompositionCalibrationStatus => {
  if (!scene.composition) return {state: 'current', reasons: []};
  const basis = scene.composition.basis;
  if (!basis) return {state: 'unverified', reasons: ['composition has no timing/canvas basis']};
  const durationInFrames = secondsToDurationFrames(scene.durationInSeconds, video.fps);
  const reasons: string[] = [];
  if (basis.fps !== video.fps) reasons.push(`fps ${basis.fps} → ${video.fps}`);
  if (basis.sceneDurationInFrames !== durationInFrames) reasons.push(`duration ${basis.sceneDurationInFrames}f → ${durationInFrames}f`);
  if (basis.videoWidth !== video.width || basis.videoHeight !== video.height) {
    reasons.push(`canvas ${basis.videoWidth}x${basis.videoHeight} → ${video.width}x${video.height}`);
  }
  const fingerprint = fingerprintNarration(scene.text);
  if (!basis.narrationFingerprint) reasons.push('narration fingerprint missing');
  else if (basis.narrationFingerprint !== fingerprint) reasons.push('narration changed');
  return reasons.length ? {state: 'stale', reasons} : {state: 'current', reasons: []};
};

const clampRectToBasis = (rect: CompositionRect, basis: CompositionBasis): CompositionRect => {
  const width = Math.max(1, Math.min(basis.videoWidth, Math.round(rect.width)));
  const height = Math.max(1, Math.min(basis.videoHeight, Math.round(rect.height)));
  return {
    x: Math.max(0, Math.min(basis.videoWidth - width, Math.round(rect.x))),
    y: Math.max(0, Math.min(basis.videoHeight - height, Math.round(rect.y))),
    width,
    height,
  };
};

const scaleRect = (
  rect: CompositionRect,
  from: CompositionBasis,
  to: CompositionBasis,
): CompositionRect => clampRectToBasis({
  x: rect.x * to.videoWidth / from.videoWidth,
  y: rect.y * to.videoHeight / from.videoHeight,
  width: rect.width * to.videoWidth / from.videoWidth,
  height: rect.height * to.videoHeight / from.videoHeight,
}, to);

const calibrateRange = <T extends CompositionItem>(
  item: T,
  from: CompositionBasis,
  to: CompositionBasis,
): T => {
  const timeScale = to.fps / from.fps;
  let startFrame = Math.round(item.startFrame * timeScale);
  let endFrame = Math.round(item.endFrame * timeScale);
  startFrame = Math.max(0, Math.min(to.sceneDurationInFrames - 1, startFrame));
  endFrame = Math.max(startFrame + 1, Math.min(to.sceneDurationInFrames, endFrame));
  const next = {...item, startFrame, endFrame, rect: scaleRect(item.rect, from, to)} as T;
  if ('playbackOffsetFrame' in next) {
    next.playbackOffsetFrame = Math.max(0, Math.round(next.playbackOffsetFrame * timeScale));
  }
  return next;
};

export const calibrateSceneComposition = (
  composition: SceneComposition,
  to: CompositionBasis,
): SceneComposition => {
  const from = composition.basis ?? to;
  return {
    ...composition,
    basis: to,
    presenter: composition.presenter?.map((item) => calibrateRange(item, from, to)),
    visual: composition.visual?.map((item) => calibrateRange(item, from, to)),
    overlays: composition.overlays?.map((item) => calibrateRange(item, from, to)) as CompositionOverlay[] | undefined,
  };
};

export const assertCompositionReady = (project: MedAvatarProject) => {
  const stale = project.scenes.flatMap((scene) => {
    const status = getCompositionCalibrationStatus(scene, project.video);
    return status.state === 'current' ? [] : [`${scene.id}: ${status.reasons.join(', ')}`];
  });
  if (stale.length) {
    throw new Error(`Composition requires calibration before final render: ${stale.join('; ')}`);
  }
};
