export type TimingSegment = {
  text: string;
  start: number;
  end: number;
};

export type CharacterAlignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

export type NarrationResult = {
  audioPath: string;
  durationInSeconds: number;
  segments: TimingSegment[];
  alignment?: CharacterAlignment;
};

export interface TtsProvider {
  synthesize(input: {
    text: string;
    outputPath: string;
  }): Promise<NarrationResult>;
}

export interface AvatarProvider {
  render(input: {
    audioPath: string;
    outputPath: string;
    title?: string;
  }): Promise<{videoPath: string; videoId?: string; assetId?: string}>;
}
