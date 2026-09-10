import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {EmphasisCardPrototype} from '../src/production/portraitPrototype';
import {getCompositionLayout} from './layout';

export const EmphasisCard: React.FC<{data: EmphasisCardPrototype}> = ({data}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const layout = getCompositionLayout(width, height);
  const enter = spring({fps, frame, config: {damping: 18, stiffness: 105}});
  const relation = spring({fps, frame, delay: Math.round(fps * 0.18), config: {damping: 16, stiffness: 145}});
  const support = spring({fps, frame, delay: Math.round(fps * 0.34), config: {damping: 18, stiffness: 110}});
  const side = Math.round(width * (layout.portrait ? 0.09 : 0.18));
  const top = Math.round(height * (layout.portrait ? 0.19 : 0.2));
  const headlineSize = Math.round((layout.portrait ? 86 : 72) * layout.unit);
  const highlightSize = Math.round((layout.portrait ? 154 : 128) * layout.unit);
  const supportSize = Math.round((layout.portrait ? 92 : 76) * layout.unit);
  const glowSize = Math.round(Math.min(width, height) * 0.62);

  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden'}}>
      <div
        style={{
          position: 'absolute',
          width: glowSize,
          height: glowSize,
          left: '50%',
          top: '46%',
          borderRadius: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'radial-gradient(circle, rgba(49,200,216,.18) 0%, rgba(42,116,255,.08) 42%, rgba(7,24,38,0) 72%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: side,
          right: side,
          top,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          color: '#fff',
          textShadow: '0 8px 32px rgba(0,0,0,.34)',
        }}
      >
        <div
          style={{
            fontSize: Math.round(24 * layout.unit),
            fontWeight: 760,
            letterSpacing: Math.round(5 * layout.unit),
            color: 'rgba(142,232,234,.82)',
            marginBottom: Math.round(44 * layout.unit),
            opacity: interpolate(enter, [0, 1], [0, 0.9]),
          }}
        >
          重点理解
        </div>
        <div
          style={{
            fontSize: headlineSize,
            lineHeight: 1.08,
            fontWeight: 880,
            letterSpacing: -Math.round(2 * layout.unit),
            opacity: enter,
            transform: `translateY(${interpolate(enter, [0, 1], [Math.round(42 * layout.unit), 0])}px)`,
          }}
        >
          {data.headline}
        </div>
        <div
          style={{
            margin: `${Math.round(30 * layout.unit)}px 0 ${Math.round(28 * layout.unit)}px`,
            fontSize: highlightSize,
            lineHeight: 0.95,
            fontWeight: 950,
            color: '#63E5E7',
            textShadow: '0 0 42px rgba(99,229,231,.28)',
            opacity: relation,
            transform: `scale(${interpolate(relation, [0, 1], [0.72, 1])})`,
          }}
        >
          {data.highlight}
        </div>
        <div
          style={{
            position: 'relative',
            fontSize: supportSize,
            lineHeight: 1.08,
            fontWeight: 900,
            opacity: support,
            transform: `translateY(${interpolate(support, [0, 1], [Math.round(34 * layout.unit), 0])}px)`,
          }}
        >
          {data.support}
          <div
            style={{
              position: 'absolute',
              left: '12%',
              right: '12%',
              bottom: -Math.round(22 * layout.unit),
              height: Math.max(4, Math.round(7 * layout.unit)),
              borderRadius: 999,
              transformOrigin: 'left center',
              transform: `scaleX(${support})`,
              background: 'linear-gradient(90deg, rgba(99,229,231,.15), #63E5E7 35%, #2A74FF 100%)',
            }}
          />
        </div>
      </div>
    </div>
  );
};
