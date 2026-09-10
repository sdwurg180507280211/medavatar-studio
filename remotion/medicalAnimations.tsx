import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Scene} from '../src/core/schema';
import {getCompositionLayout, getSceneAvatarLayout, getVisualPanelRect} from './layout';

const DESIGN_WIDTH = 1360;
const DESIGN_HEIGHT = 790;

const colors = {
  text: '#102A43',
  muted: '#5C7083',
  blue: '#2A74FF',
  cyan: '#31C8D8',
  red: '#E7656B',
  vessel: '#E9787E',
  lumen: '#9EDCF2',
  plaque: '#F2C14E',
};

const Shell: React.FC<{scene: Scene; title: string; children: React.ReactNode}> = ({scene, title, children}) => {
  const {width, height} = useVideoConfig();
  const metrics = getCompositionLayout(width, height);
  const rect = getVisualPanelRect(width, height, 'medical_animation', getSceneAvatarLayout(scene));
  const scale = Math.min(rect.width / DESIGN_WIDTH, rect.height / DESIGN_HEIGHT);
  const renderedWidth = DESIGN_WIDTH * scale;
  const renderedHeight = DESIGN_HEIGHT * scale;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;
  return (
    <div style={{position:'absolute', left:rect.left, top:rect.top, width:rect.width, height:rect.height}}>
      <div style={{position:'absolute', left:offsetX, top:offsetY, width:DESIGN_WIDTH, height:DESIGN_HEIGHT, borderRadius:36, background:'#F7FBFD', overflow:'hidden', boxShadow:'0 30px 90px rgba(0,0,0,.22)', transform:`scale(${scale})`, transformOrigin:'top left'}}>
        <div style={{position:'absolute', left:70, top:52, fontSize:31, fontWeight:800, color:colors.text}}>{title}</div>
        <div style={{position:'absolute', left:70, right:70, top:112, height:2, background:'#DDECF3'}} />
        {children}
      </div>
      {metrics.portrait ? (
        <div style={{position:'absolute', left:0, right:0, top:rect.height + Math.round(18*metrics.unit), textAlign:'center', color:'rgba(219,235,246,.72)', fontSize:Math.round(20*metrics.unit), fontWeight:650, letterSpacing:Math.round(metrics.unit)}}>
          医学机制示意
        </div>
      ) : null}
    </div>
  );
};

const ArteryPressure: React.FC<{scene: Scene}> = ({scene}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const beat = 1 + Math.sin((frame / fps) * Math.PI * 2) * 0.045;
  const flow = (frame * 9) % 930;
  const arrow = spring({fps, frame:frame - Math.round(fps * 0.35), config:{damping:18}});
  return (
    <Shell scene={scene} title="持续高压如何作用于血管壁">
      <div style={{position:'absolute', left:170, right:170, top:300, height:210, borderRadius:130, background:colors.vessel, transform:`scaleY(${beat})`, transformOrigin:'center'}}>
        <div style={{position:'absolute', inset:42, borderRadius:100, background:colors.lumen, overflow:'hidden'}}>
          {Array.from({length:7}).map((_,index) => <div key={index} style={{position:'absolute', width:42, height:42, borderRadius:'50%', background:'#FFF', top:26+(index%2)*54, left:((index*150+flow)%1040)-80, boxShadow:'0 3px 12px rgba(42,116,255,.16)'}} />)}
        </div>
      </div>
      {['↑','↓'].map((symbol,index) => <div key={symbol} style={{position:'absolute', left:650, top:index===0?205:535, fontSize:78, lineHeight:1, fontWeight:900, color:colors.red, opacity:arrow, transform:`translateY(${interpolate(arrow,[0,1],[index===0?20:-20,0])}px)`}}>{symbol}</div>)}
      <div style={{position:'absolute', left:185, top:590, fontSize:34, fontWeight:700, color:colors.text}}>血流压力增加</div>
      <div style={{position:'absolute', left:560, top:590, fontSize:34, fontWeight:700, color:colors.red}}>血管壁机械负荷 ↑</div>
      <div style={{position:'absolute', left:1010, top:590, fontSize:34, fontWeight:700, color:colors.text}}>内皮持续受力</div>
    </Shell>
  );
};

const PlaqueGrowth: React.FC<{scene: Scene}> = ({scene}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const growth = spring({fps, frame:frame-Math.round(fps*0.5), config:{damping:16, stiffness:80}});
  const flow = (frame * 7) % 860;
  return (
    <Shell scene={scene} title="内皮受损后，脂质沉积如何逐渐形成斑块">
      <div style={{position:'absolute', left:170, right:170, top:290, height:220, borderRadius:130, background:colors.vessel}}>
        <div style={{position:'absolute', inset:38, borderRadius:100, background:colors.lumen, overflow:'hidden'}}>
          {Array.from({length:6}).map((_,index) => <div key={index} style={{position:'absolute', width:38, height:38, borderRadius:'50%', background:'#FFF', top:34+(index%2)*54, left:((index*170+flow)%960)-70}} />)}
        </div>
        <div style={{position:'absolute', left:420, top:20, width:170*growth, height:62*growth, borderRadius:'0 0 80px 80px', background:colors.plaque, transformOrigin:'top center', boxShadow:'0 8px 20px rgba(208,151,32,.28)'}} />
        <div style={{position:'absolute', left:650, bottom:20, width:220*growth, height:70*growth, borderRadius:'90px 90px 0 0', background:'#EAB843', transformOrigin:'bottom center'}} />
      </div>
      <div style={{position:'absolute', left:190, top:590, display:'flex', gap:28, alignItems:'center'}}>
        {['内皮损伤','炎症反应','脂质沉积','管腔变窄'].map((label,index) => <React.Fragment key={label}>
          <div style={{padding:'18px 24px', borderRadius:18, background:index===3?'#FFF2D0':'#EAF5FA', fontSize:29, fontWeight:750, color:index===3?'#A76F00':colors.text}}>{label}</div>
          {index<3?<div style={{fontSize:34,color:colors.blue}}>→</div>:null}
        </React.Fragment>)}
      </div>
    </Shell>
  );
};

