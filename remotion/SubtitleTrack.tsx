import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import type {CaptionCue} from '../src/core/captions';
import type {MedAvatarProject, SubtitleStyle} from '../src/core/schema';
import {getCompositionLayout, getPipSize, getRenderedAvatarLayout, getSubtitlePlacement} from './layout';
import {activeScene} from './PresenterTrack';

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
  medical: {fontSize:40, background:'rgba(4,14,22,.72)', paddingY:14, paddingX:26, borderRadius:20, textShadow:'0 3px 14px rgba(0,0,0,.45)', active:'#FFE082', keyword:'#63E5E7', pending:'rgba(255,255,255,.62)'},
  minimal: {fontSize:36, background:'rgba(4,14,22,.20)', paddingY:9, paddingX:18, borderRadius:12, textShadow:'0 3px 16px rgba(0,0,0,.72)', active:'#FFFFFF', keyword:'#8CE8EA', pending:'rgba(255,255,255,.72)'},
  social: {fontSize:48, background:'rgba(3,10,16,.84)', paddingY:17, paddingX:30, borderRadius:18, textShadow:'0 3px 12px rgba(0,0,0,.55)', active:'#FFD54F', keyword:'#73F4DF', pending:'rgba(255,255,255,.58)'},
};

export const SubtitleTrack: React.FC<{project: MedAvatarProject; captions: CaptionCue[]}> = ({project, captions}) => {
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
