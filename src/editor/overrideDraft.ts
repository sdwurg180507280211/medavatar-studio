import type {StoryboardOverrides} from '../core/overrides.js';
import type {Scene, SceneType, SubtitleStyle} from '../core/schema.js';

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

export const setSceneType = (
  overrides: StoryboardOverrides,
  sceneId: string,
  type: SceneType | undefined,
): StoryboardOverrides => {
  const next = structuredClone(overrides);
  const existing: SceneOverride = next.scenes[sceneId] ?? {};

  if (type) {
    next.scenes[sceneId] = {...existing, type};
    return next;
  }

  if (existing.type === undefined) return next;
  const sceneOverride: SceneOverride = {...existing};
  delete sceneOverride.type;
  writeSceneOverride(next, sceneId, sceneOverride);
  return next;
};

export const setSceneSlide = (
  overrides: StoryboardOverrides,
  sceneId: string,
  slide: number | undefined,
): StoryboardOverrides => {
  if (slide !== undefined && (!Number.isInteger(slide) || slide <= 0)) {
    throw new Error('slide must be a positive integer');
  }

  const next = structuredClone(overrides);
  const existing: SceneOverride = next.scenes[sceneId] ?? {};

  if (slide !== undefined) {
    next.scenes[sceneId] = {...existing, slide};
    return next;
  }

  if (existing.slide === undefined) return next;
  const sceneOverride: SceneOverride = {...existing};
  delete sceneOverride.slide;
  writeSceneOverride(next, sceneId, sceneOverride);
  return next;
};
