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
    // Use the next scene's actual start as the cut boundary. This preserves
    // pauses inserted by TTS between paragraphs instead of silently dropping
    // them and drifting away from the master narration timeline.
    const boundary = timings[index + 1]?.start ?? timing.end;
    return {
      ...scene,
      durationInSeconds: Math.max(0.1, boundary - timing.start),
    };
  });
