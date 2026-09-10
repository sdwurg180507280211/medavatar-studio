import {captionCuesFromAlignment, captionCuesFromSceneDurations, type CaptionCue} from '../core/captions.js';
import {fileExists, projectPaths, readText, writeJson} from '../core/io.js';
import type {MedAvatarProject} from '../core/schema.js';
import type {StoryboardOverrides} from '../core/overrides.js';
import type {CharacterAlignment} from '../providers/types.js';
import {resolveProjectAssets, stageProjectAssets, type RenderAssets} from './assets.js';
import {loadEffectiveProject, type EffectiveProjectState} from './effectiveProject.js';
import {loadPortraitPrototypeVisuals, type PortraitPrototypeVisuals} from './portraitPrototype.js';

export type RenderProps = {
  project: MedAvatarProject;
  assets: RenderAssets;
  captions: CaptionCue[];
  prototypeVisuals?: PortraitPrototypeVisuals;
};

export type EditorProjectPayload = EffectiveProjectState & {
  assets: RenderAssets;
  captions: CaptionCue[];
};

export type PreviewPropsOptions = {
  overrides?: StoryboardOverrides;
};

const loadResolvedCaptions = async (state: EffectiveProjectState) => {
  const paths = projectPaths(state.projectName);
  const fullText = state.effective.scenes.map((scene) => scene.text).join('\n');
  if (state.timeline.source === 'actual' && await fileExists(paths.alignment)) {
    try {
      const alignment = JSON.parse(await readText(paths.alignment)) as CharacterAlignment;
      return captionCuesFromAlignment(state.effective.scenes, fullText, alignment);
    } catch {
      // Fall back to duration-based captions when alignment is unavailable/corrupt.
    }
  }
  return captionCuesFromSceneDurations(state.effective.scenes);
};

export const loadPreviewProps = async (
  projectName: string,
  options: PreviewPropsOptions = {},
): Promise<EditorProjectPayload> => {
  const state = await loadEffectiveProject(projectName, options);
  const includeTimedMedia = state.timeline.source === 'actual';
  const [assets, captions] = await Promise.all([
    resolveProjectAssets(projectName, {includeTimedMedia}),
    loadResolvedCaptions(state),
  ]);
  return {...state, assets, captions};
};

export const prepareRenderProps = async (projectName: string) => {
  const state = await loadEffectiveProject(projectName);
  const paths = projectPaths(projectName);
  const includeTimedMedia = state.timeline.source === 'actual';
  const [assets, captions, prototypeVisuals] = await Promise.all([
    stageProjectAssets(projectName, {includeTimedMedia}),
    loadResolvedCaptions(state),
    loadPortraitPrototypeVisuals(projectName),
  ]);
  if (prototypeVisuals) {
    if (state.effective.video.height <= state.effective.video.width) {
      throw new Error('portrait prototype visuals require a portrait composition');
    }
    const sceneIds = new Set(state.effective.scenes.map((scene) => scene.id));
    const orphanIds = Object.keys(prototypeVisuals.scenes).filter((sceneId) => !sceneIds.has(sceneId));
    if (orphanIds.length > 0) {
      throw new Error(`portrait prototype visuals reference unknown scene ids: ${orphanIds.join(', ')}`);
    }
  }
  const renderProps: RenderProps = {
    project: state.effective,
    assets,
    captions,
    ...(prototypeVisuals ? {prototypeVisuals} : {}),
  };
  await writeJson(paths.scene, state.effective);
  await writeJson(paths.props, renderProps);
  return {paths, state, assets, captions, prototypeVisuals, renderProps};
};
