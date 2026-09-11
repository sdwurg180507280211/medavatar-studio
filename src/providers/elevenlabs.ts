import {writeFile} from 'node:fs/promises';
import type {CharacterAlignment, NarrationResult, TtsProvider} from './types.js';

export class ElevenLabsTtsProvider implements TtsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly voiceId: string,
    private readonly modelId = 'eleven_multilingual_v2',
    private readonly outputFormat = 'mp3_44100_128',
  ) {}

  async synthesize({text, outputPath}: {text: string; outputPath: string}): Promise<NarrationResult> {
    const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.voiceId)}/with-timestamps`);
    url.searchParams.set('output_format', this.outputFormat);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: this.modelId,
      }),
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as {
      audio_base64: string;
      alignment?: CharacterAlignment | null;
      normalized_alignment?: CharacterAlignment | null;
    };

    await writeFile(outputPath, Buffer.from(data.audio_base64, 'base64'));
    const alignment = data.alignment ?? undefined;
    const durationInSeconds = alignment?.character_end_times_seconds.at(-1) ?? 0;
    return {
      audioPath: outputPath,
      durationInSeconds,
      segments: [{text, start: 0, end: durationInSeconds}],
      alignment,
    };
  }
}
