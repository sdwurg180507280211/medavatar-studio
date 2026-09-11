import 'dotenv/config';
import {readFile, readdir, rm} from 'node:fs/promises';
import path from 'node:path';
import {Command} from 'commander';
import {ProxyAgent, setGlobalDispatcher} from 'undici';

const proxyUrl = process.env.https_proxy ?? process.env.HTTPS_PROXY ?? process.env.http_proxy ?? process.env.HTTP_PROXY;
if (proxyUrl) setGlobalDispatcher(new ProxyAgent(proxyUrl));
import {splitAudioIntoChapters} from './audioChapters.js';
import {captionCuesFromAlignment, captionCuesFromSceneDurations} from './core/captions.js';
import {planAvatarChapters, type AvatarChapterManifest, type AvatarChapterManifestEntry, type AvatarChapterPlan} from './core/chapters.js';
import {projectConfigSchema, type ProjectConfig} from './core/config.js';
import {ensureDir, fileExists, projectPaths, readText, sha256, writeJson} from './core/io.js';
import {applyStoryboardOverrides, storyboardOverridesSchema} from './core/overrides.js';
import {projectSchema, type MedAvatarProject} from './core/schema.js';
import {applyTimingsToScenes, sceneTimingsFromAlignment} from './core/timing.js';
import {convertPptToPng} from './ppt.js';
import {ElevenLabsTtsProvider} from './providers/elevenlabs.js';
import {
  HeyGenAvatarProvider,
  HeyGenTransparencyError,
  HEYGEN_AVATAR_ASPECT_RATIO,
  HEYGEN_OUTPUT_FORMAT,
  inspectTransparentWebm,
} from './providers/heygen.js';
import {MockTtsProvider} from './providers/mock.js';
import type {CharacterAlignment, TimingSegment, TtsProvider} from './providers/types.js';
import {renderProject} from './production/renderCommand.js';
import {scriptToStoryboard} from './storyboard.js';

const program = new Command();
program.name('medavatar').description('MedAvatar Studio CLI').version('0.4.1');

const AVATAR_PRESENTATION_CACHE_VERSION = 'portrait-alpha-v2';
const LEGACY_AVATAR_PRESENTATION_CACHE_VERSION = 'portrait-source-v1';

type CacheFile = Record<string, string | undefined>;
type AvatarStrategy = 'single' | 'chaptered';

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
  const generated = projectSchema.parse(scriptToStoryboard(config.title, script, config.video));
  const configured: MedAvatarProject = {...generated, video: config.video};
  let project = configured;
  if (await fileExists(paths.overrides)) {
    const overrides = storyboardOverridesSchema.parse(JSON.parse(await readText(paths.overrides)));
    const applied = applyStoryboardOverrides(configured, overrides);
    project = applied.project;
    for (const sceneId of applied.orphanSceneIds) {
      console.warn(`• storyboard override ignored: unknown scene id ${sceneId}`);
    }
  }
  await writeJson(paths.scene, project);
  await writeChapterPlan(project, config, paths);
  console.log(`✓ storyboard -> ${path.relative(process.cwd(), paths.scene)}`);
  return project;
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
  const checks = await Promise.all(
    manifest.chapters.map((chapter) => fileExists(path.join(paths.avatarChapters, chapter.videoFile))),
  );
  return checks.every(Boolean);
};

const inspectCachedTransparentAvatar = async (file: string, label: string) => {
  if (!(await fileExists(file))) return undefined;
  try {
    return await inspectTransparentWebm(file);
  } catch (error) {
    if (error instanceof HeyGenTransparencyError) {
      console.warn(`• cached ${label} transparency validation failed: ${error.message}`);
      return undefined;
    }
    throw error;
  }
};

const clearChapteredAvatarArtifacts = async (paths: ReturnType<typeof projectPaths>) => {
  await rm(paths.avatarManifest, {force: true});
  await rm(paths.avatarChapters, {recursive: true, force: true});
  await rm(paths.audioChapters, {recursive: true, force: true});
};