const HeartBeat: React.FC<{scene: Scene}> = ({scene}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const phase = (frame % Math.round(fps*0.9)) / (fps*0.9);
  const scale = phase<0.16 ? interpolate(phase,[0,0.08,0.16],[1,1.12,1]) : 1;
  const lineProgress = Math.min(1,frame/(fps*1.7));
  return (
    <Shell scene={scene} title="心脏在持续压力负荷下反复做功">
      <svg viewBox="0 0 500 430" style={{position:'absolute', left:155, top:190, width:500, height:430, overflow:'visible', transform:`scale(${scale})`, transformOrigin:'50% 55%'}}>
        <path d="M250 385 C220 345 88 266 88 157 C88 78 183 45 250 119 C317 45 412 78 412 157 C412 266 280 345 250 385Z" fill="#E7656B" />
        <path d="M250 126 C245 210 250 280 250 366" fill="none" stroke="#B94750" strokeWidth="16" strokeLinecap="round" opacity=".38" />
      </svg>
      <div style={{position:'absolute', left:700, top:260, width:510, height:220, borderRadius:28, background:'#0E2A3E', overflow:'hidden'}}>
        <svg viewBox="0 0 510 220" width="510" height="220"><polyline points="0,125 70,125 98,125 122,90 145,162 174,42 205,125 270,125 312,125 340,88 362,155 390,52 420,125 510,125" fill="none" stroke="#63E5E7" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1000" strokeDashoffset={1000*(1-lineProgress)} /></svg>
      </div>
      <div style={{position:'absolute', left:750, top:540, width:420, fontSize:34, lineHeight:1.55, fontWeight:700, color:colors.text}}>持续血压升高 → 心脏后负荷增加 → 长期结构与功能改变风险上升</div>
    </Shell>
  );
};

const RiskPathway: React.FC<{scene: Scene}> = ({scene}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const nodes = [['持续高压','#EAF5FA'],['内皮损伤','#EAF5FA'],['动脉粥样硬化','#FFF2D0'],['心脑肾风险增加','#FDE9EA']] as const;
  return (
    <Shell scene={scene} title="从血压升高到靶器官损害的风险链条">
      <div style={{position:'absolute', left:105, right:105, top:285, display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        {nodes.map(([label,background],index) => {
          const reveal = spring({fps, frame:frame-index*Math.round(fps*0.28), config:{damping:18}});
          return <React.Fragment key={label}>
            <div style={{width:245,minHeight:145,boxSizing:'border-box',padding:'34px 24px',display:'flex',alignItems:'center',justifyContent:'center',textAlign:'center',borderRadius:26,background,border:'2px solid #D9EAF2',color:colors.text,fontSize:31,lineHeight:1.35,fontWeight:800,opacity:reveal,transform:`translateY(${interpolate(reveal,[0,1],[28,0])}px)`}}>{label}</div>
            {index<nodes.length-1?<div style={{fontSize:52,fontWeight:800,color:colors.blue,opacity:reveal}}>→</div>:null}
          </React.Fragment>;
        })}
      </div>
      <div style={{position:'absolute', left:250, right:250, top:565, padding:'24px 34px', borderRadius:24, background:'#EEF7FB', textAlign:'center', fontSize:31, lineHeight:1.55, color:colors.muted}}>动画只表达机制链条，不自动加入未经审核的具体风险倍数或治疗结论。</div>
    </Shell>
  );
};

const Fallback: React.FC<{scene: Scene}> = ({scene}) => (
  <Shell scene={scene} title={`医学机制动画 · ${scene.animation?.name ?? 'mechanism'}`}>
    <div style={{position:'absolute', left:180, right:180, top:300, textAlign:'center', fontSize:46, lineHeight:1.6, fontWeight:800, color:colors.text}}>{scene.animation?.keywords?.join('  ·  ') || scene.text}</div>
  </Shell>
);

export const MedicalAnimationScene: React.FC<{scene: Scene}> = ({scene}) => {
  switch (scene.animation?.name) {
    case 'artery-pressure': return <ArteryPressure scene={scene} />;
    case 'plaque-growth': return <PlaqueGrowth scene={scene} />;
    case 'heart-beat': return <HeartBeat scene={scene} />;
    case 'risk-pathway': return <RiskPathway scene={scene} />;
    default: return <Fallback scene={scene} />;
  }
};
