import {writeFile} from 'node:fs/promises';
import type {AvatarProvider, CharacterAlignment, NarrationResult, TtsProvider} from './types.js';

const writeSilentWav = async (file: string, durationSeconds: number) => {
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = Math.ceil(durationSeconds * sampleRate * channels * bytesPerSample);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  await writeFile(file, buffer);
};

export class MockTtsProvider implements TtsProvider {
  async synthesize({text, outputPath}: {text: string; outputPath: string}): Promise<NarrationResult> {
    const characters = [...text];
    const starts: number[] = [];
    const ends: number[] = [];
    let cursor = 0;
    for (const char of characters) {
      const duration = /[\u3400-\u9fff]/.test(char) ? 1 / 4.2 : /\s/.test(char) ? 0.04 : 0.08;
      starts.push(cursor);
      cursor += duration;
      ends.push(cursor);
    }
    const alignment: CharacterAlignment = {
      characters,
      character_start_times_seconds: starts,
      character_end_times_seconds: ends,
    };
    await writeSilentWav(outputPath, Math.max(1, cursor));
    return {
      audioPath: outputPath,
      durationInSeconds: cursor,
      segments: [{text, start: 0, end: cursor}],
      alignment,
    };
  }
}

export class MockAvatarProvider implements AvatarProvider {
  async render({outputPath}: {audioPath: string; outputPath: string}) {
    return {videoPath: outputPath};
  }
}
