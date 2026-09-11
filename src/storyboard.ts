import {sceneIdSchema} from './core/schema.js';
import type {AvatarLayout, MedAvatarProject, SceneType, SubtitleMode, SubtitleStyle} from './core/schema.js';

const DEFAULT_TYPES: SceneType[] = [
  'doctor_full',
  'doctor_ppt',
  'medical_animation',
  'doctor_full',
];

const SCENE_TYPES = new Set<SceneType>([
  'doctor_full',
  'doctor_ppt',
  'medical_animation',
  'visual_full',
]);

const AVATAR_LAYOUTS = new Set<AvatarLayout>(['hero', 'fullscreen', 'bottom-right', 'bottom-left', 'hidden']);
const SUBTITLE_MODES = new Set<SubtitleMode>(['off', 'sentence', 'karaoke']);
const SUBTITLE_STYLES = new Set<SubtitleStyle>(['medical', 'minimal', 'social']);

type SceneDirective = {
  id?: string;
  type?: SceneType;
  slide?: number;
  avatar?: AvatarLayout;
  scale?: number;
  animation?: string;
  keywords?: string[];
  subtitle?: SubtitleMode;
  subtitleStyle?: SubtitleStyle;
  duration?: number;
};

const estimateDuration = (text: string) => {
  const latinWords = text.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  const cjkChars = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const seconds = latinWords / 2.6 + cjkChars / 4.2;
  return Math.max(3, Math.round(seconds * 10) / 10);
};

const positiveNumber = (value: string, field: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid medavatar directive ${field}=${value}`);
  }
  return parsed;
};

const parseDirective = (raw: string): SceneDirective => {
  const directive: SceneDirective = {};
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const separator = token.indexOf('=');
    if (separator < 1) throw new Error(`Invalid medavatar directive token: ${token}`);
    const key = token.slice(0, separator).toLowerCase();
    const value = token.slice(separator + 1);
    if (key === 'id') {
      const parsed = sceneIdSchema.safeParse(value);
      if (!parsed.success) throw new Error(`Invalid scene id: ${value}`);
      directive.id = parsed.data;
    } else if (key === 'type') {
      if (!SCENE_TYPES.has(value as SceneType)) throw new Error(`Unknown scene type: ${value}`);
      directive.type = value as SceneType;
    } else if (key === 'slide') {
      directive.slide = Math.round(positiveNumber(value, 'slide'));
    } else if (key === 'avatar') {
      if (!AVATAR_LAYOUTS.has(value as AvatarLayout)) throw new Error(`Unknown avatar layout: ${value}`);
      directive.avatar = value as AvatarLayout;
    } else if (key === 'scale') {
      const scale = positiveNumber(value, 'scale');
      if (scale > 1) throw new Error('medavatar scale must be <= 1');
      directive.scale = scale;
    } else if (key === 'animation') {
      directive.animation = value;
    } else if (key === 'keywords') {
      directive.keywords = value.split(',').map((item) => item.trim()).filter(Boolean);
    } else if (key === 'subtitle') {
      if (!SUBTITLE_MODES.has(value as SubtitleMode)) throw new Error(`Unknown subtitle mode: ${value}`);
      directive.subtitle = value as SubtitleMode;
    } else if (key === 'subtitle_style' || key === 'subtitle-style') {
      if (!SUBTITLE_STYLES.has(value as SubtitleStyle)) throw new Error(`Unknown subtitle style: ${value}`);
      directive.subtitleStyle = value as SubtitleStyle;
    } else if (key === 'duration') {
      directive.duration = positiveNumber(value, 'duration');
    } else {
      throw new Error(`Unknown medavatar directive key: ${key}`);
    }
  }
  return directive;
};

const scriptBlocks = (script: string) => {
  const blocks: Array<{text: string; directive: SceneDirective; title?: string}> = [];
  let pending: SceneDirective = {};
  let pendingTitle: string | undefined;

  for (const rawBlock of script.split(/\n\s*\n/g)) {
    let block = rawBlock.trim();
    if (!block) continue;

    const directiveMatch = block.match(/^<!--\s*medavatar:([\s\S]*?)-->\s*/i);
    if (directiveMatch) {
      pending = {...pending, ...parseDirective(directiveMatch[1])};
      block = block.slice(directiveMatch[0].length).trim();
      if (!block) continue;
    }

    const headingMatch = block.match(/^#{1,6}\s+([^\n]+)(?:\n+|$)/);
    if (headingMatch) {
      pendingTitle = headingMatch[1].trim();
      block = block.slice(headingMatch[0].length).trim();
      if (!block) continue;
    }

    blocks.push({text: block, directive: pending, title: pendingTitle});
    pending = {};
    pendingTitle = undefined;
  }

  return blocks;
};

export const scriptToStoryboard = (
  title: string,
  script: string,
  video: MedAvatarProject['video'] = {width: 1080, height: 1920, fps: 25},
): MedAvatarProject => {
  const blocks = scriptBlocks(script);
  if (blocks.length === 0) throw new Error('script.md has no narration paragraphs.');

  const portrait = video.height > video.width;
  let nextSlide = 1;
  const scenes = blocks.map(({text, directive, title: sceneHeading}, index) => {
    const type = directive.type ?? DEFAULT_TYPES[index % DEFAULT_TYPES.length];
    const hasSlide = type === 'doctor_ppt' || type === 'visual_full';
    const isAnimation = type === 'medical_animation';
    let slide = directive.slide;
    if (hasSlide && slide === undefined) slide = nextSlide;
    if (slide !== undefined) nextSlide = Math.max(nextSlide, slide + 1);

    const defaultLayout: AvatarLayout = type === 'visual_full'
      ? 'hidden'
      : type === 'doctor_ppt' && portrait
        ? 'hero'
        : hasSlide || isAnimation
          ? 'bottom-right'
          : 'hero';
    const layout = directive.avatar ?? defaultLayout;
    const defaultScale = layout === 'hero' || layout === 'fullscreen' ? 1 : 0.28;
    const defaultKeywords = isAnimation ? ['血管', '压力'] : [];
    const keywords = directive.keywords ?? defaultKeywords;
    const sceneTitle = sceneHeading ?? (index === 0 ? title : undefined);

    return {
      id: directive.id ?? `scene-${String(index + 1).padStart(3, '0')}`,
      type,
      title: sceneTitle,
      text,
      durationInSeconds: directive.duration ?? estimateDuration(text),
      slide,
      avatar: {
        layout,
        scale: directive.scale ?? defaultScale,
      },
      subtitle: {
        mode: directive.subtitle ?? 'karaoke',
        style: directive.subtitleStyle ?? 'medical',
        keywords,
      },
      animation: isAnimation
        ? {
            name: directive.animation ?? 'artery-pressure',
            keywords,
          }
        : undefined,
    };
  });

  const seen = new Set<string>();
  for (const scene of scenes) {
    if (seen.has(scene.id)) throw new Error(`Duplicate medavatar scene id: ${scene.id}`);
    seen.add(scene.id);
  }

  return {
    version: '1.0',
    title,
    video,
    scenes,
  };
};
