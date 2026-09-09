import type {MedAvatarProject, SceneType} from './core/schema.js';

const TYPES: SceneType[] = [
  'doctor_full',
  'doctor_ppt',
  'medical_animation',
  'doctor_ppt',
];

const estimateDuration = (text: string) => {
  const latinWords = text.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  const cjkChars = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const seconds = latinWords / 2.6 + cjkChars / 4.2;
  return Math.max(3, Math.round(seconds * 10) / 10);
};

export const scriptToStoryboard = (
  title: string,
  script: string,
): MedAvatarProject => {
  const paragraphs = script
    .split(/\n\s*\n/g)
    .map((part) => part.replace(/^#+\s*/g, '').trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    throw new Error('script.md is empty.');
  }

  return {
    version: '1.0',
    title,
    video: {width: 1920, height: 1080, fps: 25},
    scenes: paragraphs.map((text, index) => {
      const type = TYPES[index % TYPES.length];
      const isPpt = type === 'doctor_ppt';
      const isAnimation = type === 'medical_animation';
      return {
        id: `scene-${String(index + 1).padStart(3, '0')}`,
        type,
        text,
        durationInSeconds: estimateDuration(text),
        slide: isPpt ? Math.ceil((index + 1) / 2) : undefined,
        avatar:
          type === 'visual_full'
            ? {layout: 'hidden' as const, scale: 0.3}
            : isPpt || isAnimation
              ? {layout: 'bottom-right' as const, scale: 0.28}
              : {layout: 'fullscreen' as const, scale: 1},
        animation: isAnimation
          ? {name: 'artery-pressure', keywords: ['血管', '压力']}
          : undefined,
      };
    }),
  };
};
