import {copyFile, readFile, readdir, rm} from 'node:fs/promises';
import path from 'node:path';
import type {AvatarChapterManifest, AvatarChapterPlan} from '../core/chapters.js';
import {projectConfigSchema} from '../core/config.js';
import {ensureDir, fileExists, projectPaths, readText, sha256} from '../core/io.js';

export type RenderAssets = {
  narration?: string;
  avatar?: string;
  avatarChapters?: Array<{src: string; start: number; end: number}>;
  slides: string[];
};

type AssetFile = {source: string; fileName: string};

type CollectedAssets = {
  assets: RenderAssets;
  files: AssetFile[];
};

type AvatarMetadata = {
  provider?: string;
  strategy?: 'single' | 'chaptered';
  avatarId?: string;
};

type AvatarCacheIdentity = {
  strategy: 'single' | 'chaptered';
  avatarId: string;
  resolution: '720p' | '1080p' | '4k';
  chapterMaxSeconds: number;
  plan?: AvatarChapterPlan[];
};

const AVATAR_PRESENTATION_CACHE_VERSION = 'portrait-alpha-v2';
const HEYGEN_AVATAR_ASPECT_RATIO = '9:16';
const HEYGEN_OUTPUT_FORMAT = 'webm';

const readJson = async <T>(file: string): Promise<T | undefined> => {
  if (!(await fileExists(file))) return undefined;
  try {
    return JSON.parse(await readText(file)) as T;
  } catch {
    return undefined;
  }
};

export const avatarCacheKeyForNarration = (
  audio: Buffer,
  identity: AvatarCacheIdentity,
) => {
  if (identity.strategy === 'single') {
    const presentation = `single|${identity.avatarId}|${identity.resolution}|${HEYGEN_AVATAR_ASPECT_RATIO}|${HEYGEN_OUTPUT_FORMAT}|transparent`;
    return sha256(Buffer.concat([
      audio,
      Buffer.from(`|${presentation}|${AVATAR_PRESENTATION_CACHE_VERSION}`),
    ]));
  }

  if (!identity.plan) return undefined;
  return sha256(Buffer.concat([
    audio,
    Buffer.from(
      `|chaptered|${identity.avatarId}|${identity.resolution}|${HEYGEN_AVATAR_ASPECT_RATIO}|${HEYGEN_OUTPUT_FORMAT}|transparent|${AVATAR_PRESENTATION_CACHE_VERSION}|${identity.chapterMaxSeconds}|${JSON.stringify(identity.plan)}`,
    ),
  ]));
};

const findNarrationSource = async (paths: ReturnType<typeof projectPaths>) => {
  for (const source of [paths.narrationMp3, paths.narrationWav]) {
    if (await fileExists(source)) return source;
  }
  return undefined;
};

export const avatarMatchesCurrentNarration = async (projectName: string) => {
  const paths = projectPaths(projectName);
  const narrationSource = await findNarrationSource(paths);
  if (!narrationSource) return false;

  const [metadata, cache, config] = await Promise.all([
    readJson<AvatarMetadata>(paths.avatarMetadata),
    readJson<Record<string, string | undefined>>(paths.cache),
    readJson<unknown>(paths.config),
  ]);
  if (
    metadata?.provider !== 'heygen'
    || !metadata.strategy
    || !metadata.avatarId
    || !cache?.avatar
    || !config
  ) return false;

  const parsedConfig = projectConfigSchema.safeParse(config);
  if (!parsedConfig.success) return false;
  const audio = await readFile(narrationSource);
  const plan = metadata.strategy === 'chaptered'
    ? await readJson<AvatarChapterPlan[]>(paths.chapters)
    : undefined;
  const expected = avatarCacheKeyForNarration(audio, {
    strategy: metadata.strategy,
    avatarId: metadata.avatarId,
    resolution: parsedConfig.data.avatar.resolution,
    chapterMaxSeconds: parsedConfig.data.avatar.chapterMaxSeconds,
    plan,
  });
  return Boolean(expected && cache.avatar === expected);
};

