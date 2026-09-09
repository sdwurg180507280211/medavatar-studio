import 'dotenv/config';
import {spawn} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Command} from 'commander';
import {ensureDir, projectPaths, readText, sha256, writeJson} from './core/io.js';
import {projectSchema} from './core/schema.js';
import {MockTtsProvider} from './providers/mock.js';
import {scriptToStoryboard} from './storyboard.js';

const program = new Command();
program.name('medavatar').description('MedAvatar Studio CLI').version('0.1.0');

const loadConfig = async (projectName: string) => {
  const paths = projectPaths(projectName);
  const raw = JSON.parse(await readText(paths.config)) as {title?: string};
  return {paths, title: raw.title ?? projectName};
};

const storyboard = async (projectName: string) => {
  const {paths, title} = await loadConfig(projectName);
  await ensureDir(paths.output);
  const script = await readText(paths.script);
  const project = projectSchema.parse(scriptToStoryboard(title, script));
  await writeJson(paths.scene, project);
  console.log(`✓ storyboard -> ${path.relative(process.cwd(), paths.scene)}`);
  return project;
};

const voice = async (projectName: string) => {
  const {paths} = await loadConfig(projectName);
  await ensureDir(paths.output);
  const project = projectSchema.parse(JSON.parse(await readText(paths.scene)));
  const fullText = project.scenes.map((scene) => scene.text).join('\n');
  const provider = new MockTtsProvider();
  const result = await provider.synthesize({text: fullText, outputPath: paths.narration});
  await writeJson(paths.timing, result.segments);
  console.log(`✓ mock narration -> ${path.relative(process.cwd(), paths.narration)}`);
  return result;
};

const prepareRenderProps = async (projectName: string) => {
  const {paths} = await loadConfig(projectName);
  const project = projectSchema.parse(JSON.parse(await readText(paths.scene)));
  const props = {project};
  await writeJson(paths.props, props);
  return {paths, project};
};

const run = (command: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {stdio: 'inherit', shell: process.platform === 'win32'});
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
    child.on('error', reject);
  });

const render = async (projectName: string) => {
  const {paths} = await prepareRenderProps(projectName);
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

const build = async (projectName: string) => {
  const {paths} = await loadConfig(projectName);
  const script = await readFile(paths.script);
  const fingerprint = sha256(script);
  await storyboard(projectName);
  await voice(projectName);
  await render(projectName);
  await writeFile(paths.cache, `${JSON.stringify({script: fingerprint}, null, 2)}\n`, 'utf8');
};

program.command('storyboard <project>').action(async (project) => {
  await storyboard(project);
});
program.command('voice <project>').action(async (project) => {
  await storyboard(project);
  await voice(project);
});
program.command('render <project>').action(async (project) => {
  await storyboard(project);
  await render(project);
});
program.command('build <project>').action(build);

await program.parseAsync(process.argv);
