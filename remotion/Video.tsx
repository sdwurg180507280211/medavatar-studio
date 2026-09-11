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
import type {PortraitPrototypeVisuals} from '../src/production/portraitPrototype';
import {
  getCompositionLayout,
  getPipSize,
  getRenderedAvatarLayout,
  getSceneAvatarLayout,
  getSubtitlePlacement,
  getVisualPanelRect,
} from './layout';
import {MedicalAnimationScene} from './medicalAnimations';
import {PortraitPrototypeVisualRenderer} from './portraitTemplates';

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
  prototypeVisuals?: PortraitPrototypeVisuals;
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
    ? metrics.pip.margin
    : width - metrics.pip.margin - pipSize;
  const pipTop = height - metrics.pip.margin - pipSize;

  const rect = {
    left: interpolate(pipMix, [0, 1], [heroLeft, pipLeft]),
    top: interpolate(pipMix, [0, 1], [heroTop, pipTop]),
    width: interpolate(pipMix, [0, 1], [metrics.hero.width, pipSize]),
    height: interpolate(pipMix, [0, 1], [metrics.hero.height, pipSize]),
  };
  const enter = spring({fps, frame:localFrame, config:{damping:18}});
  const morphing = morphingHeroToPip || morphingPipToHero;
  const enterScale = morphing ? 1 : interpolate(enter,[0,1],[0.975,1]);
  const borderWidth = Math.round(metrics.pip.border * pipMix);
  const radius = interpolate(pipMix, [0, 1], [metrics.hero.radius, pipSize / 2]);
  // The source is already a 9:16 portrait video. `object-fit: cover` does the
  // only crop needed for the circular PiP; an additional zoom or downward
  // object-position cuts off the presenter's hairline at the top of the mask.
  const videoScale = interpolate(pipMix, [0, 1], [1, 1.08]);
  const objectY = 0;
  const heroShadowAlpha = 0.34 * (1 - pipMix);
  const pipShadowAlpha = 0.38 * pipMix;
  const realPresenter = Boolean(avatarSrc);

  return (
    <div
      style={{
        position:'absolute',
        left:rect.left,
        top:rect.top,
        width:rect.width,
        height:rect.height,
        borderRadius:radius,
        overflow:'hidden',
        border:`${borderWidth}px solid rgba(255,255,255,.96)`,
        boxSizing:'border-box',
        boxShadow: realPresenter
          ? `0 18px 54px rgba(0,0,0,${pipShadowAlpha})`
          : `0 24px 70px rgba(0,0,0,${0.24 + 0.14 * pipMix})`,
        background:realPresenter ? 'transparent' : '#071826',
        opacity,
        transform:`scale(${enterScale})`,
        transformOrigin:pipMix > 0.5 ? 'center' : 'bottom center',
        display:'flex',
        alignItems:'center',
        justifyContent:'center',
        zIndex:20,
      }}
    >
      {avatarSrc ? (
        <OffthreadVideo
          src={staticFile(avatarSrc)}
          muted
          transparent
          style={{
            width:'100%',
            height:'100%',
            objectFit:'cover',
            objectPosition:`50% ${objectY}%`,
            transform:`scale(${videoScale})`,
            transformOrigin:`50% ${interpolate(pipMix,[0,1],[0,50])}%`,
            filter:`drop-shadow(0 28px 70px rgba(0,0,0,${heroShadowAlpha}))`,
          }}
        />
      ) : <MockDoctor />}
    </div>
  );
};

