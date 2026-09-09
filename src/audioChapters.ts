import {spawn} from 'node:child_process';
import {mkdir, rm} from 'node:fs/promises';
import path from 'node:path';
import type {AvatarChapterPlan} from './core/chapters.js';

const run = (command: string, args: string[]) => new Promise<void>((resolve, reject) => {
  const child = spawn(command, args, {stdio: 'inherit', shell: process.platform === 'win32'});
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  child.on('error', (error) => reject(new Error(`Could not run ${command}: ${error.message}`)));
});

export const splitAudioIntoChapters = async (
  audioPath: string,
  chapters: AvatarChapterPlan[],
  outputDir: string,
  ffmpegBin = process.env.FFMPEG_BIN ?? 'ffmpeg',
) => {
  await rm(outputDir, {recursive: true, force: true});
  await mkdir(outputDir, {recursive: true});
  const outputs: string[] = [];
  for (const chapter of chapters) {
    const output = path.join(outputDir, `${chapter.id}.mp3`);
    await run(ffmpegBin, [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', audioPath,
      '-ss', chapter.start.toFixed(3),
      '-t', chapter.duration.toFixed(3),
      '-vn',
      '-c:a', 'libmp3lame',
      '-b:a', '128k',
      output,
    ]);
    outputs.push(output);
  }
  return outputs;
};
