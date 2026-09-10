import type {StoryboardOverrides} from '../core/overrides.js';
import type {Scene, SubtitleStyle} from '../core/schema.js';

type SceneOverride = NonNullable<StoryboardOverrides['scenes'][string]>;
type AvatarLayout = NonNullable<Scene['avatar']>['layout'];

const writeSceneOverride = (
  next: StoryboardOverrides,
  sceneId: string,
  sceneOverride: SceneOverride,
) => {
  if (Object.keys(sceneOverride).length === 0) delete next.scenes[sceneId];
  else next.scenes[sceneId] = sceneOverride;
};

export const setSceneSubtitleStyle = (
  overrides: StoryboardOverrides,
  sceneId: string,
  style: SubtitleStyle | undefined,
): StoryboardOverrides => {
  const next = structuredClone(overrides);
  const existing: SceneOverride = next.scenes[sceneId] ?? {};

  if (style) {
    next.scenes[sceneId] = {
      ...existing,
      subtitle: {...existing.subtitle, style},
    };
    return next;
  }

  if (!existing.subtitle?.style) return next;
  const subtitle = {...existing.subtitle};
  delete subtitle.style;
  const sceneOverride: SceneOverride = {...existing};
  if (Object.keys(subtitle).length === 0) delete sceneOverride.subtitle;
  else sceneOverride.subtitle = subtitle;
  writeSceneOverride(next, sceneId, sceneOverride);
  return next;
};

export const setSceneAvatarLayout = (
  overrides: StoryboardOverrides,
  sceneId: string,
  layout: AvatarLayout | undefined,
): StoryboardOverrides => {
  const next = structuredClone(overrides);
  const existing: SceneOverride = next.scenes[sceneId] ?? {};

  if (layout) {
    next.scenes[sceneId] = {
      ...existing,
      avatar: {...existing.avatar, layout},
    };
    return next;
  }

  if (!existing.avatar?.layout) return next;
  const avatar = {...existing.avatar};
  delete avatar.layout;
  const sceneOverride: SceneOverride = {...existing};
  if (Object.keys(avatar).length === 0) delete sceneOverride.avatar;
  else sceneOverride.avatar = avatar;
  writeSceneOverride(next, sceneId, sceneOverride);
  return next;
};

export const setSceneAvatarScale = (
  overrides: StoryboardOverrides,
  sceneId: string,
  scale: number | undefined,
): StoryboardOverrides => {
  if (scale !== undefined && (!Number.isFinite(scale) || scale <= 0 || scale > 1)) {
    throw new Error('avatar scale must be greater than 0 and no more than 1');
  }

  const next = structuredClone(overrides);
  const existing: SceneOverride = next.scenes[sceneId] ?? {};

  if (scale !== undefined) {
    next.scenes[sceneId] = {
      ...existing,
      avatar: {...existing.avatar, scale},
    };
    return next;
  }

  if (existing.avatar?.scale === undefined) return next;
  const avatar = {...existing.avatar};
  delete avatar.scale;
  const sceneOverride: SceneOverride = {...existing};
  if (Object.keys(avatar).length === 0) delete sceneOverride.avatar;
  else sceneOverride.avatar = avatar;
  writeSceneOverride(next, sceneId, sceneOverride);
  return next;
};
