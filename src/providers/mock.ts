import {writeFile} from 'node:fs/promises';
import type {AvatarProvider, NarrationResult, TtsProvider} from './types.js';

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
    const parts = text.split(/(?<=[。！？!?])\s*/).map((x) => x.trim()).filter(Boolean);
    const segments = [];
    let cursor = 0;
    for (const part of parts) {
      const duration = Math.max(1.2, (part.match(/[\u3400-\u9fff]/g)?.length ?? part.length) / 4.2);
      segments.push({text: part, start: cursor, end: cursor + duration});
      cursor += duration;
    }
    await writeSilentWav(outputPath, Math.max(1, cursor));
    return {audioPath: outputPath, durationInSeconds: cursor, segments};
  }
}

export class MockAvatarProvider implements AvatarProvider {
  async render({outputPath}: {audioPath: string; outputPath: string}) {
    return {videoPath: outputPath};
  }
}