export const readAvatarManifest = async (file: string): Promise<AvatarChapterManifest | undefined> => {
  if (!(await fileExists(file))) return undefined;
  try {
    return JSON.parse(await readText(file)) as AvatarChapterManifest;
  } catch {
    return undefined;
  }
};

export const avatarManifestIsComplete = async (
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

const publicAsset = (projectName: string, fileName: string) =>
  path.posix.join('generated', projectName, fileName);

const collectProjectAssets = async (
  projectName: string,
  includeTimedMedia: boolean,
): Promise<CollectedAssets> => {
  const paths = projectPaths(projectName);
  const assets: RenderAssets = {slides: []};
  const files: AssetFile[] = [];

  if (includeTimedMedia) {
    const narrationSource = await findNarrationSource(paths);
    if (narrationSource) {
      const fileName = path.basename(narrationSource);
      assets.narration = publicAsset(projectName, fileName);
      files.push({source: narrationSource, fileName});
    }

    const [manifest, metadata] = await Promise.all([
      readAvatarManifest(paths.avatarManifest),
      readJson<AvatarMetadata>(paths.avatarMetadata),
    ]);
    const singleExists = await fileExists(paths.avatar);
    const chapteredComplete = Boolean(manifest && await avatarManifestIsComplete(manifest, paths));
    const hasAnyAvatar = singleExists || chapteredComplete;
    const selectedAvatarAvailable = metadata?.strategy === 'chaptered'
      ? chapteredComplete
      : metadata?.strategy === 'single'
        ? singleExists
        : false;
    const avatarFresh = selectedAvatarAvailable && await avatarMatchesCurrentNarration(projectName);

    if (hasAnyAvatar && !avatarFresh) {
      console.warn('• avatar asset is stale or unverifiable for the current narration; omitting avatar media');
    } else if (avatarFresh && metadata?.strategy === 'chaptered' && manifest) {
      assets.avatarChapters = [];
      for (const chapter of manifest.chapters) {
        const source = path.join(paths.avatarChapters, chapter.videoFile);
        assets.avatarChapters.push({
          src: publicAsset(projectName, chapter.videoFile),
          start: chapter.start,
          end: chapter.end,
        });
        files.push({source, fileName: chapter.videoFile});
      }
    } else if (avatarFresh && metadata?.strategy === 'single') {
      assets.avatar = publicAsset(projectName, 'avatar.webm');
      files.push({source: paths.avatar, fileName: 'avatar.webm'});
    }
  }

  if (await fileExists(paths.slides)) {
    const slideFiles = (await readdir(paths.slides)).filter((file) => file.endsWith('.png')).sort();
    for (const fileName of slideFiles) {
      assets.slides.push(publicAsset(projectName, fileName));
      files.push({source: path.join(paths.slides, fileName), fileName});
    }
  }

  return {assets, files};
};

export const resolveProjectAssets = async (
  projectName: string,
  options: {includeTimedMedia?: boolean} = {},
) => (await collectProjectAssets(projectName, options.includeTimedMedia ?? true)).assets;

export const stageProjectAssets = async (
  projectName: string,
  options: {includeTimedMedia?: boolean} = {},
) => {
  const paths = projectPaths(projectName);
  const collected = await collectProjectAssets(projectName, options.includeTimedMedia ?? true);
  await rm(paths.publicGenerated, {recursive: true, force: true});
  await ensureDir(paths.publicGenerated);
  for (const file of collected.files) {
    await copyFile(file.source, path.join(paths.publicGenerated, file.fileName));
  }
  return collected.assets;
};

export const resolveGeneratedAssetSource = async (projectName: string, fileName: string) => {
  if (!fileName || path.basename(fileName) !== fileName) return undefined;
  const paths = projectPaths(projectName);
  const candidates = [
    path.join(paths.output, fileName),
    path.join(paths.avatarChapters, fileName),
    path.join(paths.slides, fileName),
  ];
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return undefined;
};
