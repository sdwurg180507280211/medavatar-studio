import {createHash} from 'node:crypto';
import {access, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

export const ensureDir = async (dir: string) => mkdir(dir, {recursive: true});
export const readText = (file: string) => readFile(file, 'utf8');
export const fileExists = async (file: string) => access(file).then(() => true).catch(() => false);

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
    alignment: path.join(output, 'alignment.json'),
    captions: path.join(output, 'captions.json'),
    chapters: path.join(output, 'chapters.json'),
    narrationWav: path.join(output, 'narration.wav'),
    narrationMp3: path.join(output, 'narration.mp3'),
    avatar: path.join(output, 'avatar.webm'),
    avatarManifest: path.join(output, 'avatar-manifest.json'),
    avatarChapters: path.join(output, 'avatar-chapters'),
    audioChapters: path.join(output, 'audio-chapters'),
    avatarRaw: path.join(output, 'avatar-raw.webm'),
    slides: path.join(output, 'slides'),
    props: path.join(output, 'render-props.json'),
    finalVideo: path.join(output, 'final.mp4'),
    cache: path.join(output, '.cache.json'),
    publicGenerated: path.resolve('public', 'generated', projectName),
  };
};
