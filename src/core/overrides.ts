import {z} from 'zod';
import {
  avatarLayoutSchema,
  projectSchema,
  sceneIdSchema,
  sceneTypeSchema,
  sceneVisualSchema,
  subtitleModeSchema,
  subtitleStyleSchema,
  type MedAvatarProject,
} from './schema.js';

const sceneOverrideSchema = z.object({
  type: sceneTypeSchema.optional(),
  title: z.union([z.string().min(1), z.null()]).optional(),
  slide: z.union([z.number().int().positive(), z.null()]).optional(),
  avatar: z.object({
    layout: avatarLayoutSchema.optional(),
    scale: z.number().positive().max(1).optional(),
  }).strict().optional(),
  visual: sceneVisualSchema.optional(),
  subtitle: z.object({
    mode: subtitleModeSchema.optional(),
    style: subtitleStyleSchema.optional(),
    keywords: z.array(z.string()).optional(),
  }).strict().optional(),
  animation: z.union([
    z.object({
      name: z.string().min(1).optional(),
      keywords: z.array(z.string()).optional(),
    }).strict(),
    z.null(),
  ]).optional(),
}).strict();

export const storyboardOverridesSchema = z.object({
  version: z.literal('1.0'),
  scenes: z.record(sceneIdSchema, sceneOverrideSchema).default({}),
}).strict();

export type StoryboardOverrides = z.infer<typeof storyboardOverridesSchema>;

export const applyStoryboardOverrides = (
  project: MedAvatarProject,
  overrides: StoryboardOverrides,
) => {
  const knownSceneIds = new Set(project.scenes.map((scene) => scene.id));
  const orphanSceneIds = Object.keys(overrides.scenes).filter((id) => !knownSceneIds.has(id));

  const scenes = project.scenes.map((scene) => {
    const override = overrides.scenes[scene.id];
    if (!override) return scene;

    const avatar = override.avatar
      ? {
          layout: override.avatar.layout ?? scene.avatar?.layout ?? 'hero',
          scale: override.avatar.scale ?? scene.avatar?.scale ?? 0.3,
        }
      : scene.avatar;

    const subtitle = override.subtitle
      ? {
          mode: override.subtitle.mode ?? scene.subtitle?.mode ?? 'karaoke',
          style: override.subtitle.style ?? scene.subtitle?.style ?? 'medical',
          keywords: override.subtitle.keywords ?? scene.subtitle?.keywords ?? [],
        }
      : scene.subtitle;

    let animation = scene.animation;
    if (override.animation === null) {
      animation = undefined;
    } else if (override.animation) {
      animation = {
        name: override.animation.name ?? scene.animation?.name ?? 'artery-pressure',
        keywords: override.animation.keywords ?? scene.animation?.keywords ?? [],
      };
    }

    return {
      ...scene,
      type: override.type ?? scene.type,
      title: override.title === null ? undefined : override.title ?? scene.title,
      slide: override.slide === null ? undefined : override.slide ?? scene.slide,
      avatar,
      visual: override.visual ?? scene.visual,
      subtitle,
      animation,
    };
  });

  return {
    project: projectSchema.parse({...project, scenes}),
    orphanSceneIds,
  };
};
