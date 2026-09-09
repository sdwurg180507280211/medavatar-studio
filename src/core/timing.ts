import type {Scene} from './schema.js';
import {sceneCharacterRanges} from './alignment.js';
import type {CharacterAlignment, TimingSegment} from '../providers/types.js';

export const sceneTimingsFromAlignment = (
  scenes: Scene[],
  fullText: string,
  alignment: CharacterAlignment,
): TimingSegment[] => {
  const ranges = sceneCharacterRanges(scenes, fullText);
  return scenes.map((scene, index) => {
    const range = ranges[index];
    const lastCharacterIndex = Math.max(range.startIndex, range.endIndex - 1);
    const start = alignment.character_start_times_seconds[range.startIndex] ?? 0;
    const end = alignment.character_end_times_seconds[lastCharacterIndex] ?? start + scene.durationInSeconds;
    return {text: scene.text, start, end};
  });
};

export const applyTimingsToScenes = (scenes: Scene[], timings: TimingSegment[]): Scene[] =>
  scenes.map((scene, index) => {
    const timing = timings[index];
    if (!timing) return scene;
    // Visual time starts at 0. For scene 1, include any TTS lead-in before the
    // first spoken character. Later cuts use the next scene's actual speech
    // start so paragraph pauses stay on the master narration timeline.
    const visualStart = index === 0 ? 0 : timing.start;
    const boundary = timings[index + 1]?.start ?? timing.end;
    return {
      ...scene,
      durationInSeconds: Math.max(0.1, boundary - visualStart),
    };
  });
