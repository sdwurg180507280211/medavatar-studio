import React from 'react';
import {
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type {MedAvatarProject, Scene} from '../src/core/schema';
import {
  getCompositionLayout,
  getPipSize,
  getRenderedAvatarLayout,
  getSceneAvatarLayout,
} from './layout';
import type {RenderAssets} from './videoTypes';

const MockDoctor: React.FC = () => (
  <div style={{width:'62%', height:'72%', borderRadius:'48% 48% 24% 24% / 28% 28% 12% 12%', background:'linear-gradient(180deg,#EEF7FB 0%,#DCEBF4 45%,#FFFFFF 45%,#FFFFFF 100%)', border:'5px solid rgba(255,255,255,.86)', boxShadow:'0 24px 70px rgba(0,0,0,.24)', position:'relative'}}>
    <div style={{position:'absolute', width:'42%', aspectRatio:'1', borderRadius:'50%', left:'29%', top:'-25%', background:'#E7C5AD', border:'8px solid #243746'}} />
    <div style={{position:'absolute', left:'15%', right:'15%', top:'48%', height:6, background:'#B9D7EA'}} />
    <div style={{position:'absolute', right:'11%', top:'56%', fontSize:24, fontWeight:700, color:'#2A74FF'}}>MED</div>
  </div>
);

export const activeScene = (project: MedAvatarProject, frame: number) => {
  let cursor = 0;
  for (let index = 0; index < project.scenes.length; index += 1) {
    const scene = project.scenes[index];
    const durationInFrames = Math.max(1, Math.round(scene.durationInSeconds * project.video.fps));
    if (frame < cursor + durationInFrames) {
      return {scene, index, startFrame: cursor, localFrame: frame - cursor, durationInFrames};
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
  const videoScale = interpolate(pipMix, [0, 1], [1, 1.08]);
  const objectY = 0;
  const heroShadowAlpha = 0.34 * (1 - pipMix);
  const pipShadowAlpha = 0.38 * pipMix;
  const realPresenter = Boolean(avatarSrc);

  return (
    <div style={{position:'absolute', left:rect.left, top:rect.top, width:rect.width, height:rect.height, borderRadius:radius, overflow:'hidden', border:`${borderWidth}px solid rgba(255,255,255,.96)`, boxSizing:'border-box', boxShadow:realPresenter ? `0 18px 54px rgba(0,0,0,${pipShadowAlpha})` : `0 24px 70px rgba(0,0,0,${0.24 + 0.14 * pipMix})`, background:realPresenter ? 'transparent' : '#071826', opacity, transform:`scale(${enterScale})`, transformOrigin:pipMix > 0.5 ? 'center' : 'bottom center', display:'flex', alignItems:'center', justifyContent:'center', zIndex:20}}>
      {avatarSrc ? (
        <OffthreadVideo
          src={staticFile(avatarSrc)}
          muted
          transparent
          style={{width:'100%', height:'100%', objectFit:'cover', objectPosition:`50% ${objectY}%`, transform:`scale(${videoScale})`, transformOrigin:`50% ${interpolate(pipMix,[0,1],[0,50])}%`, filter:`drop-shadow(0 28px 70px rgba(0,0,0,${heroShadowAlpha}))`}}
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

export const AvatarTrack: React.FC<{project: MedAvatarProject; assets: RenderAssets}> = ({project, assets}) => {
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
