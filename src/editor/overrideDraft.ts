import type {StoryboardOverrides} from '../core/overrides.js';
import type {SubtitleStyle} from '../core/schema.js';

type SceneOverride = NonNullable<StoryboardOverrides['scenes'][string]>;

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
  if (Object.keys(sceneOverride).length === 0) delete next.scenes[sceneId];
  else next.scenes[sceneId] = sceneOverride;
  return next;
};
