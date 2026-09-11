import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {
  avatarCacheKeyForNarration,
  avatarMatchesCurrentNarration,
  resolveProjectAssets,
} from './assets.js';
import {projectPaths, writeJson} from '../core/io.js';

const PROJECT = '__avatar-freshness-contract__';

const main = async () => {
  const paths = projectPaths(PROJECT);
  await rm(paths.root, {recursive: true, force: true});
  await mkdir(paths.output, {recursive: true});

  try {
    await writeJson(paths.config, {
      title: 'Avatar freshness contract',
      language: 'zh-CN',
      video: {width: 1080, height: 1920, fps: 25},
      voice: {provider: 'mock', modelId: 'eleven_multilingual_v2', outputFormat: 'mp3_44100_128'},
      avatar: {
        provider: 'heygen',
        resolution: '1080p',
        strategy: 'single',
        chapterMaxSeconds: 90,
        pollIntervalMs: 5000,
        timeoutMs: 1200000,
      },
      ppt: {file: 'slides.pptx'},
    });

    const originalNarration = Buffer.from('fresh-narration');
    await writeFile(paths.narrationWav, originalNarration);
    await writeFile(paths.avatar, Buffer.from('paid-avatar-placeholder'));
    await writeJson(paths.avatarMetadata, {
      provider: 'heygen',
      strategy: 'single',
      avatarId: 'contract-avatar',
    });

    const avatarKey = avatarCacheKeyForNarration(originalNarration, {
      strategy: 'single',
      avatarId: 'contract-avatar',
      resolution: '1080p',
      chapterMaxSeconds: 90,
    });
    if (!avatarKey) throw new Error('single avatar cache key must be generated');
    await writeJson(paths.cache, {avatar: avatarKey});

    if (!(await avatarMatchesCurrentNarration(PROJECT))) {
      throw new Error('matching avatar cache key must be fresh');
    }
    const freshAssets = await resolveProjectAssets(PROJECT);
    if (!freshAssets.avatar) {
      throw new Error('fresh avatar must be available to render props');
    }

    await writeFile(paths.narrationWav, Buffer.concat([
      await readFile(paths.narrationWav),
      Buffer.from('-changed'),
    ]));
    if (await avatarMatchesCurrentNarration(PROJECT)) {
      throw new Error('changed narration must make the avatar stale');
    }
    const staleAssets = await resolveProjectAssets(PROJECT);
    if (staleAssets.avatar || staleAssets.avatarChapters?.length) {
      throw new Error('stale avatar must be omitted from render assets');
    }

    console.log('✓ avatar freshness contract: matching narration accepted, stale avatar omitted');
  } finally {
    await rm(paths.root, {recursive: true, force: true});
  }
};

await main();
