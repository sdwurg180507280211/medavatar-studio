import {secondsToDurationFrames} from './frameMath.js';
import {z} from 'zod';

export const avatarLayoutSchema = z.enum([
  'hero',
  'fullscreen',
  'bottom-right',
  'bottom-left',
  'hidden',
]);

export const sceneTypeSchema = z.enum([
  'doctor_full',
  'doctor_ppt',
  'medical_animation',
  'visual_full',
]);

export const subtitleModeSchema = z.enum(['off', 'sentence', 'karaoke']);
export const subtitleStyleSchema = z.enum(['medical', 'minimal', 'social']);
export const sceneIdSchema = z.string().regex(
  /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
  'scene id must contain only letters, numbers, underscores and hyphens',
);

export const statisticPresentationSchema = z.enum(['number', 'percent', 'range', 'trend']);
export const comparisonRelationSchema = z.enum(['vs', 'before-after', 'normal-abnormal', 'low-high']);

export const sceneVisualSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('none')}).strict(),
  z.object({
    type: z.literal('emphasis'),
    headline: z.string().min(1),
    highlight: z.string().min(1),
    support: z.string().min(1).optional(),
  }).strict(),
  z.object({
    type: z.literal('statistic'),
    value: z.string().min(1),
    label: z.string().min(1).optional(),
    context: z.string().min(1).optional(),
    presentation: statisticPresentationSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal('comparison'),
    left: z.object({
      label: z.string().min(1),
      value: z.string().min(1).optional(),
      context: z.string().min(1).optional(),
    }).strict(),
    right: z.object({
      label: z.string().min(1),
      value: z.string().min(1).optional(),
      context: z.string().min(1).optional(),
    }).strict(),
    relation: comparisonRelationSchema.optional(),
  }).strict(),
]);

export const compositionItemIdSchema = z.string().regex(
  /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
  'composition item id must contain only letters, numbers, underscores and hyphens',
);

export const compositionRectSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
}).strict();

const compositionRangeShape = {
  id: compositionItemIdSchema,
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
  rect: compositionRectSchema,
  zIndex: z.number().int().min(0).max(999).optional(),
};

export const presenterSegmentSchema = z.object({
  ...compositionRangeShape,
  mask: z.enum(['none', 'circle']).optional(),
}).strict();

export const visualSegmentSchema = z.object({
  ...compositionRangeShape,
  playbackOffsetFrame: z.number().int().nonnegative().default(0),
}).strict();

export const textOverlaySchema = z.object({
  ...compositionRangeShape,
  type: z.literal('text'),
  text: z.string().min(1),
  style: z.object({
    fontSize: z.number().positive().max(240).optional(),
    color: z.string().min(1).optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    weight: z.number().int().min(100).max(950).optional(),
  }).strict().optional(),
}).strict();

export const animationOverlaySchema = z.object({
  ...compositionRangeShape,
  type: z.literal('animation'),
  name: z.string().min(1),
  playbackOffsetFrame: z.number().int().nonnegative().default(0),
}).strict();

export const compositionOverlaySchema = z.discriminatedUnion('type', [
  textOverlaySchema,
  animationOverlaySchema,
]);

export const compositionBasisSchema = z.object({
  fps: z.number().int().positive(),
  sceneDurationInFrames: z.number().int().positive(),
  videoWidth: z.number().int().positive(),
  videoHeight: z.number().int().positive(),
  narrationFingerprint: z.string().min(1).optional(),
}).strict();

export const sceneCompositionSchema = z.object({
  basis: compositionBasisSchema.optional(),
  presenter: z.array(presenterSegmentSchema).optional(),
  visual: z.array(visualSegmentSchema).optional(),
  overlays: z.array(compositionOverlaySchema).optional(),
}).strict().refine(
  (value) => value.presenter !== undefined || value.visual !== undefined || value.overlays !== undefined,
  'composition must define at least one track',
);

export const sceneSchema = z.object({
  id: sceneIdSchema,
  type: sceneTypeSchema,
  title: z.string().min(1).optional(),
  text: z.string().min(1),
  durationInSeconds: z.number().positive(),
  slide: z.number().int().positive().optional(),
  avatar: z.object({
    layout: avatarLayoutSchema,
    scale: z.number().positive().max(1).default(0.3),
  }).optional(),
  visual: sceneVisualSchema.optional(),
  composition: sceneCompositionSchema.optional(),
  subtitle: z.object({
    mode: subtitleModeSchema.default('karaoke'),
    style: subtitleStyleSchema.default('medical'),
    keywords: z.array(z.string()).default([]),
  }).optional(),
  animation: z.object({
    name: z.string(),
    keywords: z.array(z.string()).default([]),
  }).optional(),
});