const renderSingleAvatar = async (
  projectName: string,
  config: ProjectConfig,
  paths: ReturnType<typeof projectPaths>,
  audioPath: string,
  avatarId: string,
) => {
  const audio = await readFile(audioPath);
  const identity = `single|${avatarId}|${config.avatar.resolution}|${HEYGEN_AVATAR_ASPECT_RATIO}|${HEYGEN_OUTPUT_FORMAT}|transparent`;
  const key = sha256(Buffer.concat([audio, Buffer.from(`|${identity}|${AVATAR_PRESENTATION_CACHE_VERSION}`)]));
  const legacyIdentity = `single|${avatarId}|${config.avatar.resolution}|${HEYGEN_AVATAR_ASPECT_RATIO}`;
  const legacyKey = sha256(Buffer.concat([audio, Buffer.from(`|${legacyIdentity}|${LEGACY_AVATAR_PRESENTATION_CACHE_VERSION}`)]));
  const cache = await readCache(paths.cache);

  const cachedAlpha = cache.avatar === key
    ? await inspectCachedTransparentAvatar(paths.avatar, 'avatar')
    : undefined;
  if (cachedAlpha) {
    await clearChapteredAvatarArtifacts(paths);
    await writeJson(paths.avatarMetadata, {
      provider: 'heygen',
      strategy: 'single',
      avatarId,
      requestedOutputFormat: HEYGEN_OUTPUT_FORMAT,
      outputFormat: HEYGEN_OUTPUT_FORMAT,
      transparent: true,
      alphaMode: cachedAlpha.alphaMode,
      cache: 'validated',
    });
    console.log(`✓ avatar cache hit (Alpha validated) -> ${path.relative(process.cwd(), paths.avatar)}`);
    return paths.avatar;
  }

  const legacyAlpha = cache.avatar === legacyKey
    ? await inspectCachedTransparentAvatar(paths.avatar, 'legacy avatar')
    : undefined;
  if (legacyAlpha) {
    await clearChapteredAvatarArtifacts(paths);
    await patchCache(paths.cache, {avatar: key});
    await writeJson(paths.avatarMetadata, {
      provider: 'heygen',
      strategy: 'single',
      avatarId,
      requestedOutputFormat: HEYGEN_OUTPUT_FORMAT,
      outputFormat: HEYGEN_OUTPUT_FORMAT,
      transparent: true,
      alphaMode: legacyAlpha.alphaMode,
      cache: 'migrated',
    });
    console.log(`✓ avatar cache migrated (Alpha validated) -> ${path.relative(process.cwd(), paths.avatar)}`);
    return paths.avatar;
  }

  const provider = new HeyGenAvatarProvider(requiredEnv('HEYGEN_API_KEY'), avatarId, {
    resolution: config.avatar.resolution,
    pollIntervalMs: config.avatar.pollIntervalMs,
    timeoutMs: config.avatar.timeoutMs,
  });
  const result = await provider.render({audioPath, outputPath: paths.avatar, title: config.title});
  await clearChapteredAvatarArtifacts(paths);
  await writeJson(paths.avatarMetadata, {
    provider: 'heygen',
    strategy: 'single',
    avatarId,
    videoId: result.videoId,
    assetId: result.assetId,
    requestedOutputFormat: result.requestedOutputFormat,
    outputFormat: result.outputFormat,
    transparent: result.transparent,
    alphaMode: result.alphaMode,
    cache: 'generated',
  });
  await rm(path.join(paths.output, 'avatar-raw.webm'), {force: true});
  await patchCache(paths.cache, {avatar: key});
  console.log(`✓ heygen ${HEYGEN_AVATAR_ASPECT_RATIO} portrait avatar -> ${path.relative(process.cwd(), paths.avatar)}`);
  return paths.avatar;
};

