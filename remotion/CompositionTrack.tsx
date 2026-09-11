import React from 'react';
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {buildSceneFrameTimeline} from '../src/core/frameMath';
import {findActiveCompositionItem} from '../src/core/composition';
import type {
  AnimationOverlay,
  CompositionRect,
  MedAvatarProject,
  Scene,
  TextOverlay,
} from '../src/core/schema';
import {MedicalAnimationScene} from './medicalAnimations';
import {VisualRenderer} from './VisualRenderer';
import type {RenderAssets} from './videoTypes';
import {
  getDefaultAnimationPlacementRect,
  getDefaultVisualPlacementRect,
} from './compositionGeometry';

const AffinePlacement: React.FC<{
  source: CompositionRect;
  target: CompositionRect;
  zIndex: number;
  children: React.ReactNode;
}> = ({source, target, zIndex, children}) => {
  const scaleX = target.width / source.width;
  const scaleY = target.height / source.height;
  const tx = target.x - source.x * scaleX;
  const ty = target.y - source.y * scaleY;
  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        zIndex,
        transformOrigin: '0 0',
        transform: `matrix(${scaleX},0,0,${scaleY},${tx},${ty})`,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

const MockCompositionDoctor: React.FC = () => (
  <div style={{width:'62%', height:'72%', borderRadius:'48% 48% 24% 24% / 28% 28% 12% 12%', background:'linear-gradient(180deg,#EEF7FB 0%,#DCEBF4 45%,#FFFFFF 45%,#FFFFFF 100%)', border:'5px solid rgba(255,255,255,.86)', position:'relative'}}>
    <div style={{position:'absolute', width:'42%', aspectRatio:'1', borderRadius:'50%', left:'29%', top:'-25%', background:'#E7C5AD', border:'8px solid #243746'}} />
    <div style={{position:'absolute', left:'15%', right:'15%', top:'48%', height:6, background:'#B9D7EA'}} />
  </div>
);

const ContinuousPresenter: React.FC<{
  project: MedAvatarProject;
  avatarSrc?: string;
  globalStartFrame?: number;
}> = ({project, avatarSrc, globalStartFrame = 0}) => {
  const localSourceFrame = useCurrentFrame();
  const globalFrame = localSourceFrame + globalStartFrame;
  const timeline = buildSceneFrameTimeline(project.scenes, project.video.fps);
  const span = timeline.find((item) => globalFrame >= item.startFrame && globalFrame < item.endFrame);
  if (!span) return null;
  const scene = project.scenes[span.index]!;
  const presenter = scene.composition?.presenter;
  if (presenter === undefined) return null;
  const segment = findActiveCompositionItem(presenter, globalFrame - span.startFrame);
  if (!segment) return null;
  const circle = segment.mask === 'circle';
  return (
    <div
      style={{
        position: 'absolute',
        left: segment.rect.x,
        top: segment.rect.y,
        width: segment.rect.width,
        height: segment.rect.height,
        zIndex: segment.zIndex ?? 20,
        overflow: 'hidden',
        borderRadius: circle ? '50%' : Math.max(0, Math.round(Math.min(segment.rect.width, segment.rect.height) * 0.06)),
        border: circle ? '4px solid rgba(255,255,255,.94)' : 'none',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: avatarSrc ? 'transparent' : '#071826',
        boxShadow: '0 18px 54px rgba(0,0,0,.32)',
      }}
    >
      {avatarSrc ? (
        <OffthreadVideo
          src={staticFile(avatarSrc)}
          muted
          transparent
          style={{width:'100%', height:'100%', objectFit:'cover'}}
        />
      ) : <MockCompositionDoctor />}
    </div>
  );
};

export const CompositionPresenterTrack: React.FC<{
  project: MedAvatarProject;
  assets: RenderAssets;
}> = ({project, assets}) => {
  if (!project.scenes.some((scene) => scene.composition?.presenter !== undefined)) return null;
  if (assets.avatarChapters?.length) {
    return <>{assets.avatarChapters.map((chapter, index) => {
      const from = Math.round(chapter.start * project.video.fps);
      const durationInFrames = Math.max(1, Math.round((chapter.end - chapter.start) * project.video.fps));
      return (
        <Sequence key={`${chapter.src}-${index}`} from={from} durationInFrames={durationInFrames} premountFor={project.video.fps}>
          <ContinuousPresenter project={project} avatarSrc={chapter.src} globalStartFrame={from} />
        </Sequence>
      );
    })}</>;
  }
  return <ContinuousPresenter project={project} avatarSrc={assets.avatar} />;
};

const SceneVisualComposition: React.FC<{scene: Scene; durationInFrames: number}> = ({scene, durationInFrames}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const items = scene.composition?.visual;
  if (items === undefined) return null;
  const item = findActiveCompositionItem(items, frame);
  if (!item || !scene.visual || scene.visual.type === 'none') return null;
  const offset = item.playbackOffsetFrame ?? 0;
  const source = getDefaultVisualPlacementRect(scene.visual, width, height);
  const sequenceFrom = item.startFrame - offset;
  const sequenceDuration = Math.max(1, item.endFrame - sequenceFrom);
  return (
    <Sequence from={sequenceFrom} durationInFrames={sequenceDuration} premountFor={Math.min(15, Math.max(1, Math.round(scene.durationInSeconds * 2)))}>
      <AffinePlacement source={source} target={item.rect} zIndex={item.zIndex ?? 34}>
        <VisualRenderer visual={scene.visual} scene={scene} durationInFrames={durationInFrames} />
      </AffinePlacement>
    </Sequence>
  );
};

export const CompositionVisualTrack: React.FC<{project: MedAvatarProject}> = ({project}) => {
  const timeline = buildSceneFrameTimeline(project.scenes, project.video.fps);
  return <>{timeline.map((span) => {
    const scene = project.scenes[span.index]!;
    if (scene.composition?.visual === undefined) return null;
    return (
      <Sequence key={`composition-visual-${scene.id}`} from={span.startFrame} durationInFrames={span.durationInFrames}>
        <SceneVisualComposition scene={scene} durationInFrames={span.durationInFrames} />
      </Sequence>
    );
  })}</>;
};

const TextOverlayView: React.FC<{overlay: TextOverlay}> = ({overlay}) => (
  <div
    style={{
      position: 'absolute',
      left: overlay.rect.x,
      top: overlay.rect.y,
      width: overlay.rect.width,
      height: overlay.rect.height,
      zIndex: overlay.zIndex ?? 38,
      display: 'flex',
      alignItems: 'center',
      justifyContent: overlay.style?.align === 'left' ? 'flex-start' : overlay.style?.align === 'right' ? 'flex-end' : 'center',
      padding: 12,
      boxSizing: 'border-box',
      color: overlay.style?.color ?? '#FFFFFF',
      fontSize: overlay.style?.fontSize ?? Math.max(24, Math.round(overlay.rect.height * 0.28)),
      fontWeight: overlay.style?.weight ?? 850,
      lineHeight: 1.18,
      textAlign: overlay.style?.align ?? 'center',
      textShadow: '0 6px 24px rgba(0,0,0,.6)',
      overflow: 'hidden',
      pointerEvents: 'none',
    }}
  >
    {overlay.text}
  </div>
);

const AnimationOverlayView: React.FC<{scene: Scene; overlay: AnimationOverlay}> = ({scene, overlay}) => {
  const {width, height} = useVideoConfig();
  const source = getDefaultAnimationPlacementRect(scene, width, height);
  const animationScene: Scene = {
    ...scene,
    type: 'medical_animation',
    visual: undefined,
    avatar: {layout: 'hidden', scale: scene.avatar?.scale ?? 0.28},
    animation: {name: overlay.name, keywords: scene.animation?.keywords ?? []},
  };
  return (
    <AffinePlacement source={source} target={overlay.rect} zIndex={overlay.zIndex ?? 32}>
      <MedicalAnimationScene scene={animationScene} />
    </AffinePlacement>
  );
};

const SceneOverlayComposition: React.FC<{scene: Scene}> = ({scene}) => {
  const frame = useCurrentFrame();
  const overlays = scene.composition?.overlays;
  if (overlays === undefined) return null;
  return <>{overlays.map((overlay) => {
    if (frame < overlay.startFrame || frame >= overlay.endFrame) return null;
    if (overlay.type === 'text') {
      return (
        <Sequence key={overlay.id} from={overlay.startFrame} durationInFrames={overlay.endFrame - overlay.startFrame}>
          <TextOverlayView overlay={overlay} />
        </Sequence>
      );
    }
    const offset = overlay.playbackOffsetFrame ?? 0;
    const from = overlay.startFrame - offset;
    return (
      <Sequence key={overlay.id} from={from} durationInFrames={overlay.endFrame - from}>
        <AnimationOverlayView scene={scene} overlay={overlay} />
      </Sequence>
    );
  })}</>;
};

export const CompositionOverlayTrack: React.FC<{project: MedAvatarProject}> = ({project}) => {
  const timeline = buildSceneFrameTimeline(project.scenes, project.video.fps);
  return <>{timeline.map((span) => {
    const scene = project.scenes[span.index]!;
    if (scene.composition?.overlays === undefined) return null;
    return (
      <Sequence key={`composition-overlay-${scene.id}`} from={span.startFrame} durationInFrames={span.durationInFrames}>
        <SceneOverlayComposition scene={scene} />
      </Sequence>
    );
  })}</>;
};
