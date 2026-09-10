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
import {MedicalAnimationScene} from './medicalAnimations';

export type RenderAssets = {
  narration?: string;
  avatar?: string;
  avatarChapters?: Array<{src: string; start: number; end: number}>;
  slides: string[];
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
  padding: string;
  borderRadius: number;
  textShadow: string;
  active: string;
  keyword: string;
  pending: string;
}> = {
  medical: {
    fontSize: 40,
    background: 'rgba(4,14,22,.72)',
    padding: '13px 26px 15px',
    borderRadius: 20,
    textShadow: '0 3px 14px rgba(0,0,0,.45)',
    active: '#FFE082',
    keyword: '#63E5E7',
    pending: 'rgba(255,255,255,.62)',
  },
  minimal: {
    fontSize: 36,
    background: 'rgba(4,14,22,.20)',
    padding: '8px 18px 10px',
    borderRadius: 12,
    textShadow: '0 3px 16px rgba(0,0,0,.72)',
    active: '#FFFFFF',
    keyword: '#8CE8EA',
    pending: 'rgba(255,255,255,.72)',
  },
  social: {
    fontSize: 48,
    background: 'rgba(3,10,16,.84)',
    padding: '16px 30px 18px',
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
  for (const scene of project.scenes) {
    const duration = Math.max(1, Math.round(scene.durationInSeconds * project.video.fps));
    if (frame < cursor + duration) return {scene, localFrame: frame - cursor};
    cursor += duration;
  }
  return {scene: project.scenes.at(-1)!, localFrame: 0};
};

const visualLayout = (scene: Scene) => {
  const layout = scene.avatar?.layout ?? (scene.type === 'doctor_full' ? 'hero' : 'bottom-right');
  return layout === 'fullscreen' ? 'hero' : layout;
};

const sceneMasksAvatarReset = (scene: Scene | undefined) => {
  if (!scene) return false;
  const layout = visualLayout(scene);
  if (layout === 'hidden') return true;
  return scene.type === 'visual_full'
    || scene.type === 'doctor_ppt'
    || scene.type === 'medical_animation'
    || layout === 'bottom-left'
    || layout === 'bottom-right';
};

const shouldMaskBoundary = (project: MedAvatarProject, boundaryFrame: number) => {
  if (boundaryFrame <= 0) return false;
  const previous = activeScene(project, Math.max(0, boundaryFrame - 1)).scene;
  const next = activeScene(project, boundaryFrame).scene;
  return sceneMasksAvatarReset(previous) || sceneMasksAvatarReset(next);
};

const pipSizeForScene = (scene: Scene) => {
  const scale = scene.avatar?.scale ?? 0.28;
  return Math.max(280, Math.min(520, Math.round(1280 * scale)));
};

const HeroTitle: React.FC<{scene: Scene}> = ({scene}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (!scene.title) return null;

  const titleIn = spring({fps, frame, delay: 2, config:{damping:18, stiffness:120}});
  const accentIn = spring({fps, frame, delay: 9, config:{damping:20, stiffness:140}});
  const opacity = interpolate(frame, [0, 10], [0, 1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});

  return (
    <div style={{position:'absolute', left:180, right:180, top:42, zIndex:34, display:'flex', flexDirection:'column', alignItems:'center', pointerEvents:'none'}}>
      <div
        style={{
          maxWidth:1320,
          textAlign:'center',
          fontSize:64,
          lineHeight:1.12,
          fontWeight:850,
          letterSpacing:1,
          color:'#FFFFFF',
          textShadow:'0 8px 28px rgba(0,0,0,.42)',
          opacity,
          transform:`translateY(${interpolate(titleIn,[0,1],[30,0])}px) scale(${interpolate(titleIn,[0,1],[0.98,1])})`,
        }}
      >
        {scene.title}
      </div>
      <div
        style={{
          width:interpolate(accentIn,[0,1],[0,190]),
          height:6,
          marginTop:18,
          borderRadius:999,
          background:'linear-gradient(90deg, rgba(99,229,231,.15), #63E5E7, #2A74FF, rgba(42,116,255,.12))',
          boxShadow:'0 0 24px rgba(99,229,231,.36)',
        }}
      />
    </div>
  );
};

const AvatarClip: React.FC<{
  project: MedAvatarProject;
  avatarSrc?: string;
  globalStartFrame?: number;
  opacity?: number;
}> = ({project, avatarSrc, globalStartFrame = 0, opacity = 1}) => {
  const clipFrame = useCurrentFrame();
  const {fps, height} = useVideoConfig();
  const globalFrame = clipFrame + globalStartFrame;
  const {scene, localFrame} = activeScene(project, globalFrame);
  const layout = visualLayout(scene);
  if (layout === 'hidden') return null;

  const pip = layout === 'bottom-left' || layout === 'bottom-right';
  const pipSize = pipSizeForScene(scene);
  const enter = spring({fps, frame: localFrame, config:{damping:18}});
  const heroTop = Math.round(height * 0.17);
  const heroHeight = height - heroTop;
  const heroWidth = Math.round((heroHeight * 9) / 16);

  const wrapper: React.CSSProperties = pip
    ? {
        position:'absolute',
        width:pipSize,
        height:pipSize,
        bottom:54,
        right:layout === 'bottom-right' ? 54 : undefined,
        left:layout === 'bottom-left' ? 54 : undefined,
        borderRadius:'50%',
        overflow:'hidden',
        border:'6px solid rgba(255,255,255,.96)',
        boxShadow:'0 18px 54px rgba(0,0,0,.38)',
        background:'#071826',
      }
    : {
        position:'absolute',
        top:heroTop,
        height:heroHeight,
        width:heroWidth,
        left:'50%',
        marginLeft:-Math.round(heroWidth / 2),
        borderRadius:'28px 28px 0 0',
        overflow:'hidden',
        background:'#071826',
        boxShadow:'0 28px 90px rgba(0,0,0,.34)',
      };

  const videoStyle: React.CSSProperties = pip
    ? {
        width:'100%',
        height:'100%',
        objectFit:'cover',
        objectPosition:'50% 32%',
        transform:'scale(1.22)',
        transformOrigin:'50% 34%',
      }
    : {
        width:'100%',
        height:'100%',
        objectFit:'cover',
        objectPosition:'50% 0%',
      };

  return (
    <div style={{...wrapper, opacity, transform:`scale(${interpolate(enter,[0,1],[0.975,1])})`, transformOrigin:pip ? 'center' : 'bottom center', display:'flex', alignItems:'center', justifyContent:'center', zIndex:20}}>
      {avatarSrc ? (
        <OffthreadVideo src={staticFile(avatarSrc)} muted style={videoStyle} />
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
  if (fadeIn) {
    opacity *= interpolate(frame, [0, fadeFrames], [0, 1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
  }
  if (fadeOut) {
    opacity *= interpolate(frame, [Math.max(0, durationInFrames - fadeFrames - 1), Math.max(1, durationInFrames - 1)], [1, 0], {extrapolateLeft:'clamp', extrapolateRight:'clamp'});
  }
  return <AvatarClip project={project} avatarSrc={avatarSrc} globalStartFrame={globalStartFrame} opacity={opacity} />;
};

const AvatarTrack: React.FC<{project: MedAvatarProject; assets: RenderAssets}> = ({project, assets}) => {
  if (assets.avatarChapters?.length) {
    return (
      <>
        {assets.avatarChapters.map((chapter, index) => {
          const from = Math.round(chapter.start * project.video.fps);
          const duration = Math.max(1, Math.round((chapter.end - chapter.start) * project.video.fps));
          const hasPrevious = index > 0;
          const hasNext = index < assets.avatarChapters!.length - 1;
          const fadeIn = hasPrevious && shouldMaskBoundary(project, from);
          const fadeOut = hasNext && shouldMaskBoundary(project, from + duration);
          return (
            <Sequence key={`${chapter.src}-${index}`} from={from} durationInFrames={duration} premountFor={project.video.fps}>
              <ChapterAvatarClip
                project={project}
                avatarSrc={chapter.src}
                globalStartFrame={from}
                durationInFrames={duration}
                fadeIn={fadeIn}
                fadeOut={fadeOut}
              />
            </Sequence>
          );
        })}
      </>
    );
  }
  return <AvatarClip project={project} avatarSrc={assets.avatar} />;
};

const SubtitleTrack: React.FC<{project: MedAvatarProject; captions: CaptionCue[]}> = ({project, captions}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const time = frame / fps;
  const {scene} = activeScene(project, frame);
  const mode = scene.subtitle?.mode ?? 'karaoke';
  if (mode === 'off') return null;
  const visual = subtitlePresets[scene.subtitle?.style ?? 'medical'];
  const cue = captions.find((candidate) => candidate.sceneId === scene.id && time >= candidate.start - 0.02 && time < candidate.end + 0.06);
  const layout = visualLayout(scene);
  const pipSize = pipSizeForScene(scene);
  const position = layout === 'bottom-right'
    ? {left:150, right:pipSize + 130}
    : layout === 'bottom-left'
      ? {left:pipSize + 130, right:150}
      : {left:330, right:330};
  const characters = cue?.characters;
  return (
    <div style={{position:'absolute', ...position, bottom:38, minHeight:68, boxSizing:'border-box', padding:visual.padding, borderRadius:visual.borderRadius, background:visual.background, backdropFilter:'blur(8px)', textAlign:'center', fontSize:visual.fontSize, lineHeight:1.35, fontWeight:760, color:'#FFFFFF', textShadow:visual.textShadow, zIndex:45}}>
      {characters ? characters.map((character, index) => {
        const active = mode === 'karaoke' && time >= character.start && time < character.end;
        const spoken = time >= character.end;
        const color = active
          ? visual.active
          : character.keyword
            ? visual.keyword
            : spoken || mode === 'sentence'
              ? '#FFFFFF'
              : visual.pending;
        return <span key={`${index}-${character.start}`} style={{display:/\s/.test(character.text) ? 'inline' : 'inline-block', color, transform:active ? 'scale(1.08)' : 'scale(1)', transition:'none'}}>{character.text}</span>;
      }) : scene.text}
    </div>
  );
};

const Slide: React.FC<{scene: Scene; slideSrc?: string; side: 'left' | 'right'}> = ({scene, slideSrc, side}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const progress = spring({fps, frame, config:{damping:18}});
  return (
    <div style={{position:'absolute', ...(side === 'left' ? {left:70} : {right:70}), top:60, bottom:120, width:1240, borderRadius:30, background:palette.panel, boxShadow:'0 30px 90px rgba(0,0,0,.26)', overflow:'hidden', transform:`translateY(${interpolate(progress,[0,1],[45,0])}px)`, opacity:progress, color:palette.text}}>
      {slideSrc ? (
        <Img src={staticFile(slideSrc)} style={{width:'100%', height:'100%', objectFit:'contain', background:'#fff'}} />
      ) : (
        <div style={{padding:'70px 80px'}}>
          <div style={{fontSize:26, fontWeight:700, color:palette.blue, letterSpacing:3}}>SLIDE {scene.slide ?? 1}</div>
          <div style={{fontSize:64, fontWeight:800, marginTop:34}}>{scene.title ?? '医学科普要点'}</div>
          <div style={{fontSize:42, lineHeight:1.55, marginTop:50, color:palette.muted}}>{scene.text}</div>
        </div>
      )}
    </div>
  );
};

const SceneView: React.FC<{scene: Scene; slideSrc?: string}> = ({scene, slideSrc}) => {
  const slideSide = visualLayout(scene) === 'bottom-left' ? 'right' : 'left';
  return (
    <AbsoluteFill style={{background:`radial-gradient(circle at 50% 12%, #164765 0%, ${palette.background} 52%, #04101A 100%)`}}>
      {scene.type === 'doctor_ppt' ? <Slide scene={scene} slideSrc={slideSrc} side={slideSide} /> : null}
      {scene.type === 'medical_animation' ? <MedicalAnimationScene scene={scene} /> : null}
      {scene.type === 'visual_full' ? <Slide scene={scene} slideSrc={slideSrc} side={slideSide} /> : null}
      {scene.type === 'doctor_full' ? <HeroTitle scene={scene} /> : null}
    </AbsoluteFill>
  );
};

export const MedAvatarVideo: React.FC<{project: MedAvatarProject; assets?: RenderAssets; captions?: CaptionCue[]}> = ({project, assets = {slides:[]}, captions = []}) => {
  let from = 0;
  return (
    <AbsoluteFill>
      {project.scenes.map((scene) => {
        const duration = Math.max(1, Math.round(scene.durationInSeconds * project.video.fps));
        const start = from;
        from += duration;
        const slideSrc = scene.slide ? assets.slides[scene.slide - 1] : undefined;
        return <Sequence key={scene.id} from={start} durationInFrames={duration} premountFor={project.video.fps}><SceneView scene={scene} slideSrc={slideSrc} /></Sequence>;
      })}
      <AvatarTrack project={project} assets={assets} />
      <div style={{position:'absolute', left:0, right:0, bottom:0, height:190, background:'linear-gradient(180deg, rgba(4,14,22,0) 0%, rgba(4,14,22,.72) 78%)', zIndex:25}} />
      <SubtitleTrack project={project} captions={captions} />
      {assets.narration ? <Audio src={staticFile(assets.narration)} /> : null}
    </AbsoluteFill>
  );
};
