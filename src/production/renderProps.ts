import {captionCuesFromAlignment, captionCuesFromSceneDurations, type CaptionCue} from '../core/captions.js';
import {fileExists, projectPaths, readText, writeJson} from '../core/io.js';
import type {StoryboardOverrides} from '../core/overrides.js';
import type {CharacterAlignment} from '../providers/types.js';
import {resolveProjectAssets, stageProjectAssets, type RenderAssets} from './assets.js';
import {loadEffectiveProject, type EffectiveProjectState} from './effectiveProject.js';

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
  const [assets, captions] = await Promise.all([
    stageProjectAssets(projectName, {includeTimedMedia}),
    loadResolvedCaptions(state),
  ]);
  await writeJson(paths.scene, state.effective);
  await writeJson(paths.props, {project: state.effective, assets, captions});
  return {paths, state, assets, captions};
};
