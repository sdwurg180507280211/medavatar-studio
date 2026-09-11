import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import type {EmphasisCardPrototype} from '../src/production/portraitPrototype';
import {getCompositionLayout} from './layout';

const seconds = (fps: number, value: number) => Math.round(fps * value);

export const EmphasisCard: React.FC<{
  data: EmphasisCardPrototype;
  durationInFrames: number;
}> = ({data, durationInFrames}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const layout = getCompositionLayout(width, height);

  // Prototype choreography remains component-owned. In portrait this is now an
  // overlay above the persistent presenter rather than a full-screen text card.
  const headline = spring({
    fps,
    frame,
    delay: seconds(fps, 0.12),
    config: {damping: 20, stiffness: 90},
  });
  const relation = spring({
    fps,
    frame,
    delay: seconds(fps, 1.18),
    config: {damping: 17, stiffness: 125},
  });
  const support = spring({
    fps,
    frame,
    delay: seconds(fps, 2.22),
    config: {damping: 19, stiffness: 96},
  });
  const hold = interpolate(
    frame,
    [seconds(fps, 3.35), seconds(fps, 4.15)],
    [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  const exitFrames = Math.min(durationInFrames, Math.max(2, seconds(fps, 0.28)));
  const exitStart = Math.max(0, durationInFrames - exitFrames);
  const exit = interpolate(
    frame,
    [exitStart, Math.max(exitStart + 1, durationInFrames - 1)],
    [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );
  const breathe = Math.sin((frame / fps) * Math.PI * 0.72);
  const holdLift = Math.round(breathe * 2 * layout.unit * hold);
  const holdScale = 1 + breathe * 0.006 * hold;
  const exitLift = interpolate(exit, [0, 1], [-Math.round(8 * layout.unit), 0]);

  const side = Math.round(width * (layout.portrait ? 0.055 : 0.16));
  const top = Math.round(height * (layout.portrait ? 0.052 : 0.16));
  const headlineSize = Math.round((layout.portrait ? 58 : 72) * layout.unit);
  const highlightSize = Math.round((layout.portrait ? 76 : 112) * layout.unit);
  const supportSize = Math.round((layout.portrait ? 58 : 72) * layout.unit);
  const gap = Math.round((layout.portrait ? 18 : 28) * layout.unit);
  const glowHeight = Math.round((layout.portrait ? 210 : 300) * layout.unit);

  return (
    <div
      style={{
        position: 'absolute',
        left: side,
        right: side,
        top,
        height: glowHeight,
        zIndex: 34,
        pointerEvents: 'none',
        opacity: exit,
        transform: `translateY(${holdLift + exitLift}px) scale(${holdScale})`,
        transformOrigin: '50% 0%',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: '8%',
          right: '8%',
          top: 0,
          bottom: 0,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse at center, rgba(49,200,216,.13) 0%, rgba(42,116,255,.055) 46%, rgba(7,24,38,0) 74%)',
          opacity: 0.84,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          textAlign: 'center',
          color: '#fff',
          textShadow: '0 8px 30px rgba(0,0,0,.52)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
            columnGap: gap,
            rowGap: Math.round(8 * layout.unit),
            maxWidth: '100%',
          }}
        >
          <div
            style={{
              fontSize: headlineSize,
              lineHeight: 1.08,
              fontWeight: 880,
              letterSpacing: -Math.round(layout.unit),
              whiteSpace: 'nowrap',
              opacity: headline,
              transform: `translateY(${interpolate(headline, [0, 1], [Math.round(24 * layout.unit), 0])}px)`,
            }}
          >
            {data.headline}
          </div>
          <div
            style={{
              minWidth: Math.round(72 * layout.unit),
              padding: `${Math.round(2 * layout.unit)}px ${Math.round(12 * layout.unit)}px`,
              borderRadius: 999,
              fontSize: highlightSize,
              lineHeight: 0.94,
              fontWeight: 950,
              color: '#63E5E7',
              background: 'rgba(99,229,231,.08)',
              border: '1px solid rgba(99,229,231,.18)',
              boxShadow: '0 0 34px rgba(99,229,231,.12)',
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
              whiteSpace: 'nowrap',
              opacity: support,
              transform: `translateY(${interpolate(support, [0, 1], [Math.round(22 * layout.unit), 0])}px)`,
            }}
          >
            {data.support}
            <div
              style={{
                position: 'absolute',
                left: '8%',
                right: '8%',
                bottom: -Math.round(12 * layout.unit),
                height: Math.max(3, Math.round(5 * layout.unit)),
                borderRadius: 999,
                transformOrigin: 'left center',
                transform: `scaleX(${support})`,
                background: 'linear-gradient(90deg, rgba(99,229,231,.18), #63E5E7 42%, #2A74FF 100%)',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
