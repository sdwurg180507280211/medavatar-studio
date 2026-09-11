import type {Scene} from './schema.js';

export type SceneCharacterRange = {
  sceneId: string;
  startIndex: number;
  endIndex: number;
};

const findSubsequence = (haystack: string[], needle: string[], from: number) => {
  if (needle.length === 0) return from;
  outer: for (let i = from; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
};

export const sceneCharacterRanges = (
  scenes: Scene[],
  fullText: string,
): SceneCharacterRange[] => {
  const allCharacters = Array.from(fullText);
  let cursor = 0;
  return scenes.map((scene) => {
    const sceneCharacters = Array.from(scene.text);
    const startIndex = findSubsequence(allCharacters, sceneCharacters, cursor);
    if (startIndex < 0) {
      throw new Error(`Could not align scene text: ${scene.id}`);
    }
    const endIndex = startIndex + sceneCharacters.length;
    cursor = endIndex;
    return {sceneId: scene.id, startIndex, endIndex};
  });
};
