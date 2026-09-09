import 'dotenv/config';
import {spawn} from 'node:child_process';
import {copyFile, readFile, readdir, rm} from 'node:fs/promises';
import path from 'node:path';
import {Command} from 'commander';
import {ProxyAgent, setGlobalDispatcher} from 'undici';

const proxyUrl = process.env.https_proxy ?? process.env.HTTPS_PROXY ?? process.env.http_proxy ?? process.env.HTTP_PROXY;
if (proxyUrl) setGlobalDispatcher(new ProxyAgent(proxyUrl));
import {captionCuesFromAlignment, captionCuesFromSceneDurations, type CaptionCue} from './core/captions.js';
import {projectConfigSchema, type ProjectConfig} from './core/config.js';
import {ensureDir, fileExists, projectPaths, readText, sha256, writeJson} from './core/io.js';
import {projectSchema, type MedAvatarProject} from './core/schema.js';
import {applyTimingsToScenes, sceneTimingsFromAlignment} from './core/timing.js';
import {convertPptToPng} from './ppt.js';
import {ElevenLabsTtsProvider} from './providers/elevenlabs.js';
import {HeyGenAvatarProvider} from './providers/heygen.js';
import {MockTtsProvider} from './providers/mock.js';
import type {CharacterAlignment, TimingSegment, TtsProvider} from './providers/types.js';
import {scriptToStoryboard} from './storyboard.js';

const program = new Command();
program.name('medavatar').description('MedAvatar Studio CLI').version('0.3.0');

type CacheFile = Record<string, string | undefined>;

const loadConfig = async (projectName: string) => {
  const paths = projectPaths(projectName);
  const config = projectConfigSchema.parse(JSON.parse(await readText(paths.config)));
  return {paths, config};
};

const envProvider = <T extends string>(name: string, fallback: T, allowed: readonly T[]): T => {
  const value = process.env[name];
  if (!value) return fallback;
  if (!allowed.includes(value as T)) throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
  return value as T;
};

const requiredEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the selected provider.`);
  return value;
};

const readCache = async (file: string): Promise<CacheFile> => {
  if (!(await fileExists(file))) return {};
  try {
    return JSON.parse(await readText(file)) as CacheFile;
  } catch {
    return {};
  }
};

const patchCache = async (file: string, patch: CacheFile) => {
  const current = await readCache(file);
  await writeJson(file, {...current, ...patch});
};

const cumulativeTimings = (project: MedAvatarProject): TimingSegment[] => {
  let cursor = 0;
  return project.scenes.map((scene) => {
    const start = cursor;
    cursor += scene.durationInSeconds;
    return {text: scene.text, start, end: cursor};
  });
};

const storyboard = async (projectName: string) => {
  const {paths, config} = await loadConfig(projectName);
  await ensureDir(paths.output);
  const script = await readText(paths.script);
  const project = projectSchema.parse(scriptToStoryboard(config.title, script));
  const configured: MedAvatarProject = {...project, video: config.video};
  await writeJson(paths.scene, configured);
  console.log(`✓ storyboard -> ${path.relative(process.cwd(), paths.scene)}`);
  return configured;
};

const makeTtsProvider = (config: ProjectConfig): {name: 'mock' | 'elevenlabs'; provider: TtsProvider} => {
  const name = envProvider('TTS_PROVIDER', config.voice.provider, ['mock', 'elevenlabs'] as const);
  if (name === 'elevenlabs') {
    return {
      name,
      provider: new ElevenLabsTtsProvider(
        requiredEnv('ELEVENLABS_API_KEY'),
        requiredEnv('ELEVENLABS_VOICE_ID'),
        config.voice.modelId,
        config.voice.outputFormat,
      ),
    };
  }
  return {name, provider: new MockTtsProvider()};
};

const writeCaptionArtifacts = async (
  project: MedAvatarProject,
  fullText: string,
  alignment: CharacterAlignment | undefined,
  paths: ReturnType<typeof projectPaths>,
) => {
  const captions = alignment
    ? captionCuesFromAlignment(project.scenes, fullText, alignment)
    : captionCuesFromSceneDurations(project.scenes);
  await writeJson(paths.captions, captions);
  if (alignment) await writeJson(paths.alignment, alignment);
  else await rm(paths.alignment, {force: true});
  return captions;
};

const voice = async (projectName: string) => {
  const {paths, config} = await loadConfig(projectName);
  const project = projectSchema.parse(JSON.parse(await readText(paths.scene)));
  const fullText = project.scenes.map((scene) => scene.text).join('\n');
  const {name, provider} = makeTtsProvider(config);
  const outputPath = name === 'elevenlabs' ? paths.narrationMp3 : paths.narrationWav;
  const staleOutput = name === 'elevenlabs' ? paths.narrationWav : paths.narrationMp3;
  await rm(staleOutput, {force: true});
  const voiceIdentity = name === 'elevenlabs' ? process.env.ELEVENLABS_VOICE_ID : 'mock';
  const key = sha256(`${name}|${voiceIdentity}|${config.voice.modelId}|${config.voice.outputFormat}|${fullText}`);
  const cache = await readCache(paths.cache);
  if (cache.voice === key && await fileExists(outputPath) && await fileExists(paths.timing)) {
    const timings = JSON.parse(await readText(paths.timing)) as TimingSegment[];
    const timedProject = {...project, scenes: applyTimingsToScenes(project.scenes, timings)};
    let alignment: CharacterAlignment | undefined;
    if (await fileExists(paths.alignment)) {
      alignment = JSON.parse(await readText(paths.alignment)) as CharacterAlignment;
    }
    await writeJson(paths.scene, timedProject);
    await writeCaptionArtifacts(timedProject, fullText, alignment, paths);
    console.log(`✓ voice cache hit -> ${path.relative(process.cwd(), outputPath)}`);
    return {audioPath: outputPath, timings};
  }

  const result = await provider.synthesize({text: fullText, outputPath});
  const timings = result.alignment
    ? sceneTimingsFromAlignment(project.scenes, fullText, result.alignment)
    : cumulativeTimings(project);
  const timedProject = {...project, scenes: applyTimingsToScenes(project.scenes, timings)};
  await writeJson(paths.timing, timings);
  await writeJson(paths.scene, timedProject);
  await writeCaptionArtifacts(timedProject, fullText, result.alignment, paths);
  await patchCache(paths.cache, {voice: key});
  console.log(`✓ ${name} narration -> ${path.relative(process.cwd(), outputPath)}`);
  return {audioPath: outputPath, timings};
};

const findNarration = async (projectName: string) => {
  const paths = projectPaths(projectName);
  if (await fileExists(paths.narrationMp3)) return paths.narrationMp3;
  if (await fileExists(paths.narrationWav)) return paths.narrationWav;
  throw new Error('Narration is missing. Run the voice stage first.');
};

const avatar = async (projectName: string) => {
  const {paths, config} = await loadConfig(projectName);
  const name = envProvider('AVATAR_PROVIDER', config.avatar.provider, ['mock', 'heygen'] as const);
  if (name === 'mock') {
    await rm(paths.avatar, {force: true});
    console.log('✓ avatar mock -> renderer presenter placeholder');
    return null;
  }
  const audioPath = await findNarration(projectName);
  const audio = await readFile(audioPath);
  const avatarId = requiredEnv('HEYGEN_AVATAR_ID');
  const key = sha256(Buffer.concat([audio, Buffer.from(`|${avatarId}|${config.avatar.resolution}`)]));
  const cache = await readCache(paths.cache);
  if (cache.avatar === key && await fileExists(paths.avatar)) {
    console.log(`✓ avatar cache hit -> ${path.relative(process.cwd(), paths.avatar)}`);
    return paths.avatar;
  }
  const provider = new HeyGenAvatarProvider(requiredEnv('HEYGEN_API_KEY'), avatarId, {
    resolution: config.avatar.resolution,
    pollIntervalMs: config.avatar.pollIntervalMs,
    timeoutMs: config.avatar.timeoutMs,
  });
  await provider.render({audioPath, outputPath: paths.avatar, title: config.title});
  await patchCache(paths.cache, {avatar: key});
  console.log(`✓ heygen avatar -> ${path.relative(process.cwd(), paths.avatar)}`);
  return paths.avatar;
};

const slides = async (projectName: string) => {
  const {paths, config} = await loadConfig(projectName);
  const pptPath = path.resolve(paths.root, config.ppt.file);
  if (!(await fileExists(pptPath))) {
    await rm(paths.slides, {recursive: true, force: true});
    console.log(`• slides skipped: ${path.relative(process.cwd(), pptPath)} not found`);
    return [];
  }
  const ppt = await readFile(pptPath);
  const key = sha256(ppt);
  const cache = await readCache(paths.cache);
  if (cache.slides === key && await fileExists(paths.slides)) {
    const existing = (await readdir(paths.slides)).filter((file) => file.endsWith('.png')).sort();
    if (existing.length > 0) {
      console.log(`✓ slides cache hit -> ${existing.length} pages`);
      return existing.map((file) => path.join(paths.slides, file));
    }
  }
  const images = await convertPptToPng(pptPath, paths.slides);
  await patchCache(paths.cache, {slides: key});
  console.log(`✓ slides -> ${images.length} pages`);
  return images;
};

const stageAssets = async (projectName: string) => {
  const paths = projectPaths(projectName);
  await rm(paths.publicGenerated, {recursive: true, force: true});
  await ensureDir(paths.publicGenerated);
  const assets: {narration?: string; avatar?: string; slides: string[]} = {slides: []};
  const narrationCandidates = [paths.narrationMp3, paths.narrationWav];
  for (const source of narrationCandidates) {
    if (await fileExists(source)) {
      const name = path.basename(source);
      await copyFile(source, path.join(paths.publicGenerated, name));
      assets.narration = path.posix.join('generated', projectName, name);
      break;
    }
  }
  if (await fileExists(paths.avatar)) {
    await copyFile(paths.avatar, path.join(paths.publicGenerated, 'avatar.webm'));
    assets.avatar = path.posix.join('generated', projectName, 'avatar.webm');
  }
  if (await fileExists(paths.slides)) {
    const files = (await readdir(paths.slides)).filter((file) => file.endsWith('.png')).sort();
    for (const file of files) {
      await copyFile(path.join(paths.slides, file), path.join(paths.publicGenerated, file));
      assets.slides.push(path.posix.join('generated', projectName, file));
    }
  }
  return assets;
};

const prepareRenderProps = async (projectName: string) => {
  const paths = projectPaths(projectName);
  const project = projectSchema.parse(JSON.parse(await readText(paths.scene)));
  const assets = await stageAssets(projectName);
  const captions: CaptionCue[] = await fileExists(paths.captions)
    ? JSON.parse(await readText(paths.captions)) as CaptionCue[]
    : captionCuesFromSceneDurations(project.scenes);
  await writeJson(paths.props, {project, assets, captions});
  return paths;
};

const run = (command: string, args: string[]) => new Promise<void>((resolve, reject) => {
  const child = spawn(command, args, {stdio: 'inherit', shell: process.platform === 'win32'});
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  child.on('error', reject);
});

const render = async (projectName: string) => {
  const paths = await prepareRenderProps(projectName);
  await run('pnpm', ['exec', 'remotion', 'render', 'remotion/index.tsx', 'MedAvatarVideo', paths.finalVideo, `--props=${paths.props}`]);
  console.log(`✓ video -> ${path.relative(process.cwd(), paths.finalVideo)}`);
};

const build = async (projectName: string) => {
  await storyboard(projectName);
  await voice(projectName);
  await avatar(projectName);
  await slides(projectName);
  await render(projectName);
};

program.command('storyboard <project>').action(async (project) => { await storyboard(project); });
program.command('voice <project>').action(async (project) => { await storyboard(project); await voice(project); });
program.command('avatar <project>').action(async (project) => { await storyboard(project); await voice(project); await avatar(project); });
program.command('slides <project>').action(async (project) => { await slides(project); });
program.command('render <project>').action(async (project) => { if (!(await fileExists(projectPaths(project).scene))) await storyboard(project); await render(project); });
program.command('build <project>').action(build);

await program.parseAsync(process.argv);