const ChapterAvatarClip: React.FC<{
  project: MedAvatarProject;
  avatarSrc: string;
  globalStartFrame: number;
  durationInFrames: number;
  fadeIn: boolean;
  fadeOut: boolean;
}> = ({project, avatarSrc, globalStartFrame, durationInFrames, fadeIn, fadeOut}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fadeFrames = Math.max(2, Math.min(Math.round(fps * 0.2), Math.floor(durationInFrames / 3)));
  let opacity = 1;
  if (fadeIn) opacity *= interpolate(frame,[0,fadeFrames],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  if (fadeOut) opacity *= interpolate(frame,[Math.max(0,durationInFrames-fadeFrames-1),Math.max(1,durationInFrames-1)],[1,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  return <AvatarClip project={project} avatarSrc={avatarSrc} globalStartFrame={globalStartFrame} opacity={opacity} />;
};

const AvatarTrack: React.FC<{project: MedAvatarProject; assets: RenderAssets}> = ({project, assets}) => {
  if (assets.avatarChapters?.length) {
    return <>{assets.avatarChapters.map((chapter,index) => {
      const from = Math.round(chapter.start * project.video.fps);
      const duration = Math.max(1,Math.round((chapter.end-chapter.start)*project.video.fps));
      return (
        <Sequence key={`${chapter.src}-${index}`} from={from} durationInFrames={duration} premountFor={project.video.fps}>
          <ChapterAvatarClip project={project} avatarSrc={chapter.src} globalStartFrame={from} durationInFrames={duration} fadeIn={index>0 && shouldMaskBoundary(project,from)} fadeOut={index<assets.avatarChapters!.length-1 && shouldMaskBoundary(project,from+duration)} />
        </Sequence>
      );
    })}</>;
  }
  return <AvatarClip project={project} avatarSrc={assets.avatar} />;
};

const SubtitleTrack: React.FC<{project: MedAvatarProject; captions: CaptionCue[]}> = ({project, captions}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const time = frame / fps;
  const {scene} = activeScene(project, frame);
  const mode = scene.subtitle?.mode ?? 'karaoke';
  if (mode === 'off') return null;
  const metrics = getCompositionLayout(width, height);
  const base = subtitlePresets[scene.subtitle?.style ?? 'medical'];
  const cue = captions.find((candidate) => candidate.sceneId === scene.id && time >= candidate.start - 0.02 && time < candidate.end + 0.06);
  const avatarLayout = getRenderedAvatarLayout(scene, width, height);
  const pipSize = getPipSize(width, height, scene.avatar?.scale ?? 0.28);
  const position = getSubtitlePlacement(width, height, avatarLayout, pipSize);
  const characters = cue?.characters;
  const fontScale = metrics.unit * (metrics.portrait ? 0.94 : 1);
  return (
    <div style={{position:'absolute', ...position, minHeight:Math.round(68*metrics.unit), boxSizing:'border-box', padding:`${Math.round(base.paddingY*metrics.unit)}px ${Math.round(base.paddingX*metrics.unit)}px`, borderRadius:Math.round(base.borderRadius*metrics.unit), background:base.background, backdropFilter:'blur(8px)', textAlign:'center', fontSize:Math.round(base.fontSize*fontScale), lineHeight:1.35, fontWeight:760, color:'#FFFFFF', textShadow:base.textShadow, zIndex:45}}>
      {characters ? characters.map((character,index) => {
        const active = mode === 'karaoke' && time >= character.start && time < character.end;
        const spoken = time >= character.end;
        const color = active ? base.active : character.keyword ? base.keyword : spoken || mode === 'sentence' ? '#FFFFFF' : base.pending;
        return <span key={`${index}-${character.start}`} style={{display:/\s/.test(character.text)?'inline':'inline-block', color, transform:active?'scale(1.08)':'scale(1)', transition:'none'}}>{character.text}</span>;
      }) : scene.text}
    </div>
  );
};

const Slide: React.FC<{scene: Scene; slideSrc?: string}> = ({scene, slideSrc}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const metrics = getCompositionLayout(width, height);
  const rect = getVisualPanelRect(width, height, scene.type, getSceneAvatarLayout(scene));
  const progress = spring({fps, frame, config:{damping:18}});
  const fontScale = metrics.unit * (metrics.portrait ? 0.84 : 1);
  const portraitSupport = metrics.portrait && scene.type === 'doctor_ppt';
  return (
    <div style={{position:'absolute', left:rect.left, top:rect.top, width:rect.width, height:rect.height, borderRadius:Math.round((portraitSupport ? 18 : 30)*metrics.unit), background:palette.panel, boxShadow:portraitSupport ? '0 16px 44px rgba(0,0,0,.3)' : '0 30px 90px rgba(0,0,0,.26)', overflow:'hidden', transform:`translateY(${interpolate(progress,[0,1],[Math.round((portraitSupport ? 20 : 45)*metrics.unit),0])}px)`, opacity:portraitSupport ? progress * 0.9 : progress, color:palette.text, zIndex:10}}>
      {slideSrc ? (
        <Img src={staticFile(slideSrc)} style={{width:'100%', height:'100%', objectFit:'contain', background:'#fff'}} />
      ) : (
        <div style={{padding:`${Math.round(70*fontScale)}px ${Math.round(80*fontScale)}px`}}>
          <div style={{fontSize:Math.round(26*fontScale), fontWeight:700, color:palette.blue, letterSpacing:Math.round(3*fontScale)}}>SLIDE {scene.slide ?? 1}</div>
          <div style={{fontSize:Math.round(64*fontScale), lineHeight:1.12, fontWeight:800, marginTop:Math.round(34*fontScale)}}>{scene.title ?? '医学科普要点'}</div>
          <div style={{fontSize:Math.round(42*fontScale), lineHeight:1.55, marginTop:Math.round(50*fontScale), color:palette.muted}}>{scene.text}</div>
        </div>
      )}
    </div>
  );
};

const SceneView: React.FC<{
  scene: Scene;
  slideSrc?: string;
  prototypeVisuals?: PortraitPrototypeVisuals;
  durationInFrames: number;
}> = ({scene, slideSrc, prototypeVisuals, durationInFrames}) => {
  const prototypeVisual = prototypeVisuals?.scenes[scene.id];
  return (
    <AbsoluteFill style={{background:`radial-gradient(circle at 50% 12%, #164765 0%, ${palette.background} 52%, #04101A 100%)`}}>
      {prototypeVisual ? <PortraitPrototypeVisualRenderer visual={prototypeVisual} durationInFrames={durationInFrames} /> : null}
      {!prototypeVisual && scene.type === 'doctor_ppt' ? <Slide scene={scene} slideSrc={slideSrc} /> : null}
      {!prototypeVisual && scene.type === 'medical_animation' ? <MedicalAnimationScene scene={scene} /> : null}
      {!prototypeVisual && scene.type === 'visual_full' ? <Slide scene={scene} slideSrc={slideSrc} /> : null}
      {!prototypeVisual && scene.type === 'doctor_full' ? <HeroTitle scene={scene} /> : null}
    </AbsoluteFill>
  );
};

const BottomFade: React.FC = () => {
  const {width, height} = useVideoConfig();
  const metrics = getCompositionLayout(width, height);
  return <div style={{position:'absolute', left:0, right:0, bottom:0, height:metrics.bottomFadeHeight, background:'linear-gradient(180deg, rgba(4,14,22,0) 0%, rgba(4,14,22,.72) 78%)', zIndex:25}} />;
};

export const MedAvatarVideo: React.FC<MedAvatarVideoProps> = ({
  project,
  assets={slides:[]} as RenderAssets,
  captions=[],
  prototypeVisuals,
}) => {
  let from = 0;
  return (
    <AbsoluteFill>
      {project.scenes.map((scene) => {
        const duration = Math.max(1,Math.round(scene.durationInSeconds*project.video.fps));
        const start = from;
        from += duration;
        const slideSrc = scene.slide ? assets.slides[scene.slide-1] : undefined;
        return (
          <Sequence key={scene.id} from={start} durationInFrames={duration} premountFor={project.video.fps}>
            <SceneView scene={scene} slideSrc={slideSrc} prototypeVisuals={prototypeVisuals} durationInFrames={duration} />
          </Sequence>
        );
      })}
      <AvatarTrack project={project} assets={assets} />
      <BottomFade />
      <SubtitleTrack project={project} captions={captions} />
      {assets.narration ? <Audio src={staticFile(assets.narration)} /> : null}
    </AbsoluteFill>
  );
};
