import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type {CaptionCue} from '../src/core/captions';
import type {MedAvatarProject, Scene, SubtitleStyle} from '../src/core/schema';
import {
  getCompositionLayout,
  getPipSize,
  getRenderedAvatarLayout,
  getSceneAvatarLayout,
  getSubtitlePlacement,
  getVisualPanelRect,
} from './layout';
import {MedicalAnimationScene} from './medicalAnimations';
import {VisualRenderer} from './VisualRenderer';

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

const palette = {
  background: '#071826',
  panel: '#F8FBFD',
  text: '#102A43',
  muted: '#5C7083',
  blue: '#2A74FF',
};

const subtitlePresets: Record<SubtitleStyle, {
  fontSize: number;
  background: string;
  paddingY: number;
  paddingX: number;
  borderRadius: number;
  textShadow: string;
  active: string;
  keyword: string;
  pending: string;
}> = {
  medical: {
    fontSize: 40,
    background: 'rgba(4,14,22,.72)',
    paddingY: 14,
    paddingX: 26,
    borderRadius: 20,
    textShadow: '0 3px 14px rgba(0,0,0,.45)',
    active: '#FFE082',
    keyword: '#63E5E7',
    pending: 'rgba(255,255,255,.62)',
  },
  minimal: {
    fontSize: 36,
    background: 'rgba(4,14,22,.20)',
    paddingY: 9,
    paddingX: 18,
    borderRadius: 12,
    textShadow: '0 3px 16px rgba(0,0,0,.72)',
    active: '#FFFFFF',
    keyword: '#8CE8EA',
    pending: 'rgba(255,255,255,.72)',
  },
  social: {
    fontSize: 48,
    background: 'rgba(3,10,16,.84)',
    paddingY: 17,
    paddingX: 30,
    borderRadius: 18,
    textShadow: '0 3px 12px rgba(0,0,0,.55)',
    active: '#FFD54F',
    keyword: '#73F4DF',
    pending: 'rgba(255,255,255,.58)',
  },
};

const MockDoctor: React.FC = () => (
  <div style={{width:'62%', height:'72%', borderRadius:'48% 48% 24% 24% / 28% 28% 12% 12%', background:'linear-gradient(180deg,#EEF7FB 0%,#DCEBF4 45%,#FFFFFF 45%,#FFFFFF 100%)', border:'5px solid rgba(255,255,255,.86)', boxShadow:'0 24px 70px rgba(0,0,0,.24)', position:'relative'}}>
    <div style={{position:'absolute', width:'42%', aspectRatio:'1', borderRadius:'50%', left:'29%', top:'-25%', background:'#E7C5AD', border:'8px solid #243746'}} />
    <div style={{position:'absolute', left:'15%', right:'15%', top:'48%', height:6, background:'#B9D7EA'}} />
    <div style={{position:'absolute', right:'11%', top:'56%', fontSize:24, fontWeight:700, color:palette.blue}}>MED</div>
  </div>
);

const activeScene = (project: MedAvatarProject, frame: number) => {
  let cursor = 0;
  for (let index = 0; index < project.scenes.length; index += 1) {
    const scene = project.scenes[index];
    const durationInFrames = Math.max(1, Math.round(scene.durationInSeconds * project.video.fps));
    if (frame < cursor + durationInFrames) {
      return {
        scene,
        index,
        startFrame: cursor,
        localFrame: frame - cursor,
        durationInFrames,
      };
    }
    cursor += durationInFrames;
  }
  const index = Math.max(0, project.scenes.length - 1);
  const scene = project.scenes[index]!;
  return {scene, index, startFrame: cursor, localFrame: 0, durationInFrames: 1};
};

const sceneMasksAvatarReset = (scene: Scene | undefined) => {
  if (!scene) return false;
  const layout = getSceneAvatarLayout(scene);
  return layout === 'hidden' || layout === 'bottom-left' || layout === 'bottom-right';
};

