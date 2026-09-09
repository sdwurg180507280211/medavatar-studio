import {z} from 'zod';

export const projectConfigSchema = z.object({
  title: z.string().min(1),
  language: z.string().default('zh-CN'),
  video: z.object({
    width: z.number().int().positive().default(1920),
    height: z.number().int().positive().default(1080),
    fps: z.number().int().positive().default(25),
  }).default({width: 1920, height: 1080, fps: 25}),
  voice: z.object({
    provider: z.enum(['mock', 'elevenlabs']).default('mock'),
    modelId: z.string().default('eleven_multilingual_v2'),
    outputFormat: z.string().default('mp3_44100_128'),
  }).default({provider: 'mock', modelId: 'eleven_multilingual_v2', outputFormat: 'mp3_44100_128'}),
  avatar: z.object({
    provider: z.enum(['mock', 'heygen']).default('mock'),
    resolution: z.enum(['720p', '1080p', '4k']).default('1080p'),
    strategy: z.enum(['single', 'chaptered']).default('single'),
    chapterMaxSeconds: z.number().positive().default(90),
    pollIntervalMs: z.number().int().positive().default(5000),
    timeoutMs: z.number().int().positive().default(20 * 60 * 1000),
  }).default({provider: 'mock', resolution: '1080p', strategy: 'single', chapterMaxSeconds: 90, pollIntervalMs: 5000, timeoutMs: 20 * 60 * 1000}),
  ppt: z.object({
    file: z.string().default('slides.pptx'),
  }).default({file: 'slides.pptx'}),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;
