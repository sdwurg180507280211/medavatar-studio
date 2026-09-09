import {z} from 'zod';

export const avatarLayoutSchema = z.enum([
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

export const sceneSchema = z.object({
  id: z.string(),
  type: sceneTypeSchema,
  text: z.string().min(1),
  durationInSeconds: z.number().positive(),
  slide: z.number().int().positive().optional(),
  avatar: z.object({
    layout: avatarLayoutSchema,
    scale: z.number().positive().max(1).default(0.3),
  }).optional(),
  animation: z.object({
    name: z.string(),
    keywords: z.array(z.string()).default([]),
  }).optional(),
});

export const projectSchema = z.object({
  version: z.literal('1.0'),
  title: z.string(),
  video: z.object({
    width: z.number().int().positive().default(1920),
    height: z.number().int().positive().default(1080),
    fps: z.number().int().positive().default(25),
  }),
  scenes: z.array(sceneSchema).min(1),
});

export type Scene = z.infer<typeof sceneSchema>;
export type MedAvatarProject = z.infer<typeof projectSchema>;
export type SceneType = z.infer<typeof sceneTypeSchema>;
