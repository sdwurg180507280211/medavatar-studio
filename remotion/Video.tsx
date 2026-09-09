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
import type {MedAvatarProject, Scene} from '../src/core/schema';

export type RenderAssets = {
  narration?: string;
  avatar?: string;
  slides: string[];
};

const palette = {
  background: '#071826',
  panel: '#F8FBFD',
  text: '#102A43',
  muted: '#5C7083',
  blue: '#2A74FF',
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

const AvatarTrack: React.FC<{project: MedAvatarProject; avatarSrc?: string}> = ({project, avatarSrc}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const {scene, localFrame} = activeScene(project, frame);
  const layout = scene.avatar?.layout ?? (scene.type === 'doctor_full' ? 'fullscreen' : 'bottom-right');
  if (layout === 'hidden') return null;
  const pip = layout !== 'fullscreen';
  const enter = spring({fps, frame: localFrame, config:{damping:18}});
  const wrapper: React.CSSProperties = pip
    ? {position:'absolute', width:520, height:620, bottom:58, right:layout === 'bottom-right' ? 45 : undefined, left:layout === 'bottom-left' ? 45 : undefined, borderRadius:26, overflow:'hidden', boxShadow:'0 24px 60px rgba(0,0,0,.4)'}
    : {position:'absolute', inset:0};
  return (
    <div style={{...wrapper, transform:`scale(${interpolate(enter,[0,1],[0.96,1])})`, transformOrigin:'bottom center', display:'flex', alignItems:'flex-end', justifyContent:'center', zIndex:20}}>
      {avatarSrc ? (
        <OffthreadVideo src={staticFile(avatarSrc)} muted style={{width:'100%', height:'100%', objectFit: pip ? 'cover' : 'contain'}} />
      ) : <MockDoctor />}
    </div>
  );
};

const SubtitleTrack: React.FC<{project: MedAvatarProject}> = ({project}) => {
  const {scene} = activeScene(project, useCurrentFrame());
  return <div style={{position:'absolute', left:250, right:250, bottom:34, textAlign:'center', fontSize:40, lineHeight:1.35, fontWeight:700, color:'#FFFFFF', textShadow:'0 4px 18px rgba(0,0,0,.7)', zIndex:40}}>{scene.text}</div>;
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
          <div style={{fontSize:64, fontWeight:800, marginTop:34}}>医学科普要点</div>
          <div style={{fontSize:42, lineHeight:1.55, marginTop:50, color:palette.muted}}>{scene.text}</div>
        </div>
      )}
    </div>
  );
};

const MedicalAnimation: React.FC<{scene: Scene}> = ({scene}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const pulse = 1 + Math.sin(frame / fps * Math.PI * 2) * 0.035;
  const flow = (frame * 10) % 700;
  return (
    <div style={{position:'absolute', left:90, top:100, width:1320, height:760, borderRadius:36, background:'#F4FAFD', overflow:'hidden'}}>
      <div style={{position:'absolute', left:80, top:62, fontSize:34, fontWeight:800, color:palette.text}}>医学机制动画 · {scene.animation?.name ?? 'mechanism'}</div>
      <div style={{position:'absolute', left:180, right:180, top:300, height:190, borderRadius:120, background:'#E56D72', transform:`scaleY(${pulse})`, transformOrigin:'center'}}>
        <div style={{position:'absolute', inset:38, borderRadius:90, background:'#8ED4EE', overflow:'hidden'}}>
          {Array.from({length:6}).map((_,i)=><div key={i} style={{position:'absolute', width:46, height:46, borderRadius:'50%', background:'#F9FAFB', top:34+(i%2)*42, left:((i*150+flow)%900)-100}} />)}
        </div>
      </div>
      <div style={{position:'absolute', left:230, top:570, fontSize:36, fontWeight:700, color:palette.text}}>血流 → 血管压力 → 血管壁变化</div>
    </div>
  );
};

const SceneView: React.FC<{scene: Scene; slideSrc?: string}> = ({scene, slideSrc}) => {
  const slideSide = scene.avatar?.layout === 'bottom-left' ? 'right' : 'left';
  return (
    <AbsoluteFill style={{background:`radial-gradient(circle at 20% 10%, #123B59 0%, ${palette.background} 55%)`}}>
      {scene.type === 'doctor_ppt' ? <Slide scene={scene} slideSrc={slideSrc} side={slideSide} /> : null}
      {scene.type === 'medical_animation' ? <MedicalAnimation scene={scene} /> : null}
      {scene.type === 'visual_full' ? <Slide scene={scene} slideSrc={slideSrc} side={slideSide} /> : null}
      {scene.type === 'doctor_full' ? <div style={{position:'absolute', left:100, top:230, width:588, boxSizing:'border-box', padding:'30px 34px', fontSize:48, lineHeight:1.5, fontWeight:800, color:'#FFFFFF', textShadow:'0 4px 18px rgba(0,0,0,.45)', background:'rgba(7,24,38,.62)', borderRadius:22, zIndex:30}}>{scene.text}</div> : null}
    </AbsoluteFill>
  );
};

export const MedAvatarVideo: React.FC<{project: MedAvatarProject; assets?: RenderAssets}> = ({project, assets = {slides:[]}}) => {
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
      <AvatarTrack project={project} avatarSrc={assets.avatar} />
      <div style={{position:'absolute', left:0, right:0, bottom:0, height:190, background:'linear-gradient(180deg, rgba(4,14,22,0) 0%, rgba(4,14,22,.72) 78%)', zIndex:25}} />
      <SubtitleTrack project={project} />
      {assets.narration ? <Audio src={staticFile(assets.narration)} /> : null}
    </AbsoluteFill>
  );
};
