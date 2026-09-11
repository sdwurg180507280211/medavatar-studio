import type {CompositionRect, Scene, SceneVisual} from '../src/core/schema';
import {
  getCompositionLayout,
  getPipSize,
  getRenderedAvatarLayout,
  getVisualPanelRect,
} from './layout';

export type PresenterPlacement = {rect: CompositionRect; mask: 'none' | 'circle'};

export const clampCompositionRect = (
  rect: CompositionRect,
  width: number,
  height: number,
): CompositionRect => {
  const nextWidth = Math.max(1, Math.min(width, Math.round(rect.width)));
  const nextHeight = Math.max(1, Math.min(height, Math.round(rect.height)));
  return {
    x: Math.max(0, Math.min(width - nextWidth, Math.round(rect.x))),
    y: Math.max(0, Math.min(height - nextHeight, Math.round(rect.y))),
    width: nextWidth,
    height: nextHeight,
  };
};

export const getDefaultPresenterPlacement = (
  scene: Scene,
  width: number,
  height: number,
): PresenterPlacement | undefined => {
  const layout = getRenderedAvatarLayout(scene, width, height);
  if (layout === 'hidden') return undefined;
  const metrics = getCompositionLayout(width, height);
  if (layout === 'hero') {
    return {
      rect: {
        x: Math.round((width - metrics.hero.width) / 2),
        y: metrics.hero.top,
        width: metrics.hero.width,
        height: metrics.hero.height,
      },
      mask: 'none',
    };
  }
  const size = getPipSize(width, height, scene.avatar?.scale ?? 0.28);
  return {
    rect: {
      x: layout === 'bottom-left' ? metrics.pip.margin : width - metrics.pip.margin - size,
      y: height - metrics.pip.margin - size,
      width: size,
      height: size,
    },
    mask: 'circle',
  };
};

export const getDefaultVisualPlacementRect = (
  visual: SceneVisual | undefined,
  width: number,
  height: number,
): CompositionRect => {
  const layout = getCompositionLayout(width, height);
  const portrait = layout.portrait;
  switch (visual?.type) {
    case 'emphasis': {
      const side = Math.round(width * (portrait ? 0.055 : 0.16));
      return {
        x: side,
        y: Math.round(height * (portrait ? 0.052 : 0.16)),
        width: width - side * 2,
        height: Math.round((portrait ? 210 : 300) * layout.unit),
      };
    }
    case 'statistic': {
      const side = Math.round(width * (portrait ? 0.07 : 0.18));
      return {
        x: side,
        y: Math.round(height * (portrait ? 0.075 : 0.18)),
        width: width - side * 2,
        height: Math.round(height * (portrait ? 0.36 : 0.48)),
      };
    }
    case 'comparison': {
      const side = Math.round(width * (portrait ? 0.055 : 0.13));
      return {
        x: side,
        y: Math.round(height * (portrait ? 0.07 : 0.16)),
        width: width - side * 2,
        height: Math.round(height * (portrait ? 0.38 : 0.46)),
      };
    }
    case 'none':
    case undefined:
      return {x: 0, y: 0, width, height};
  }
};

export const getDefaultAnimationPlacementRect = (
  scene: Scene,
  width: number,
  height: number,
): CompositionRect => {
  const rect = getVisualPanelRect(width, height, 'medical_animation', 'hidden');
  return {x: rect.left, y: rect.top, width: rect.width, height: rect.height};
};
