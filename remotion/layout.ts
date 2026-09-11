import type {Scene, SceneType} from '../src/core/schema';

export type RenderOrientation = 'landscape' | 'portrait';
export type VisualAvatarLayout = 'hero' | 'bottom-left' | 'bottom-right' | 'hidden';
export type PanelRect = {left: number; top: number; width: number; height: number};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value);

export const getSceneAvatarLayout = (scene: Scene): VisualAvatarLayout => {
  const layout = scene.avatar?.layout ?? (scene.type === 'doctor_full' ? 'hero' : 'bottom-right');
  return layout === 'fullscreen' ? 'hero' : layout;
};

// A full 16:9 slide and a portrait presenter compete for the same vertical space.
// Keep the authored PiP value for editor provenance, but render doctor_ppt as a
// presenter-led scene on a portrait canvas.
export const getRenderedAvatarLayout = (
  scene: Scene,
  width: number,
  height: number,
): VisualAvatarLayout => {
  const layout = getSceneAvatarLayout(scene);
  return height > width && scene.type === 'doctor_ppt' && layout !== 'hidden' ? 'hero' : layout;
};

export const getCompositionLayout = (width: number, height: number) => {
  const orientation: RenderOrientation = height > width ? 'portrait' : 'landscape';
  const portrait = orientation === 'portrait';
  const shortSide = Math.min(width, height);
  const unit = clamp(shortSide / 1080, 0.58, 1.45);
  const edge = round(shortSide * 0.05);
  const titleSide = round(width * (portrait ? 0.06 : 0.094));
  const titleTop = round(height * (portrait ? 0.055 : 0.039));
  const heroTop = round(height * (portrait ? 0.12 : 0.17));
  const heroMaxHeight = height - heroTop;
  const heroMaxWidth = width * (portrait ? 0.92 : 0.64);
  const heroHeight = Math.min(heroMaxHeight, heroMaxWidth * 16 / 9);
  const heroWidth = heroHeight * 9 / 16;

  return {
    orientation,
    portrait,
    width,
    height,
    shortSide,
    unit,
    edge,
    title: {
      side: titleSide,
      top: titleTop,
      maxWidth: round(width * (portrait ? 0.86 : 0.69)),
      fontSize: round(64 * unit * (portrait ? 0.9 : 1)),
      accentWidth: round(190 * unit),
      accentHeight: Math.max(3, round(6 * unit)),
      accentMarginTop: round(18 * unit),
      enterOffset: round(30 * unit),
    },
    hero: {
      top: heroTop,
      width: round(heroWidth),
      height: round(heroHeight),
      radius: round(28 * unit),
    },
    pip: {
      margin: edge,
      border: Math.max(3, round(6 * unit)),
      min: round(shortSide * 0.22),
      max: round(shortSide * 0.48),
    },
    bottomFadeHeight: round(portrait ? height * 0.29 : shortSide * 0.176),
  };
};

export const getPipSize = (width: number, height: number, scale = 0.28) => {
  const layout = getCompositionLayout(width, height);
  const normalized = scale / 0.28;
  const size = layout.shortSide * 0.33 * normalized;
  return round(clamp(size, layout.pip.min, layout.pip.max));
};

export const getSubtitlePlacement = (
  width: number,
  height: number,
  avatarLayout: VisualAvatarLayout,
  pipSize: number,
) => {
  const layout = getCompositionLayout(width, height);
  if (layout.portrait) {
    const side = round(layout.shortSide * 0.055);
    const bottom = avatarLayout === 'bottom-left' || avatarLayout === 'bottom-right'
      ? layout.pip.margin + pipSize + round(layout.shortSide * 0.025)
      : round(layout.shortSide * 0.045);
    return {left: side, right: side, bottom};
  }

  const outer = round(layout.shortSide * 0.139);
  const pipGap = round(layout.shortSide * 0.12);
  if (avatarLayout === 'bottom-right') {
    return {left: outer, right: pipSize + pipGap, bottom: round(layout.shortSide * 0.035)};
  }
  if (avatarLayout === 'bottom-left') {
    return {left: pipSize + pipGap, right: outer, bottom: round(layout.shortSide * 0.035)};
  }
  const centered = round(layout.shortSide * 0.306);
  return {left: centered, right: centered, bottom: round(layout.shortSide * 0.035)};
};

export const getVisualPanelRect = (
  width: number,
  height: number,
  sceneType: SceneType,
  avatarLayout: VisualAvatarLayout,
): PanelRect => {
  const layout = getCompositionLayout(width, height);
  if (layout.portrait) {
    const margin = round(width * 0.05);
    const panelWidth = sceneType === 'doctor_ppt'
      ? round(width * 0.34)
      : width - margin * 2;
    const aspect = sceneType === 'medical_animation' ? 1360 / 790 : 16 / 9;
    const panelHeight = Math.min(round(panelWidth / aspect), round(height * 0.39));
    const top = sceneType === 'doctor_ppt'
      ? round(height * 0.09)
      : round(height * (sceneType === 'visual_full' ? 0.16 : 0.075));
    return {left: margin, top, width: panelWidth, height: panelHeight};
  }

  const top = round(height * (sceneType === 'medical_animation' ? 0.065 : 0.056));
  const bottom = round(height * 0.111);
  if (sceneType === 'visual_full') {
    return {
      left: layout.edge,
      top,
      width: width - layout.edge * 2,
      height: height - top - bottom,
    };
  }

  const panelWidth = round(width * (sceneType === 'medical_animation' ? 0.7083 : 0.646));
  const panelHeight = sceneType === 'medical_animation'
    ? round(height * 0.7315)
    : height - top - bottom;
  const left = avatarLayout === 'bottom-left' ? width - layout.edge - panelWidth : layout.edge;
  return {left, top, width: panelWidth, height: panelHeight};
};
