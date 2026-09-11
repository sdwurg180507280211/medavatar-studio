import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {SceneVisual} from '../src/core/schema';
import {getCompositionLayout} from './layout';

type ComparisonVisual = Extract<SceneVisual, {type: 'comparison'}>;
type ComparisonSide = ComparisonVisual['left'];

const seconds = (fps: number, value: number) => Math.round(fps * value);

const relationCopy: Record<NonNullable<ComparisonVisual['relation']>, string> = {
  vs: 'VS',
  'before-after': '→',
  'normal-abnormal': '≠',
  'low-high': '↗',
};

const contentWeight = (side: ComparisonSide) =>
  side.label.length + (side.value?.length ?? 0) + (side.context?.length ?? 0);

const SideCard: React.FC<{
  data: ComparisonSide;
  side: 'left' | 'right';
  progress: number;
  unit: number;
  portrait: boolean;
}> = ({data, side, progress, unit, portrait}) => {
  const valueSize = Math.round((portrait ? 58 : 68) * unit);
  const labelSize = Math.round((portrait ? 38 : 42) * unit);
  const contextSize = Math.round((portrait ? 27 : 30) * unit);
  const translate = interpolate(progress, [0, 1], [side === 'left' ? -26 * unit : 26 * unit, 0]);

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        padding: `${Math.round(28 * unit)}px ${Math.round(26 * unit)}px`,
        borderRadius: Math.round(28 * unit),
        background: side === 'left'
          ? 'linear-gradient(145deg, rgba(18,55,74,.94), rgba(8,29,43,.9))'
          : 'linear-gradient(145deg, rgba(18,47,78,.94), rgba(8,25,47,.9))',
        border: side === 'left'
          ? '1px solid rgba(99,229,231,.22)'
          : '1px solid rgba(82,143,255,.26)',
        boxShadow: '0 24px 70px rgba(0,0,0,.26), inset 0 1px 0 rgba(255,255,255,.045)',
        opacity: progress,
        transform: `translateX(${translate}px) scale(${interpolate(progress, [0, 1], [0.97, 1])})`,
      }}
    >
      <div
        style={{
          fontSize: labelSize,
          lineHeight: 1.12,
          fontWeight: 820,
          color: 'rgba(235,248,252,.86)',
        }}
      >
        {data.label}
      </div>
      {data.value ? (
        <div
          style={{
            marginTop: Math.round(15 * unit),
            fontSize: valueSize,
            lineHeight: 1.02,
            fontWeight: 940,
            letterSpacing: -Math.round(1.5 * unit),
            color: side === 'left' ? '#63E5E7' : '#8BB4FF',
            textShadow: '0 8px 28px rgba(0,0,0,.34)',
          }}
        >
          {data.value}
        </div>
      ) : null}
      {data.context ? (
        <div
          style={{
            marginTop: Math.round(14 * unit),
            fontSize: contextSize,
            lineHeight: 1.35,
            fontWeight: 600,
            color: 'rgba(224,239,247,.68)',
          }}
        >
          {data.context}
        </div>
      ) : null}
    </div>
  );
};

export const ComparisonCard: React.FC<{
  data: ComparisonVisual;
  durationInFrames: number;
}> = ({data, durationInFrames}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const layout = getCompositionLayout(width, height);
  const relation = data.relation ?? 'vs';

  // Layout and choreography remain renderer-owned. The SceneVisual only says
  // which two medical entities are being compared and what their relation is.
  const leftIn = spring({fps, frame, delay: seconds(fps, 0.08), config: {damping: 20, stiffness: 94}});
  const relationIn = spring({fps, frame, delay: seconds(fps, 0.42), config: {damping: 18, stiffness: 112}});
  const rightIn = spring({fps, frame, delay: seconds(fps, 0.68), config: {damping: 20, stiffness: 94}});
  const exitFrames = Math.min(durationInFrames, Math.max(2, seconds(fps, 0.3)));
  const exitStart = Math.max(0, durationInFrames - exitFrames);
  const exit = interpolate(
    frame,
    [exitStart, Math.max(exitStart + 1, durationInFrames - 1)],
    [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  const dense = Math.max(contentWeight(data.left), contentWeight(data.right)) > 22
    || Boolean(data.left.context || data.right.context);
  const stacked = layout.portrait && dense;
  const side = Math.round(width * (layout.portrait ? 0.055 : 0.13));
  const top = Math.round(height * (layout.portrait ? 0.07 : 0.16));
  const gap = Math.round((layout.portrait ? 18 : 24) * layout.unit);
  const relationSize = Math.round((layout.portrait ? 25 : 29) * layout.unit);

  return (
    <div
      style={{
        position: 'absolute',
        left: side,
        right: side,
        top,
        zIndex: 34,
        pointerEvents: 'none',
        opacity: exit,
        display: 'flex',
        flexDirection: stacked ? 'column' : 'row',
        alignItems: 'stretch',
        gap,
      }}
    >
      <SideCard data={data.left} side="left" progress={leftIn} unit={layout.unit} portrait={layout.portrait} />
      <div
        style={{
          alignSelf: 'center',
          flex: '0 0 auto',
          minWidth: stacked ? Math.round(126 * layout.unit) : Math.round(72 * layout.unit),
          padding: `${Math.round(10 * layout.unit)}px ${Math.round(14 * layout.unit)}px`,
          borderRadius: 999,
          fontSize: relationSize,
          lineHeight: 1,
          fontWeight: 900,
          textAlign: 'center',
          color: '#FFFFFF',
          background: 'linear-gradient(120deg, rgba(99,229,231,.18), rgba(42,116,255,.3))',
          border: '1px solid rgba(137,210,255,.24)',
          boxShadow: '0 12px 34px rgba(0,0,0,.25)',
          opacity: relationIn,
          transform: `scale(${interpolate(relationIn, [0, 1], [0.76, 1])})`,
        }}
      >
        {relationCopy[relation]}
      </div>
      <SideCard data={data.right} side="right" progress={rightIn} unit={layout.unit} portrait={layout.portrait} />
    </div>
  );
};