const renderChapteredAvatar = async (
  projectName: string,
  config: ProjectConfig,
  paths: ReturnType<typeof projectPaths>,
  audioPath: string,
  avatarId: string,
) => {
  const project = projectSchema.parse(JSON.parse(await readText(paths.scene)));
  const plan = planAvatarChapters(project.scenes, config.avatar.chapterMaxSeconds);
  await writeJson(paths.chapters, plan);
  const fullAudio = await readFile(audioPath);
  const globalKey = sha256(Buffer.concat([
    fullAudio,
    Buffer.from(`|chaptered|${avatarId}|${config.avatar.resolution}|${HEYGEN_AVATAR_ASPECT_RATIO}|${HEYGEN_OUTPUT_FORMAT}|transparent|${AVATAR_PRESENTATION_CACHE_VERSION}|${config.avatar.chapterMaxSeconds}|${JSON.stringify(plan)}`),
  ]));
  const cache = await readCache(paths.cache);
  const existingManifest = await readAvatarManifest(paths.avatarManifest);
  if (cache.avatar === globalKey && await manifestIsComplete(existingManifest, paths)) {
    const validated = [] as Array<{id: string; videoFile: string; alphaMode?: string}>;
    let allTransparent = true;
    for (const chapter of existingManifest!.chapters) {
      const inspection = await inspectCachedTransparentAvatar(
        path.join(paths.avatarChapters, chapter.videoFile),
        chapter.id,
      );
      if (!inspection) {
        allTransparent = false;
        break;
      }
      validated.push({...chapter, alphaMode: inspection.alphaMode});
    }
    if (allTransparent) {
      await rm(paths.avatar, {force: true});
      await writeJson(paths.avatarMetadata, {
        provider: 'heygen',
        strategy: 'chaptered',
        avatarId,
        requestedOutputFormat: HEYGEN_OUTPUT_FORMAT,
        outputFormat: HEYGEN_OUTPUT_FORMAT,
        transparent: true,
        cache: 'validated',
        chapters: validated,
      });
      console.log(`✓ chaptered avatar cache hit (Alpha validated) -> ${existingManifest!.chapters.length} chapters`);
      return paths.avatarManifest;
    }
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
  const metadataChapters: Array<{
    id: string;
    videoFile: string;
    videoId?: string;
    assetId?: string;
    outputFormat?: string;
    transparent: boolean;
    alphaMode?: string;
  }> = [];

  for (let index = 0; index < plan.length; index += 1) {
    const chapter = plan[index];
    const chapterAudio = await readFile(audioFiles[index]);
    const hash = sha256(Buffer.concat([
      chapterAudio,
      Buffer.from(`|${avatarId}|${config.avatar.resolution}|${HEYGEN_AVATAR_ASPECT_RATIO}|${HEYGEN_OUTPUT_FORMAT}|transparent|${AVATAR_PRESENTATION_CACHE_VERSION}`),
    ]));
    const videoFile = `${chapter.id}.webm`;
    const videoPath = path.join(paths.avatarChapters, videoFile);
    const reusable = previous.find(
      (entry) => entry.id === chapter.id && entry.hash === hash && entry.videoFile === videoFile,
    );
    const reusedInspection = reusable
      ? await inspectCachedTransparentAvatar(videoPath, chapter.id)
      : undefined;
    if (reusable && reusedInspection) {
      completed.push({...chapter, hash, videoFile});
      metadataChapters.push({
        id: chapter.id,
        videoFile,
        outputFormat: HEYGEN_OUTPUT_FORMAT,
        transparent: true,
        alphaMode: reusedInspection.alphaMode,
      });
      console.log(`✓ ${chapter.id} avatar cache hit (Alpha validated)`);
    } else {
      const result = await provider.render({
        audioPath: audioFiles[index],
        outputPath: videoPath,
        title: `${config.title} · ${chapter.id}`,
      });
      metadataChapters.push({
        id: chapter.id,
        videoFile,
        videoId: result.videoId,
        assetId: result.assetId,
        outputFormat: result.outputFormat,
        transparent: result.transparent === true,
        alphaMode: result.alphaMode,
      });
      await writeJson(paths.avatarMetadata, {
        provider: 'heygen',
        strategy: 'chaptered',
        avatarId,
        requestedOutputFormat: HEYGEN_OUTPUT_FORMAT,
        outputFormat: result.outputFormat,
        transparent: result.transparent,
        alphaMode: result.alphaMode,
        cache: 'generated',
        chapters: metadataChapters,
      });
      completed.push({...chapter, hash, videoFile});
      console.log(`✓ ${chapter.id} heygen ${HEYGEN_AVATAR_ASPECT_RATIO} portrait avatar`);
    }
    await writeJson(
      paths.avatarManifest,
      {strategy: 'chaptered', chapters: completed} satisfies AvatarChapterManifest,
    );
  }

  const keep = new Set(completed.map((entry) => entry.videoFile));
  for (const file of await readdir(paths.avatarChapters)) {
    if (file.endsWith('.webm') && !keep.has(file)) {
      await rm(path.join(paths.avatarChapters, file), {force: true});
    }
  }
  await rm(paths.avatar, {force: true});
  await writeJson(paths.avatarMetadata, {
    provider: 'heygen',
    strategy: 'chaptered',
    avatarId,
    requestedOutputFormat: HEYGEN_OUTPUT_FORMAT,
    outputFormat: HEYGEN_OUTPUT_FORMAT,
    transparent: true,
    cache: metadataChapters.some((chapter) => chapter.videoId) ? 'generated' : 'validated',
    chapters: metadataChapters,
  });
  await patchCache(paths.cache, {avatar: globalKey});
  console.log(`✓ chaptered heygen avatar -> ${completed.length} portrait chapters`);
  return paths.avatarManifest;
};

const avatar = async (projectName: string) => {
  const {paths, config} = await loadConfig(projectName);
  const name = envProvider('AVATAR_PROVIDER', config.avatar.provider, ['mock', 'heygen'] as const);
  const strategy = envProvider<AvatarStrategy>(
    'AVATAR_STRATEGY',
    config.avatar.strategy,
    ['single', 'chaptered'] as const,
  );
  if (name === 'mock') {
    await rm(paths.avatar, {force: true});
    await rm(paths.avatarMetadata, {force: true});
    await rm(path.join(paths.output, 'avatar-raw.webm'), {force: true});
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
  await renderProject(projectName);
};

program.command('storyboard <project>').action(async (project) => { await storyboard(project); });
program.command('voice <project>').action(async (project) => { await storyboard(project); await voice(project); });
program.command('chapters <project>').action(async (project) => { await chapters(project); });
program.command('avatar <project>').action(async (project) => { await storyboard(project); await voice(project); await avatar(project); });
program.command('slides <project>').action(async (project) => { await slides(project); });
program.command('render <project>').action(async (project) => {
  if (!(await fileExists(projectPaths(project).scene))) await storyboard(project);
  await renderProject(project);
});
program.command('build <project>').action(build);

await program.parseAsync(process.argv);
