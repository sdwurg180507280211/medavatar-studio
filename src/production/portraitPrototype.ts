import path from 'node:path';
import {z} from 'zod';
import {fileExists, projectPaths, readText} from '../core/io.js';
import {sceneIdSchema} from '../core/schema.js';

export const emphasisCardPrototypeSchema = z.object({
  template: z.literal('emphasis-card'),
  headline: z.string().min(1),
  highlight: z.string().min(1),
  support: z.string().min(1),
});

export const portraitPrototypeVisualSchema = emphasisCardPrototypeSchema;

export const portraitPrototypeVisualsSchema = z.object({
  version: z.literal('prototype-1'),
  scenes: z.record(sceneIdSchema, portraitPrototypeVisualSchema),
});

export type EmphasisCardPrototype = z.infer<typeof emphasisCardPrototypeSchema>;
export type PortraitPrototypeVisual = z.infer<typeof portraitPrototypeVisualSchema>;
export type PortraitPrototypeVisuals = z.infer<typeof portraitPrototypeVisualsSchema>;

export const portraitPrototypeVisualsPath = (projectName: string) =>
  path.join(projectPaths(projectName).root, 'portrait.visuals.json');

export const loadPortraitPrototypeVisuals = async (
  projectName: string,
): Promise<PortraitPrototypeVisuals | undefined> => {
  const file = portraitPrototypeVisualsPath(projectName);
  if (!(await fileExists(file))) return undefined;
  return portraitPrototypeVisualsSchema.parse(JSON.parse(await readText(file)));
};
