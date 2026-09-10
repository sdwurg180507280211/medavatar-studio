import {projectConfigSchema, type ProjectConfig} from '../core/config.js';
import {fileExists, projectPaths, readText} from '../core/io.js';
import {applyStoryboardOverrides, storyboardOverridesSchema, type StoryboardOverrides} from '../core/overrides.js';
import {projectSchema, sceneSchema, type MedAvatarProject, type Scene, type SceneType} from '../core/schema.js';
import {applyTimingsToScenes} from '../core/timing.js';
import type {TimingSegment} from '../providers/types.js';
import {scriptToStoryboard} from '../storyboard.js';

export type TimelineState = {
  source: 'actual' | 'estimated';
  stale: boolean;
};

export type StoryboardProjectState = {
  projectName: string;
  config: ProjectConfig;
  base: MedAvatarProject;
  overrides: StoryboardOverrides;
  effective: MedAvatarProject;
  orphanSceneIds: string[];
};

export type EffectiveProjectState = StoryboardProjectState & {
  timeline: TimelineState;
};

const EMPTY_OVERRIDES: StoryboardOverrides = {version: '1.0', scenes: {}};

const defaultLayoutForType = (type: SceneType) => {
  if (type === 'visual_full') return 'hidden' as const;
  if (type === 'doctor_ppt' || type === 'medical_animation') return 'bottom-right' as const;
  return 'hero' as const;
};

const defaultScaleForLayout = (layout: NonNullable<Scene['avatar']>['layout']) =>
  layout === 'hero' || layout === 'fullscreen' ? 1 : 0.28;

export const resolveScenePresentation = (
  scene: Scene,
  options: {
    typeChanged?: boolean;
    avatarLayoutOverridden?: boolean;
    avatarScaleOverridden?: boolean;
  } = {},
): Scene => {
  const fallbackLayout = defaultLayoutForType(scene.type);
  const layout = options.typeChanged && !options.avatarLayoutOverridden
    ? fallbackLayout
    : scene.avatar?.layout ?? fallbackLayout;
  const scale = options.typeChanged && !options.avatarScaleOverridden
    ? defaultScaleForLayout(layout)
    : scene.avatar?.scale ?? defaultScaleForLayout(layout);

  let animation = scene.animation;
  if (scene.type === 'medical_animation' && !animation) {
    animation = {
      name: 'artery-pressure',
      keywords: scene.subtitle?.keywords ?? [],
    };
  }

  return sceneSchema.parse({
    ...scene,
    avatar: {layout, scale},
    animation,
  });
};

const readOverrides = async (file: string): Promise<StoryboardOverrides> => {
  if (!(await fileExists(file))) return EMPTY_OVERRIDES;
  return storyboardOverridesSchema.parse(JSON.parse(await readText(file)));
};

const parseTimings = (value: unknown): TimingSegment[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const parsed: TimingSegment[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return undefined;
    const candidate = item as Partial<TimingSegment>;
    if (
      typeof candidate.text !== 'string'
      || typeof candidate.start !== 'number'
      || typeof candidate.end !== 'number'
      || !Number.isFinite(candidate.start)
      || !Number.isFinite(candidate.end)
      || candidate.end < candidate.start
    ) return undefined;
    parsed.push({text: candidate.text, start: candidate.start, end: candidate.end});
  }
  return parsed;
};

export const timingsMatchScenes = (scenes: Scene[], timings: TimingSegment[]) =>
  timings.length === scenes.length
  && scenes.every((scene, index) => timings[index]?.text === scene.text);

export const loadBaseProject = async (projectName: string) => {
  const paths = projectPaths(projectName);
  const config = projectConfigSchema.parse(JSON.parse(await readText(paths.config)));
  const script = await readText(paths.script);
  const generated = projectSchema.parse(scriptToStoryboard(config.title, script));
  const base = projectSchema.parse({...generated, video: config.video});
  return {projectName, paths, config, base};
};

export const loadStoryboardProject = async (projectName: string): Promise<StoryboardProjectState> => {
  const {paths, config, base} = await loadBaseProject(projectName);
  const overrides = await readOverrides(paths.overrides);
  const applied = applyStoryboardOverrides(base, overrides);
  const scenes = applied.project.scenes.map((scene, index) => {
    const baseScene = base.scenes[index];
    const override = overrides.scenes[scene.id];
    const typeChanged = Boolean(override?.type && override.type !== baseScene?.type);
    return resolveScenePresentation(scene, {
      typeChanged,
      avatarLayoutOverridden: override?.avatar?.layout !== undefined,
      avatarScaleOverridden: override?.avatar?.scale !== undefined,
    });
  });
  return {
    projectName,
    config,
    base,
    overrides,
    effective: projectSchema.parse({...applied.project, scenes}),
    orphanSceneIds: applied.orphanSceneIds,
  };
};

export const loadEffectiveProject = async (projectName: string): Promise<EffectiveProjectState> => {
  const state = await loadStoryboardProject(projectName);
  const paths = projectPaths(projectName);
  if (!(await fileExists(paths.timing))) {
    return {...state, timeline: {source: 'estimated', stale: false}};
  }

  let timings: TimingSegment[] | undefined;
  try {
    timings = parseTimings(JSON.parse(await readText(paths.timing)));
  } catch {
    timings = undefined;
  }

  if (!timings || !timingsMatchScenes(state.effective.scenes, timings)) {
    return {...state, timeline: {source: 'estimated', stale: true}};
  }

  return {
    ...state,
    effective: projectSchema.parse({
      ...state.effective,
      scenes: applyTimingsToScenes(state.effective.scenes, timings),
    }),
    timeline: {source: 'actual', stale: false},
  };
};
