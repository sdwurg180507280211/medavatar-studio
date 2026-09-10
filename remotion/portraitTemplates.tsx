import React from 'react';
import type {PortraitPrototypeVisual} from '../src/production/portraitPrototype';
import {EmphasisCard} from './EmphasisCard';

export const PortraitPrototypeVisualRenderer: React.FC<{
  visual: PortraitPrototypeVisual;
}> = ({visual}) => {
  switch (visual.template) {
    case 'emphasis-card':
      return <EmphasisCard data={visual} />;
  }
};
