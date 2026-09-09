import type {Scene} from './schema.js';

export type AvatarChapterPlan = {
  id: string;
  sceneStartIndex: number;
  sceneEndIndex: number;
  start: number;
  end: number;
  duration: number;
  transitionHint: 'masked' | 'direct' | 'end';
};

export type AvatarChapterManifestEntry = AvatarChapterPlan & {
  videoFile: string;
  hash: string;
};

export type AvatarChapterManifest = {
  strategy: 'chaptered';
  chapters: AvatarChapterManifestEntry[];
};

const transitionScore = (current: Scene, next: Scene | undefined) => {
  if (!next) return 10;
  if (next.avatar?.layout === 'hidden') return 5;
  if (next.type === 'visual_full') return 5;
  if (next.type === 'doctor_ppt' || next.type === 'medical_animation') return 4;
  if (current.type === 'doctor_ppt' || current.type === 'medical_animation' || current.type === 'visual_full') return 3;
  if (next.avatar?.layout === 'bottom-left' || next.avatar?.layout === 'bottom-right') return 2;
  return 0;
};

export const planAvatarChapters = (
  scenes: Scene[],
  maxSeconds = 90,
): AvatarChapterPlan[] => {
  if (scenes.length === 0) return [];
  const starts: number[] = [];
  const ends: number[] = [];
  let cursor = 0;
  for (const scene of scenes) {
    starts.push(cursor);
    cursor += scene.durationInSeconds;
    ends.push(cursor);
  }

  const chapters: AvatarChapterPlan[] = [];
  let startIndex = 0;
  while (startIndex < scenes.length) {
    const chapterStart = starts[startIndex];
    let farthest = startIndex;
    while (
      farthest + 1 < scenes.length
      && ends[farthest + 1] - chapterStart <= maxSeconds
    ) {
      farthest += 1;
    }

    let chosen = farthest;
    if (farthest < scenes.length - 1) {
      const minimumPreferredDuration = maxSeconds * 0.62;
      let bestScore = -Infinity;
      for (let index = startIndex; index <= farthest; index += 1) {
        const duration = ends[index] - chapterStart;
        if (duration < minimumPreferredDuration && index !== farthest) continue;
        const score = transitionScore(scenes[index], scenes[index + 1]) * 1000 + duration;
        if (score > bestScore) {
          bestScore = score;
          chosen = index;
        }
      }
    }

    const end = ends[chosen];
    const hint = chosen === scenes.length - 1
      ? 'end'
      : transitionScore(scenes[chosen], scenes[chosen + 1]) >= 2
        ? 'masked'
        : 'direct';
    chapters.push({
      id: `chapter-${String(chapters.length + 1).padStart(3, '0')}`,
      sceneStartIndex: startIndex,
      sceneEndIndex: chosen + 1,
      start: chapterStart,
      end,
      duration: end - chapterStart,
      transitionHint: hint,
    });
    startIndex = chosen + 1;
  }
  return chapters;
};
