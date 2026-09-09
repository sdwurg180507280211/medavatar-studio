import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type {MedAvatarProject, Scene} from '../src/core/schema';

const palette = {
  background: '#071826',
  panel: '#F8FBFD',
  text: '#102A43',
  muted: '#5C7083',
  cyan: '#5DE2E7',
  blue: '#2A74FF',
};

const Doctor: React.FC<{layout: 'fullscreen' | 'bottom-right' | 'bottom-left' | 'hidden'}> = ({layout}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (layout === 'hidden') return null;
  const enter = spring({fps, frame, config: {damping: 18}});
  const pip = layout !== 'fullscreen';
  const size = pip ? 330 : 620;
  const right = layout === 'bottom-right' ? 70 : undefined;
  const left = layout === 'bottom-left' ? 70 : pip ? undefined : 120;
  return (
    <div style={{
      position: 'absolute',
      width: size,
      height: pip ? 520 : 820,
      right,
      left,
      bottom: pip ? 62 : 70,
      transform: `scale(${interpolate(enter, [0, 1], [0.94, 1])})`,
      transformOrigin: 'bottom center',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
    }}>
      <div style={{
        width: '82%',
        height: '72%',
        borderRadius: '48% 48% 24% 24% / 28% 28% 12% 12%',
        background: 'linear-gradient(180deg,#EEF7FB 0%,#DCEBF4 45%,#FFFFFF 45%,#FFFFFF 100%)',
        border: '5px solid rgba(255,255,255,.86)',
        boxShadow: '0 24px 70px rgba(0,0,0,.24)',
        position: 'relative',
      }}>
        <div style={{
          position: 'absolute',
          width: '42%',
          aspectRatio: '1',
          borderRadius: '50%',
          left: '29%',
          top: '-25%',
          background: '#E7C5AD',
          border: '8px solid #243746',
        }} />
        <div style={{position:'absolute', left:'15%', right:'15%', top:'48%', height:6, background:'#B9D7EA'}} />
        <div style={{position:'absolute', right:'11%', top:'56%', fontSize:24, fontWeight:700, color:palette.blue}}>MED</div>
      </div>
    </div>
  );
};

const Subtitle: React.FC<{text: string}> = ({text}) => (
  <div style={{
    position: 'absolute',
    left: 260,
    right: 260,
    bottom: 38,
    textAlign: 'center',
    fontSize: 42,
    lineHeight: 1.35,
    fontWeight: 700,
    color: '#FFFFFF',
    textShadow: '0 4px 18px rgba(0,0,0,.65)',
  }}>{text}</div>
);

const Slide: React.FC<{scene: Scene}> = ({scene}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const progress = spring({fps, frame, config: {damping: 18}});
  return (
    <div style={{
      position: 'absolute',
      left: 80,
      top: 70,
      bottom: 120,
      width: 1360,
      borderRadius: 32,
      background: palette.panel,
      boxShadow: '0 30px 90px rgba(0,0,0,.26)',
      padding: '70px 80px',
      boxSizing: 'border-box',
      transform: `translateY(${interpolate(progress,[0,1],[50,0])}px)`,
      opacity: progress,
      color: palette.text,
    }}>
      <div style={{fontSize:26, fontWeight:700, color:palette.blue, letterSpacing:3}}>SLIDE {scene.slide ?? 1}</div>
      <div style={{fontSize:64, fontWeight:800, marginTop:34, maxWidth:1100}}>医学科普要点</div>
      <div style={{fontSize:42, lineHeight:1.55, marginTop:50, color:palette.muted}}>{scene.text}</div>
      <div style={{position:'absolute', left:80, right:80, bottom:70, height:10, borderRadius:99, background:'#D9E8F2'}}>
        <div style={{height:'100%', width:'58%', borderRadius:99, background:palette.blue}} />
      </div>
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
          {Array.from({length:6}).map((_,i)=><div key={i} style={{position:'absolute', width:46, height:46, borderRadius:'50%', background:'#F9FAFB', top:34 + (i%2)*42, left:((i*150+flow)%900)-100}} />)}
        </div>
      </div>
      <div style={{position:'absolute', left:230, top:570, fontSize:36, fontWeight:700, color:palette.text}}>血流 → 血管压力 → 血管壁变化</div>
    </div>
  );
};

const SceneView: React.FC<{scene: Scene}> = ({scene}) => {
  const layout = scene.avatar?.layout ?? (scene.type === 'doctor_full' ? 'fullscreen' : 'bottom-right');
  return (
    <AbsoluteFill style={{background: `radial-gradient(circle at 20% 10%, #123B59 0%, ${palette.background} 55%)`}}>
      {scene.type === 'doctor_ppt' ? <Slide scene={scene} /> : null}
      {scene.type === 'medical_animation' ? <MedicalAnimation scene={scene} /> : null}
      {scene.type === 'visual_full' ? <Slide scene={scene} /> : null}
      <Doctor layout={layout} />
      {scene.type === 'doctor_full' ? (
        <div style={{position:'absolute', left:810, right:120, top:220, fontSize:68, lineHeight:1.45, fontWeight:800, color:'#FFFFFF'}}>{scene.text}</div>
      ) : null}
      <Subtitle text={scene.text} />
    </AbsoluteFill>
  );
};

export const MedAvatarVideo: React.FC<{project: MedAvatarProject}> = ({project}) => {
  let from = 0;
  return (
    <AbsoluteFill>
      {project.scenes.map((scene) => {
        const duration = Math.max(1, Math.round(scene.durationInSeconds * project.video.fps));
        const start = from;
        from += duration;
        return (
          <Sequence key={scene.id} from={start} durationInFrames={duration} premountFor={project.video.fps}>
            <SceneView scene={scene} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
