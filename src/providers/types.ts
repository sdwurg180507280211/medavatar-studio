export type TimingSegment = {
  text: string;
  start: number;
  end: number;
};

export type NarrationResult = {
  audioPath: string;
  durationInSeconds: number;
  segments: TimingSegment[];
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
  }): Promise<{videoPath: string}>;
}
