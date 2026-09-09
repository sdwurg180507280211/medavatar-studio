import type {Scene} from './schema.js';
import type {CharacterAlignment, TimingSegment} from '../providers/types.js';

export const sceneTimingsFromAlignment = (
  scenes: Scene[],
  fullText: string,
  alignment: CharacterAlignment,
): TimingSegment[] => {
  let cursor = 0;
  return scenes.map((scene) => {
    const startIndex = fullText.indexOf(scene.text, cursor);
    if (startIndex < 0) {
      throw new Error(`Could not align scene text: ${scene.id}`);
    }
    const endIndex = startIndex + scene.text.length - 1;
    cursor = endIndex + 1;
    const start = alignment.character_start_times_seconds[startIndex] ?? 0;
    const end = alignment.character_end_times_seconds[endIndex] ?? start + scene.durationInSeconds;
    return {text: scene.text, start, end};
  });
};

export const applyTimingsToScenes = (scenes: Scene[], timings: TimingSegment[]): Scene[] =>
  scenes.map((scene, index) => ({
    ...scene,
    durationInSeconds: Math.max(0.1, (timings[index]?.end ?? scene.durationInSeconds) - (timings[index]?.start ?? 0)),
  }));
