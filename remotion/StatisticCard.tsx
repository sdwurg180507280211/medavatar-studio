import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {SceneVisual} from '../src/core/schema';
import {getCompositionLayout} from './layout';

type StatisticVisual = Extract<SceneVisual, {type: 'statistic'}>;

const seconds = (fps: number, value: number) => Math.round(fps * value);

const presentationGlyph: Record<NonNullable<StatisticVisual['presentation']>, string> = {
  number: '•',
  percent: '%',
  range: '↔',
  trend: '↗',
};

export const StatisticCard: React.FC<{
  data: StatisticVisual;
  durationInFrames: number;
}> = ({data, durationInFrames}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const layout = getCompositionLayout(width, height);
  const presentation = data.presentation ?? 'number';

  // v0.5 keeps choreography renderer-owned. SceneVisual carries medical
  // meaning; it does not become a pixel/timing configuration language.
  const valueIn = spring({
    fps,
    frame,
    delay: seconds(fps, 0.08),
    config: {damping: 18, stiffness: 105},
  });
  const labelIn = spring({
    fps,
    frame,
    delay: seconds(fps, 0.62),
    config: {damping: 20, stiffness: 92},
  });
  const contextIn = spring({
    fps,
    frame,
    delay: seconds(fps, 1.12),
    config: {damping: 20, stiffness: 86},
  });
  const exitFrames = Math.min(durationInFrames, Math.max(2, seconds(fps, 0.3)));
  const exitStart = Math.max(0, durationInFrames - exitFrames);
  const exit = interpolate(
    frame,
    [exitStart, Math.max(exitStart + 1, durationInFrames - 1)],
    [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  const side = Math.round(width * (layout.portrait ? 0.07 : 0.18));
  const top = Math.round(height * (layout.portrait ? 0.075 : 0.18));
  const valueSize = Math.round((layout.portrait ? 122 : 148) * layout.unit);
  const labelSize = Math.round((layout.portrait ? 48 : 58) * layout.unit);
  const contextSize = Math.round((layout.portrait ? 30 : 34) * layout.unit);
  const cardPaddingY = Math.round((layout.portrait ? 38 : 42) * layout.unit);
  const cardPaddingX = Math.round((layout.portrait ? 42 : 50) * layout.unit);
  const glyphSize = Math.round((layout.portrait ? 34 : 40) * layout.unit);

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
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: Math.round(width * (layout.portrait ? 0.86 : 0.62)),
          boxSizing: 'border-box',
          padding: `${cardPaddingY}px ${cardPaddingX}px`,
          borderRadius: Math.round(34 * layout.unit),
          background: 'linear-gradient(145deg, rgba(10,36,54,.94), rgba(6,23,36,.84))',
          border: '1px solid rgba(99,229,231,.22)',
          boxShadow: '0 30px 90px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.05)',
          textAlign: 'center',
          color: '#fff',
          transform: `translateY(${interpolate(valueIn, [0, 1], [Math.round(30 * layout.unit), 0])}px) scale(${interpolate(valueIn, [0, 1], [0.94, 1])})`,
          transformOrigin: '50% 0%',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: Math.round(54 * layout.unit),
            height: Math.round(54 * layout.unit),
            borderRadius: 999,
            marginBottom: Math.round(14 * layout.unit),
            fontSize: glyphSize,
            fontWeight: 850,
            color: '#63E5E7',
            background: 'rgba(99,229,231,.09)',
            border: '1px solid rgba(99,229,231,.2)',
            opacity: valueIn,
          }}
        >
          {presentationGlyph[presentation]}
        </div>
        <div
          style={{
            fontSize: valueSize,
            lineHeight: 0.96,
            fontWeight: 950,
            letterSpacing: -Math.round(3 * layout.unit),
            color: '#FFFFFF',
            textShadow: '0 10px 36px rgba(0,0,0,.42)',
            opacity: valueIn,
          }}
        >
          {data.value}
        </div>
        <div
          style={{
            width: interpolate(valueIn, [0, 1], [0, Math.round(width * (layout.portrait ? 0.34 : 0.22))]),
            maxWidth: '72%',
            height: Math.max(3, Math.round(5 * layout.unit)),
            margin: `${Math.round(24 * layout.unit)}px auto 0`,
            borderRadius: 999,
            background: 'linear-gradient(90deg, rgba(99,229,231,.18), #63E5E7 48%, #2A74FF 100%)',
            boxShadow: '0 0 28px rgba(99,229,231,.2)',
          }}
        />
        {data.label ? (
          <div
            style={{
              marginTop: Math.round(22 * layout.unit),
              fontSize: labelSize,
              lineHeight: 1.12,
              fontWeight: 820,
              opacity: labelIn,
              transform: `translateY(${interpolate(labelIn, [0, 1], [Math.round(18 * layout.unit), 0])}px)`,
            }}
          >
            {data.label}
          </div>
        ) : null}
        {data.context ? (
          <div
            style={{
              marginTop: Math.round(15 * layout.unit),
              fontSize: contextSize,
              lineHeight: 1.35,
              fontWeight: 620,
              color: 'rgba(232,246,252,.72)',
              opacity: contextIn,
              transform: `translateY(${interpolate(contextIn, [0, 1], [Math.round(14 * layout.unit), 0])}px)`,
            }}
          >
            {data.context}
          </div>
        ) : null}
      </div>
    </div>
  );
};
