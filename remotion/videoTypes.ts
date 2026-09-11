import type {CaptionCue} from '../src/core/captions';
import type {MedAvatarProject} from '../src/core/schema';

export type RenderAssets = {
  narration?: string;
  avatar?: string;
  avatarChapters?: Array<{src: string; start: number; end: number}>;
  slides: string[];
};

export type MedAvatarVideoProps = {
  project: MedAvatarProject;
  assets?: RenderAssets;
  captions?: CaptionCue[];
};
