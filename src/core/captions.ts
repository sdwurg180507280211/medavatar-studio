import {sceneCharacterRanges} from './alignment.js';
import type {Scene, SubtitleMode} from './schema.js';
import type {CharacterAlignment} from '../providers/types.js';

export type CaptionCharacter = {
  text: string;
  start: number;
  end: number;
  keyword: boolean;
};

export type CaptionCue = {
  sceneId: string;
  mode: Exclude<SubtitleMode, 'off'>;
  text: string;
  start: number;
  end: number;
  characters: CaptionCharacter[];
};

type TextRange = {start: number; end: number};

const BREAK_RE = /[。！？!?；;，,、：:\n]/;

const trimmedRange = (characters: string[], start: number, end: number): TextRange | null => {
  let left = start;
  let right = end;
  while (left < right && /\s/.test(characters[left])) left += 1;
  while (right > left && /\s/.test(characters[right - 1])) right -= 1;
  return left < right ? {start: left, end: right} : null;
};

const captionRanges = (text: string, maxCharacters = 14): TextRange[] => {
  const characters = Array.from(text);
  const ranges: TextRange[] = [];
  let start = 0;
  for (let index = 0; index < characters.length; index += 1) {
    const length = index - start + 1;
    const shouldBreak = (BREAK_RE.test(characters[index]) && length >= 4) || length >= maxCharacters;
    if (!shouldBreak) continue;
    const range = trimmedRange(characters, start, index + 1);
    if (range) ranges.push(range);
    start = index + 1;
  }
  const tail = trimmedRange(characters, start, characters.length);
  if (tail) ranges.push(tail);
  return ranges;
};

const keywordMask = (text: string, keywords: string[]) => {
  const characters = Array.from(text);
  const normalized = characters.map((character) => character.toLocaleLowerCase());
  const mask = Array.from({length: characters.length}, () => false);
  const orderedKeywords = [...keywords].filter(Boolean).sort((a, b) => Array.from(b).length - Array.from(a).length);
  for (const keyword of orderedKeywords) {
    const needle = Array.from(keyword).map((character) => character.toLocaleLowerCase());
    if (needle.length === 0) continue;
    for (let index = 0; index <= normalized.length - needle.length; index += 1) {
      let matches = true;
      for (let offset = 0; offset < needle.length; offset += 1) {
        if (normalized[index + offset] !== needle[offset]) {
          matches = false;
          break;
        }
      }
      if (!matches) continue;
      for (let offset = 0; offset < needle.length; offset += 1) mask[index + offset] = true;
    }
  }
  return mask;
};

const buildSceneCues = (
  scene: Scene,
  timeAt: (localCharacterIndex: number) => {start: number; end: number},
  maxCharacters: number,
): CaptionCue[] => {
  const mode = scene.subtitle?.mode ?? 'karaoke';
  if (mode === 'off') return [];
  const characters = Array.from(scene.text);
  const keywords = scene.subtitle?.keywords ?? scene.animation?.keywords ?? [];
  const mask = keywordMask(scene.text, keywords);

  return captionRanges(scene.text, maxCharacters).map((range) => {
    const timedCharacters = characters.slice(range.start, range.end).map((text, offset) => {
      const localIndex = range.start + offset;
      const timing = timeAt(localIndex);
      return {
        text,
        start: timing.start,
        end: timing.end,
        keyword: mask[localIndex] ?? false,
      };
    });
    return {
      sceneId: scene.id,
      mode,
      text: timedCharacters.map((character) => character.text).join(''),
      start: timedCharacters[0]?.start ?? 0,
      end: timedCharacters.at(-1)?.end ?? 0,
      characters: timedCharacters,
    };
  });
};

export const captionCuesFromAlignment = (
  scenes: Scene[],
  fullText: string,
  alignment: CharacterAlignment,
  maxCharacters = 14,
): CaptionCue[] => {
  const ranges = sceneCharacterRanges(scenes, fullText);
  let fallbackSceneStart = 0;
  const cues: CaptionCue[] = [];

  scenes.forEach((scene, sceneIndex) => {
    const range = ranges[sceneIndex];
    const sceneCharacterCount = Math.max(1, range.endIndex - range.startIndex);
    cues.push(...buildSceneCues(scene, (localIndex) => {
      const absoluteIndex = range.startIndex + localIndex;
      const fallbackStart = fallbackSceneStart + (localIndex / sceneCharacterCount) * scene.durationInSeconds;
      const fallbackEnd = fallbackSceneStart + ((localIndex + 1) / sceneCharacterCount) * scene.durationInSeconds;
      return {
        start: alignment.character_start_times_seconds[absoluteIndex] ?? fallbackStart,
        end: alignment.character_end_times_seconds[absoluteIndex] ?? fallbackEnd,
      };
    }, maxCharacters));
    fallbackSceneStart += scene.durationInSeconds;
  });

  return cues;
};

export const captionCuesFromSceneDurations = (
  scenes: Scene[],
  maxCharacters = 14,
): CaptionCue[] => {
  let sceneStart = 0;
  const cues: CaptionCue[] = [];
  for (const scene of scenes) {
    const characters = Array.from(scene.text);
    const count = Math.max(1, characters.length);
    cues.push(...buildSceneCues(scene, (localIndex) => ({
      start: sceneStart + (localIndex / count) * scene.durationInSeconds,
      end: sceneStart + ((localIndex + 1) / count) * scene.durationInSeconds,
    }), maxCharacters));
    sceneStart += scene.durationInSeconds;
  }
  return cues;
};
