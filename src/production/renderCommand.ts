import {spawn} from 'node:child_process';
import path from 'node:path';
import {prepareRenderProps} from './renderProps.js';

const run = (command: string, args: string[]) => new Promise<void>((resolve, reject) => {
  const child = spawn(command, args, {stdio: 'inherit', shell: process.platform === 'win32'});
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  child.on('error', reject);
});

export const renderProject = async (projectName: string) => {
  const {paths, state} = await prepareRenderProps(projectName);
  if (state.timeline.stale) {
    console.warn('• narration timing is stale; rendering uses estimated scene timing and omits stale narration/avatar media');
  } else if (state.timeline.source === 'estimated') {
    console.warn('• narration timing is missing; rendering uses estimated scene timing');
  }
  await run('pnpm', [
    'exec',
    'remotion',
    'render',
    'remotion/index.tsx',
    'MedAvatarVideo',
    paths.finalVideo,
    `--props=${paths.props}`,
  ]);
  console.log(`✓ video -> ${path.relative(process.cwd(), paths.finalVideo)}`);
};
