import type {StoryboardOverrides} from '../core/overrides.js';
import type {SceneComposition} from '../core/schema.js';

type SceneOverride = NonNullable<StoryboardOverrides['scenes'][string]>;

const writeSceneOverride = (
  next: StoryboardOverrides,
  sceneId: string,
  sceneOverride: SceneOverride,
) => {
  if (Object.keys(sceneOverride).length === 0) delete next.scenes[sceneId];
  else next.scenes[sceneId] = sceneOverride;
};

export const setSceneComposition = (
  overrides: StoryboardOverrides,
  sceneId: string,
  composition: SceneComposition | undefined,
): StoryboardOverrides => {
  const next = structuredClone(overrides);
  const existing: SceneOverride = next.scenes[sceneId] ?? {};
  if (composition) {
    next.scenes[sceneId] = {...existing, composition};
    return next;
  }
  if (existing.composition === undefined) return next;
  const sceneOverride: SceneOverride = {...existing};
  delete sceneOverride.composition;
  writeSceneOverride(next, sceneId, sceneOverride);
  return next;
};
