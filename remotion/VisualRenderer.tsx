import React from 'react';
import type {Scene, SceneVisual} from '../src/core/schema';
import {EmphasisCard} from './EmphasisCard';

export const VisualRenderer: React.FC<{
  visual?: SceneVisual;
  scene: Scene;
  durationInFrames: number;
}> = ({visual, durationInFrames}) => {
  if (!visual || visual.type === 'none') return null;

  switch (visual.type) {
    case 'emphasis':
      return <EmphasisCard data={visual} durationInFrames={durationInFrames} />;
  }
};
