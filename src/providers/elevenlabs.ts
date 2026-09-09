import {writeFile} from 'node:fs/promises';
import type {NarrationResult, TtsProvider} from './types.js';

export class ElevenLabsTtsProvider implements TtsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly voiceId: string,
  ) {}

  async synthesize({text, outputPath}: {text: string; outputPath: string}): Promise<NarrationResult> {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/with-timestamps`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          output_format: 'mp3_44100_128',
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as {
      audio_base64: string;
      alignment?: {
        characters: string[];
        character_start_times_seconds: number[];
        character_end_times_seconds: number[];
      };
    };

    await writeFile(outputPath, Buffer.from(data.audio_base64, 'base64'));
    const alignment = data.alignment;
    const durationInSeconds = alignment?.character_end_times_seconds.at(-1) ?? 0;
    return {
      audioPath: outputPath,
      durationInSeconds,
      segments: alignment
        ? [{text, start: alignment.character_start_times_seconds[0] ?? 0, end: durationInSeconds}]
        : [],
    };
  }
}