const rangeOverlaps = (
  items: readonly {startFrame: number; endFrame: number}[],
) => {
  const sorted = [...items].sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index]!.startFrame < sorted[index - 1]!.endFrame) return true;
  }
  return false;
};

export const projectSchema = z.object({
  version: z.literal('1.0'),
  title: z.string(),
  video: z.object({
    width: z.number().int().positive().default(1080),
    height: z.number().int().positive().default(1920),
    fps: z.number().int().positive().default(25),
  }),
  scenes: z.array(sceneSchema).min(1),
}).superRefine((project, ctx) => {
  project.scenes.forEach((scene, sceneIndex) => {
    const composition = scene.composition;
    if (!composition) return;
    const durationInFrames = secondsToDurationFrames(scene.durationInSeconds, project.video.fps);
    const allItems = [
      ...(composition.presenter ?? []),
      ...(composition.visual ?? []),
      ...(composition.overlays ?? []),
    ];
    const ids = new Set<string>();
    for (const item of allItems) {
      if (ids.has(item.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['scenes', sceneIndex, 'composition'],
          message: `duplicate composition item id: ${item.id}`,
        });
      }
      ids.add(item.id);
      if (item.endFrame <= item.startFrame) {
        ctx.addIssue({
          code: 'custom',
          path: ['scenes', sceneIndex, 'composition'],
          message: `${item.id} must use a non-empty [startFrame,endFrame) range`,
        });
      }
      const basisCurrent = composition.basis
        && composition.basis.fps === project.video.fps
        && composition.basis.sceneDurationInFrames === durationInFrames
        && composition.basis.videoWidth === project.video.width
        && composition.basis.videoHeight === project.video.height;
      if (basisCurrent && item.endFrame > durationInFrames) {
        ctx.addIssue({
          code: 'custom',
          path: ['scenes', sceneIndex, 'composition'],
          message: `${item.id} must stay inside 0..${durationInFrames} for the current composition basis`,
        });
      }
      if (basisCurrent && (item.rect.x + item.rect.width > project.video.width || item.rect.y + item.rect.height > project.video.height)) {
        ctx.addIssue({
          code: 'custom',
          path: ['scenes', sceneIndex, 'composition'],
          message: `${item.id} rect must stay inside ${project.video.width}x${project.video.height} for the current composition basis`,
        });
      }
    }
    if (composition.presenter && rangeOverlaps(composition.presenter)) {
      ctx.addIssue({
        code: 'custom',
        path: ['scenes', sceneIndex, 'composition', 'presenter'],
        message: 'presenter segments must not overlap',
      });
    }
    if (composition.visual && rangeOverlaps(composition.visual)) {
      ctx.addIssue({
        code: 'custom',
        path: ['scenes', sceneIndex, 'composition', 'visual'],
        message: 'visual segments must not overlap',
      });
    }
  });
});

export type Scene = z.infer<typeof sceneSchema>;
export type MedAvatarProject = z.infer<typeof projectSchema>;
export type SceneType = z.infer<typeof sceneTypeSchema>;
export type SceneVisual = z.infer<typeof sceneVisualSchema>;
export type StatisticPresentation = z.infer<typeof statisticPresentationSchema>;
export type ComparisonRelation = z.infer<typeof comparisonRelationSchema>;
export type AvatarLayout = z.infer<typeof avatarLayoutSchema>;
export type SubtitleMode = z.infer<typeof subtitleModeSchema>;
export type SubtitleStyle = z.infer<typeof subtitleStyleSchema>;
export type CompositionRect = z.infer<typeof compositionRectSchema>;
export type CompositionBasis = z.infer<typeof compositionBasisSchema>;
export type PresenterSegment = z.infer<typeof presenterSegmentSchema>;
export type VisualSegment = z.infer<typeof visualSegmentSchema>;
export type TextOverlay = z.infer<typeof textOverlaySchema>;
export type AnimationOverlay = z.infer<typeof animationOverlaySchema>;
export type CompositionOverlay = z.infer<typeof compositionOverlaySchema>;
export type SceneComposition = z.infer<typeof sceneCompositionSchema>;
