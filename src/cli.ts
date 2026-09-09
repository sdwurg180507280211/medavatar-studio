import 'dotenv/config';
import {spawn} from 'node:child_process';
import {copyFile, readFile, readdir, rm} from 'node:fs/promises';
import path from 'node:path';
import {Command} from 'commander';
import {ProxyAgent, setGlobalDispatcher} from 'undici';

const proxyUrl = process.env.https_proxy ?? process.env.HTTPS_PROXY ?? process.env.http_proxy ?? process.env.HTTP_PROXY;
if (proxyUrl) setGlobalDispatcher(new ProxyAgent(proxyUrl));
import {splitAudioIntoChapters} from './audioChapters.js';
import {captionCuesFromAlignment, captionCuesFromSceneDurations, type CaptionCue} from './core/captions.js';
import {planAvatarChapters, type AvatarChapterManifest, type AvatarChapterManifestEntry, type AvatarChapterPlan} from './core/chapters.js';
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
type AvatarStrategy = 'single' | 'chaptered';

type StagedAvatarChapter = {
  src: string;
  start: number;
  end: number;
};

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

const writeChapterPlan = async (
  project: MedAvatarProject,
  config: ProjectConfig,
  paths: ReturnType<typeof projectPaths>,
) => {
  const plan = planAvatarChapters(project.scenes, config.avatar.chapterMaxSeconds);
  await writeJson(paths.chapters, plan);
  return plan;
};

