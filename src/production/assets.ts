import {copyFile, readdir, rm} from 'node:fs/promises';
import path from 'node:path';
import type {AvatarChapterManifest, AvatarChapterPlan} from '../core/chapters.js';
import {ensureDir, fileExists, projectPaths, readText} from '../core/io.js';

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
    for (const source of [paths.narrationMp3, paths.narrationWav]) {
      if (!(await fileExists(source))) continue;
      const fileName = path.basename(source);
      assets.narration = publicAsset(projectName, fileName);
      files.push({source, fileName});
      break;
    }

    const manifest = await readAvatarManifest(paths.avatarManifest);
    if (manifest && await avatarManifestIsComplete(manifest, paths)) {
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
    } else if (await fileExists(paths.avatar)) {
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
