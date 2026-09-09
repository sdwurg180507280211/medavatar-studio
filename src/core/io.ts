import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

export const ensureDir = async (dir: string) => mkdir(dir, {recursive: true});

export const readText = (file: string) => readFile(file, 'utf8');

export const writeJson = async (file: string, value: unknown) => {
  await ensureDir(path.dirname(file));
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

export const sha256 = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');

export const projectPaths = (projectName: string) => {
  const root = path.resolve('projects', projectName);
  const output = path.join(root, 'output');
  return {
    root,
    output,
    script: path.join(root, 'script.md'),
    config: path.join(root, 'project.json'),
    scene: path.join(output, 'scene.json'),
    timing: path.join(output, 'timing.json'),
    narration: path.join(output, 'narration.wav'),
    props: path.join(output, 'render-props.json'),
    finalVideo: path.join(output, 'final.mp4'),
    cache: path.join(output, '.cache.json'),
  };
};
