import React from 'react';
import {AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Scene} from '../src/core/schema';
import {getCompositionLayout, getSceneAvatarLayout, getVisualPanelRect} from './layout';
import {MedicalAnimationScene} from './medicalAnimations';
import {VisualRenderer} from './VisualRenderer';

const palette = {background:'#071826', panel:'#F8FBFD', text:'#102A43', muted:'#5C7083', blue:'#2A74FF'};

const HeroTitle: React.FC<{scene: Scene}> = ({scene}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  if (!scene.title) return null;
  const layout = getCompositionLayout(width, height);
  const titleIn = spring({fps, frame, delay:2, config:{damping:18, stiffness:120}});
  const accentIn = spring({fps, frame, delay:9, config:{damping:20, stiffness:140}});
  const opacity = interpolate(frame,[0,10],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  return (
    <div style={{position:'absolute', left:layout.title.side, right:layout.title.side, top:layout.title.top, zIndex:34, display:'flex', flexDirection:'column', alignItems:'center', pointerEvents:'none'}}>
      <div style={{maxWidth:layout.title.maxWidth, textAlign:'center', fontSize:layout.title.fontSize, lineHeight:1.12, fontWeight:850, letterSpacing:layout.unit, color:'#FFFFFF', textShadow:'0 8px 28px rgba(0,0,0,.42)', opacity, transform:`translateY(${interpolate(titleIn,[0,1],[layout.title.enterOffset,0])}px) scale(${interpolate(titleIn,[0,1],[0.98,1])})`}}>{scene.title}</div>
      <div style={{width:interpolate(accentIn,[0,1],[0,layout.title.accentWidth]), height:layout.title.accentHeight, marginTop:layout.title.accentMarginTop, borderRadius:999, background:'linear-gradient(90deg, rgba(99,229,231,.15), #63E5E7, #2A74FF, rgba(42,116,255,.12))', boxShadow:'0 0 24px rgba(99,229,231,.36)'}} />
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
    <div style={{position:'absolute', left:rect.left, top:rect.top, width:rect.width, height:rect.height, borderRadius:Math.round((portraitSupport ? 18 : 30)*metrics.unit), background:palette.panel, boxShadow:portraitSupport ? '0 16px 44px rgba(0,0,0,.3)' : '0 30px 90px rgba(0,0,0,.26)', overflow:'hidden', transform:`translateY(${interpolate(progress,[0,1],[Math.round((portraitSupport ? 20 : 45)*metrics.unit),0])}px)`, opacity:portraitSupport ? progress*0.9 : progress, color:palette.text, zIndex:10}}>
      {slideSrc ? <Img src={staticFile(slideSrc)} style={{width:'100%',height:'100%',objectFit:'contain',background:'#fff'}} /> : (
        <div style={{padding:`${Math.round(70*fontScale)}px ${Math.round(80*fontScale)}px`}}>
          <div style={{fontSize:Math.round(26*fontScale),fontWeight:700,color:palette.blue,letterSpacing:Math.round(3*fontScale)}}>SLIDE {scene.slide ?? 1}</div>
          <div style={{fontSize:Math.round(64*fontScale),lineHeight:1.12,fontWeight:800,marginTop:Math.round(34*fontScale)}}>{scene.title ?? '医学科普要点'}</div>
          <div style={{fontSize:Math.round(42*fontScale),lineHeight:1.55,marginTop:Math.round(50*fontScale),color:palette.muted}}>{scene.text}</div>
        </div>
      )}
    </div>
  );
};

export const SceneView: React.FC<{scene: Scene; slideSrc?: string; durationInFrames: number}> = ({scene, slideSrc, durationInFrames}) => {
  const hasFormalVisualModel = scene.visual !== undefined;
  return (
    <AbsoluteFill style={{background:`radial-gradient(circle at 50% 12%, #164765 0%, ${palette.background} 52%, #04101A 100%)`}}>
      <VisualRenderer visual={scene.visual} scene={scene} durationInFrames={durationInFrames} />
      {!hasFormalVisualModel && scene.type === 'doctor_ppt' ? <Slide scene={scene} slideSrc={slideSrc} /> : null}
      {!hasFormalVisualModel && scene.type === 'medical_animation' ? <MedicalAnimationScene scene={scene} /> : null}
      {!hasFormalVisualModel && scene.type === 'visual_full' ? <Slide scene={scene} slideSrc={slideSrc} /> : null}
      {!hasFormalVisualModel && scene.type === 'doctor_full' ? <HeroTitle scene={scene} /> : null}
    </AbsoluteFill>
  );
};