const storyboard = async (projectName: string) => {
  const {paths, config} = await loadConfig(projectName);
  await ensureDir(paths.output);
  const script = await readText(paths.script);
  const project = projectSchema.parse(scriptToStoryboard(config.title, script));
  const configured: MedAvatarProject = {...project, video: config.video};
  await writeJson(paths.scene, configured);
  await writeChapterPlan(configured, config, paths);
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
    await writeChapterPlan(timedProject, config, paths);
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
  await writeChapterPlan(timedProject, config, paths);
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

const readAvatarManifest = async (file: string): Promise<AvatarChapterManifest | undefined> => {
  if (!(await fileExists(file))) return undefined;
  try {
    return JSON.parse(await readText(file)) as AvatarChapterManifest;
  } catch {
    return undefined;
  }
};

const manifestIsComplete = async (
  manifest: AvatarChapterManifest | undefined,
  paths: ReturnType<typeof projectPaths>,
) => {
  if (!manifest || manifest.chapters.length === 0 || !(await fileExists(paths.chapters))) return false;
  let planned: AvatarChapterPlan[];
  try {
    planned = JSON.parse(await readText(paths.chapters)) as AvatarChapterPlan[];
  } catch {
    return false;
  }
  if (planned.length !== manifest.chapters.length) return false;
  const samePlan = manifest.chapters.every((chapter, index) => {
    const expected = planned[index];
    return Boolean(
      expected
      && chapter.id === expected.id
      && Math.abs(chapter.start - expected.start) < 0.01
      && Math.abs(chapter.end - expected.end) < 0.01,
    );
  });
  if (!samePlan) return false;
  const checks = await Promise.all(manifest.chapters.map((chapter) => fileExists(path.join(paths.avatarChapters, chapter.videoFile))));
  return checks.every(Boolean);
};

const renderSingleAvatar = async (
  projectName: string,
  config: ProjectConfig,
  paths: ReturnType<typeof projectPaths>,
  audioPath: string,
  avatarId: string,
) => {
  await rm(paths.avatarManifest, {force: true});
  await rm(paths.avatarChapters, {recursive: true, force: true});
  await rm(paths.audioChapters, {recursive: true, force: true});
  const audio = await readFile(audioPath);
  const key = sha256(Buffer.concat([audio, Buffer.from(`|single|${avatarId}|${config.avatar.resolution}`)]));
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

const renderChapteredAvatar = async (
  projectName: string,
  config: ProjectConfig,
  paths: ReturnType<typeof projectPaths>,
  audioPath: string,
  avatarId: string,
) => {
  await rm(paths.avatar, {force: true});
  const project = projectSchema.parse(JSON.parse(await readText(paths.scene)));
  const plan = planAvatarChapters(project.scenes, config.avatar.chapterMaxSeconds);
  await writeJson(paths.chapters, plan);
  const fullAudio = await readFile(audioPath);
  const globalKey = sha256(Buffer.concat([
    fullAudio,
    Buffer.from(`|chaptered|${avatarId}|${config.avatar.resolution}|${config.avatar.chapterMaxSeconds}|${JSON.stringify(plan)}`),
  ]));
  const cache = await readCache(paths.cache);
  const existingManifest = await readAvatarManifest(paths.avatarManifest);
  if (cache.avatar === globalKey && await manifestIsComplete(existingManifest, paths)) {
    console.log(`✓ chaptered avatar cache hit -> ${existingManifest!.chapters.length} chapters`);
    return paths.avatarManifest;
  }

  const audioFiles = await splitAudioIntoChapters(audioPath, plan, paths.audioChapters);
  await ensureDir(paths.avatarChapters);
  const provider = new HeyGenAvatarProvider(requiredEnv('HEYGEN_API_KEY'), avatarId, {
    resolution: config.avatar.resolution,
    pollIntervalMs: config.avatar.pollIntervalMs,
    timeoutMs: config.avatar.timeoutMs,
  });
  const previous = existingManifest?.chapters ?? [];
  const completed: AvatarChapterManifestEntry[] = [];

  for (let index = 0; index < plan.length; index += 1) {
    const chapter = plan[index];
    const chapterAudio = await readFile(audioFiles[index]);
    const hash = sha256(Buffer.concat([chapterAudio, Buffer.from(`|${avatarId}|${config.avatar.resolution}`)]));
    const videoFile = `${chapter.id}.webm`;
    const videoPath = path.join(paths.avatarChapters, videoFile);
    const reusable = previous.find((entry) => entry.id === chapter.id && entry.hash === hash && entry.videoFile === videoFile);
    if (reusable && await fileExists(videoPath)) {
      completed.push({...chapter, hash, videoFile});
      console.log(`✓ ${chapter.id} avatar cache hit`);
    } else {
      await provider.render({
        audioPath: audioFiles[index],
        outputPath: videoPath,
        title: `${config.title} · ${chapter.id}`,
      });
      completed.push({...chapter, hash, videoFile});
      console.log(`✓ ${chapter.id} heygen avatar`);
    }
    await writeJson(paths.avatarManifest, {strategy: 'chaptered', chapters: completed} satisfies AvatarChapterManifest);
  }

  const keep = new Set(completed.map((entry) => entry.videoFile));
  for (const file of await readdir(paths.avatarChapters)) {
    if (file.endsWith('.webm') && !keep.has(file)) await rm(path.join(paths.avatarChapters, file), {force: true});
  }
  await patchCache(paths.cache, {avatar: globalKey});
  console.log(`✓ chaptered heygen avatar -> ${completed.length} chapters`);
  return paths.avatarManifest;
};

const avatar = async (projectName: string) => {
  const {paths, config} = await loadConfig(projectName);
  const name = envProvider('AVATAR_PROVIDER', config.avatar.provider, ['mock', 'heygen'] as const);
  const strategy = envProvider<AvatarStrategy>('AVATAR_STRATEGY', config.avatar.strategy, ['single', 'chaptered'] as const);
  if (name === 'mock') {
    await rm(paths.avatar, {force: true});
    await rm(paths.avatarManifest, {force: true});
    await rm(paths.avatarChapters, {recursive: true, force: true});
    await rm(paths.audioChapters, {recursive: true, force: true});
    console.log('✓ avatar mock -> renderer presenter placeholder');
    return null;
  }
  const audioPath = await findNarration(projectName);
  const avatarId = requiredEnv('HEYGEN_AVATAR_ID');
  return strategy === 'chaptered'
    ? renderChapteredAvatar(projectName, config, paths, audioPath, avatarId)
    : renderSingleAvatar(projectName, config, paths, audioPath, avatarId);
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
  const assets: {narration?: string; avatar?: string; avatarChapters?: StagedAvatarChapter[]; slides: string[]} = {slides: []};
  const narrationCandidates = [paths.narrationMp3, paths.narrationWav];
  for (const source of narrationCandidates) {
    if (await fileExists(source)) {
      const name = path.basename(source);
      await copyFile(source, path.join(paths.publicGenerated, name));
      assets.narration = path.posix.join('generated', projectName, name);
      break;
    }
  }

  const manifest = await readAvatarManifest(paths.avatarManifest);
  if (manifest && await manifestIsComplete(manifest, paths)) {
    assets.avatarChapters = [];
    for (const chapter of manifest.chapters) {
      await copyFile(path.join(paths.avatarChapters, chapter.videoFile), path.join(paths.publicGenerated, chapter.videoFile));
      assets.avatarChapters.push({
        src: path.posix.join('generated', projectName, chapter.videoFile),
        start: chapter.start,
        end: chapter.end,
      });
    }
  } else if (await fileExists(paths.avatar)) {
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

const chapters = async (projectName: string) => {
  const {paths, config} = await loadConfig(projectName);
  const project = await fileExists(paths.scene)
    ? projectSchema.parse(JSON.parse(await readText(paths.scene)))
    : await storyboard(projectName);
  const plan = await writeChapterPlan(project, config, paths);
  console.log(`✓ chapters -> ${plan.length} chapters (${config.avatar.chapterMaxSeconds}s max target)`);
  for (const chapter of plan) {
    console.log(`  ${chapter.id}: ${chapter.start.toFixed(1)}s-${chapter.end.toFixed(1)}s · ${chapter.transitionHint}`);
  }
  return plan;
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
program.command('chapters <project>').action(async (project) => { await chapters(project); });
program.command('avatar <project>').action(async (project) => { await storyboard(project); await voice(project); await avatar(project); });
program.command('slides <project>').action(async (project) => { await slides(project); });
program.command('render <project>').action(async (project) => { if (!(await fileExists(projectPaths(project).scene))) await storyboard(project); await render(project); });
program.command('build <project>').action(build);

await program.parseAsync(process.argv);