const shouldMaskBoundary = (project: MedAvatarProject, boundaryFrame: number) => {
  if (boundaryFrame <= 0) return false;
  const previous = activeScene(project, Math.max(0, boundaryFrame - 1)).scene;
  const next = activeScene(project, boundaryFrame).scene;
  return sceneMasksAvatarReset(previous) || sceneMasksAvatarReset(next);
};

const HeroTitle: React.FC<{scene: Scene}> = ({scene}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  if (!scene.title) return null;
  const layout = getCompositionLayout(width, height);
  const titleIn = spring({fps, frame, delay: 2, config:{damping:18, stiffness:120}});
  const accentIn = spring({fps, frame, delay: 9, config:{damping:20, stiffness:140}});
  const opacity = interpolate(frame, [0, 10], [0, 1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});

  return (
    <div style={{position:'absolute', left:layout.title.side, right:layout.title.side, top:layout.title.top, zIndex:34, display:'flex', flexDirection:'column', alignItems:'center', pointerEvents:'none'}}>
      <div style={{maxWidth:layout.title.maxWidth, textAlign:'center', fontSize:layout.title.fontSize, lineHeight:1.12, fontWeight:850, letterSpacing:layout.unit, color:'#FFFFFF', textShadow:'0 8px 28px rgba(0,0,0,.42)', opacity, transform:`translateY(${interpolate(titleIn,[0,1],[layout.title.enterOffset,0])}px) scale(${interpolate(titleIn,[0,1],[0.98,1])})`}}>
        {scene.title}
      </div>
      <div style={{width:interpolate(accentIn,[0,1],[0,layout.title.accentWidth]), height:layout.title.accentHeight, marginTop:layout.title.accentMarginTop, borderRadius:999, background:'linear-gradient(90deg, rgba(99,229,231,.15), #63E5E7, #2A74FF, rgba(42,116,255,.12))', boxShadow:'0 0 24px rgba(99,229,231,.36)'}} />
    </div>
  );
};

const isPipLayout = (layout: ReturnType<typeof getSceneAvatarLayout>) =>
  layout === 'bottom-left' || layout === 'bottom-right';

const AvatarClip: React.FC<{
  project: MedAvatarProject;
  avatarSrc?: string;
  globalStartFrame?: number;
  opacity?: number;
}> = ({project, avatarSrc, globalStartFrame = 0, opacity = 1}) => {
  const clipFrame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const metrics = getCompositionLayout(width, height);
  const globalFrame = clipFrame + globalStartFrame;
  const active = activeScene(project, globalFrame);
  const {scene, localFrame, index} = active;
  const layout = getRenderedAvatarLayout(scene, width, height);
  if (layout === 'hidden') return null;

  const previousScene = index > 0 ? project.scenes[index - 1] : undefined;
  const previousLayout = previousScene ? getRenderedAvatarLayout(previousScene, width, height) : undefined;
  const currentPip = isPipLayout(layout);
  const previousPip = previousLayout ? isPipLayout(previousLayout) : false;
  const transitionFrames = Math.max(6, Math.round(fps * 0.4));
  const transitionProgress = interpolate(
    localFrame,
    [0, transitionFrames],
    [0, 1],
    {extrapolateLeft:'clamp', extrapolateRight:'clamp'},
  );
  const morphingHeroToPip = metrics.portrait && currentPip && previousLayout === 'hero';
  const morphingPipToHero = metrics.portrait && layout === 'hero' && previousPip;
  const pipMix = morphingHeroToPip
    ? transitionProgress
    : morphingPipToHero
      ? 1 - transitionProgress
      : currentPip ? 1 : 0;

  const pipScene = currentPip ? scene : previousPip ? previousScene! : scene;
  const pipLayout = currentPip
    ? layout
    : previousPip
      ? previousLayout!
      : 'bottom-right';
  const pipSize = getPipSize(width, height, pipScene.avatar?.scale ?? 0.28);
  const heroLeft = Math.round((width - metrics.hero.width) / 2);
  const heroTop = metrics.hero.top;
  const pipLeft = pipLayout === 'bottom-left'
    ? metrics.pip.marg