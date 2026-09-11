import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Player, type PlayerRef} from '@remotion/player';
import {Timeline, type TimelineState} from '@xzdarcy/react-timeline-editor';
import type {TimelineAction, TimelineEffect, TimelineRow} from '@xzdarcy/timeline-engine';
import '@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css';
import {MedAvatarVideo} from '../../remotion/Video';
import {
  clampCompositionRect,
  getDefaultAnimationPlacementRect,
  getDefaultPresenterPlacement,
  getDefaultVisualPlacementRect,
} from '../../remotion/compositionGeometry';
import {
  calibrateSceneComposition,
  getCompositionCalibrationStatus,
  getCompositionItem,
  makeCompositionBasis,
  nextCompositionItemId,
  removeCompositionItem,
  replaceCompositionItem,
  splitCompositionItem,
  type CompositionItem,
} from '../../src/core/composition';
import {buildSceneFrameTimeline, framesToSeconds, getProjectDurationInFrames} from '../../src/core/frameMath';
import type {StoryboardOverrides} from '../../src/core/overrides';
import type {
  AnimationOverlay,
  CompositionBasis,
  CompositionOverlay,
  CompositionRect,
  MedAvatarProject,
  PresenterSegment,
  Scene,
  SceneComposition,
  TextOverlay,
  VisualSegment,
} from '../../src/core/schema';
import {setSceneComposition} from '../../src/editor/compositionDraft';
import type {EditorProjectPayload} from '../../src/production/renderProps';

const ANIMATION_PRESETS = ['artery-pressure', 'plaque-growth', 'heart-beat', 'risk-pathway'] as const;
const TRACKS = [
  ['presenter', '数字人'],
  ['visual', '主视觉'],
  ['animation', '动画'],
  ['text', '文字'],
  ['subtitle', '字幕 🔒'],
  ['audio', '旁白 🔒'],
] as const;
type TrackId = typeof TRACKS[number][0];
type EditableTrackId = Exclude<TrackId, 'subtitle' | 'audio'>;

type TimelineActionMeta = TimelineAction & {track?: TrackId; label?: string};
type ProjectedComposition = {
  presenter: PresenterSegment[];
  visual: VisualSegment[];
  overlays: CompositionOverlay[];
};
type CompositionItemPatch = {
  startFrame?: number;
  endFrame?: number;
  rect?: CompositionRect;
  zIndex?: number;
  text?: string;
  name?: string;
  mask?: 'none' | 'circle';
  style?: TextOverlay['style'];
};

type GestureState = {
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  startRect: CompositionRect;
  startDraft: StoryboardOverrides;
};

const requestJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const body = await response.json() as T & {error?: string};
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
};

const formatFrameTime = (frame: number, fps: number) => {
  const seconds = Math.max(0, frame) / fps;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${(seconds - minutes * 60).toFixed(2).padStart(5, '0')}`;
};

const clampFrame = (frame: number, durationInFrames: number) =>
  Math.max(0, Math.min(Math.max(0, durationInFrames - 1), Math.round(frame)));

const rectsOverlap = (a: CompositionRect, b: CompositionRect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

const projectedComposition = (
  scene: Scene,
  durationInFrames: number,
  width: number,
  height: number,
): ProjectedComposition => {
  const legacyPresenter = getDefaultPresenterPlacement(scene, width, height);
  const presenter: PresenterSegment[] = scene.composition?.presenter ?? (legacyPresenter ? [{
    id: 'presenter-legacy',
    startFrame: 0,
    endFrame: durationInFrames,
    rect: legacyPresenter.rect,
    mask: legacyPresenter.mask,
  }] : []);
  const visual: VisualSegment[] = scene.composition?.visual ?? (scene.visual && scene.visual.type !== 'none' ? [{
    id: 'visual-legacy',
    startFrame: 0,
    endFrame: durationInFrames,
    rect: getDefaultVisualPlacementRect(scene.visual, width, height),
    playbackOffsetFrame: 0,
  }] : []);
  return {
    presenter: structuredClone(presenter),
    visual: structuredClone(visual),
    overlays: structuredClone(scene.composition?.overlays ?? []),
  };
};

const mergeLocalComposition = (
  payload: EditorProjectPayload,
  overrides: StoryboardOverrides,
): MedAvatarProject => ({
  ...payload.effective,
  scenes: payload.effective.scenes.map((scene) => {
    const base = payload.base.scenes.find((item) => item.id === scene.id);
    const compositionOverride = overrides.scenes[scene.id]?.composition;
    const composition = compositionOverride
      ? {...base?.composition, ...compositionOverride}
      : base?.composition;
    return {...scene, composition};
  }),
});

const cleanCompositionOverride = (composition: Partial<SceneComposition>) => {
  const next = {...composition};
  if (next.presenter === undefined) delete next.presenter;
  if (next.visual === undefined) delete next.visual;
  if (next.overlays === undefined) delete next.overlays;
  if (next.presenter === undefined && next.visual === undefined && next.overlays === undefined) return undefined;
  return next as SceneComposition;
};

const writeTrack = (
  overrides: StoryboardOverrides,
  sceneId: string,
  track: EditableTrackId,
  items: PresenterSegment[] | VisualSegment[] | CompositionOverlay[],
  basis: CompositionBasis,
) => {
  const current = overrides.scenes[sceneId]?.composition ?? {};
  const patch: Partial<SceneComposition> = {...current, basis};
  if (track === 'presenter') patch.presenter = items as PresenterSegment[];
  else if (track === 'visual') patch.visual = items as VisualSegment[];
  else patch.overlays = items as CompositionOverlay[];
  return setSceneComposition(overrides, sceneId, cleanCompositionOverride(patch));
};

const resetTrack = (
  overrides: StoryboardOverrides,
  sceneId: string,
  track: EditableTrackId,
) => {
  const current = overrides.scenes[sceneId]?.composition;
  if (!current) return overrides;
  const next: Partial<SceneComposition> = {...current};
  if (track === 'presenter') delete next.presenter;
  else if (track === 'visual') delete next.visual;
  else delete next.overlays;
  return setSceneComposition(overrides, sceneId, cleanCompositionOverride(next));
};

const timelineRows = (
  composition: ProjectedComposition,
  durationInFrames: number,
  fps: number,
): TimelineRow[] => {
  const toAction = (item: CompositionItem, track: TrackId, label: string): TimelineActionMeta => ({
    id: item.id,
    start: item.startFrame / fps,
    end: item.endFrame / fps,
    effectId: track,
    track,
    label,
  });
  const animations = composition.overlays.filter((item): item is AnimationOverlay => item.type === 'animation');
  const texts = composition.overlays.filter((item): item is TextOverlay => item.type === 'text');
  const duration = durationInFrames / fps;
  return [
    {id: 'presenter', actions: composition.presenter.map((item) => toAction(item, 'presenter', '数字人'))},
    {id: 'visual', actions: composition.visual.map((item) => toAction(item, 'visual', '主视觉'))},
    {id: 'animation', actions: animations.map((item) => toAction(item, 'animation', item.name))},
    {id: 'text', actions: texts.map((item) => toAction(item, 'text', item.text.slice(0, 18)))},
    {id: 'subtitle', actions: [{id: 'subtitle-locked', start: 0, end: duration, effectId: 'subtitle', track: 'subtitle', label: '自动字幕', movable: false, flexible: false} as TimelineActionMeta]},
    {id: 'audio', actions: [{id: 'audio-locked', start: 0, end: duration, effectId: 'audio', track: 'audio', label: '旁白主时钟', movable: false, flexible: false} as TimelineActionMeta]},
  ];
};

const effects: Record<string, TimelineEffect> = Object.fromEntries(
  TRACKS.map(([id, label]) => [id, {id, name: label}]),
);

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const ComposerApp: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const projectName = params.get('project') ?? 'demo';
  const projectApi = `/api/projects/${encodeURIComponent(projectName)}`;
  const [payload, setPayload] = useState<EditorProjectPayload | null>(null);
  const [savedOverrides, setSavedOverrides] = useState<StoryboardOverrides | null>(null);
  const [draftOverrides, setDraftOverrides] = useState<StoryboardOverrides | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string>();
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const [currentFrame, setCurrentFrame] = useState(0);
  const [timelineScaleWidth, setTimelineScaleWidth] = useState(120);
  const [error, setError] = useState<string>();
  const [editError, setEditError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [undoStack, setUndoStack] = useState<StoryboardOverrides[]>([]);
  const [redoStack, setRedoStack] = useState<StoryboardOverrides[]>([]);
  const playerRef = useRef<PlayerRef>(null);
  const timelineRef = useRef<TimelineState>(null);
  const playerWrapRef = useRef<HTMLDivElement>(null);
  const resolveVersionRef = useRef(0);
  const draftRevisionRef = useRef(0);
  const timelineStartDraftRef = useRef<StoryboardOverrides>();
  const timelineEditKindRef = useRef<'move' | 'resize-left' | 'resize-right'>('move');
  const timelineEditTrackRef = useRef<EditableTrackId>();
  const gestureRef = useRef<GestureState>();

  useEffect(() => {
    requestJson<EditorProjectPayload>(projectApi).then((next) => {
      setPayload(next);
      setSavedOverrides(next.overrides);
      setDraftOverrides(next.overrides);
      setSelectedSceneId(next.effective.scenes[0]?.id);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [projectApi]);

  const dirty = Boolean(savedOverrides && draftOverrides && !sameJson(savedOverrides, draftOverrides));
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const localProject = useMemo(() => payload && draftOverrides
    ? mergeLocalComposition(payload, draftOverrides)
    : payload?.effective, [payload, draftOverrides]);
  const sceneTimeline = useMemo(() => localProject
    ? buildSceneFrameTimeline(localProject.scenes, localProject.video.fps)
    : [], [localProject]);
  const selectedSceneIndex = localProject?.scenes.findIndex((scene) => scene.id === selectedSceneId) ?? -1;
  const selectedScene = selectedSceneIndex >= 0 ? localProject?.scenes[selectedSceneIndex] : localProject?.scenes[0];
  const selectedSpan = sceneTimeline.find((span) => span.sceneId === selectedScene?.id) ?? sceneTimeline[0];
  const video = localProject?.video ?? {fps: 25, width: 1080, height: 1920};
  const fps = video.fps;
  const sceneDurationFrames = selectedSpan?.durationInFrames ?? fps;
  const sceneStartFrame = selectedSpan?.startFrame ?? 0;
  const currentLocalFrame = clampFrame(currentFrame - sceneStartFrame, sceneDurationFrames);
  const compositionBasis = makeCompositionBasis(selectedScene ?? {text: ''}, sceneDurationFrames, video);
  const calibrationStatus = selectedScene
    ? getCompositionCalibrationStatus(selectedScene, video)
    : {state: 'current' as const, reasons: []};
  const composition = useMemo(() => selectedScene && localProject
    ? projectedComposition(selectedScene, sceneDurationFrames, localProject.video.width, localProject.video.height)
    : {presenter: [], visual: [], overlays: []}, [selectedScene, sceneDurationFrames, localProject]);
  const rows = useMemo(() => timelineRows(composition, sceneDurationFrames, fps), [composition, sceneDurationFrames, fps]);
  const selectedItem = getCompositionItem(composition, selectedItemId);
  const selectedTrack: EditableTrackId | undefined = selectedItem
    ? composition.presenter.some((item) => item.id === selectedItem.id)
      ? 'presenter'
      : composition.visual.some((item) => item.id === selectedItem.id)
        ? 'visual'
        : 'type' in selectedItem && selectedItem.type === 'animation' ? 'animation' : 'text'
    : undefined;
  const projectDurationInFrames = localProject ? getProjectDurationInFrames(localProject) : fps;
  const subtitleSafeRect: CompositionRect = {
    x: Math.round(video.width * 0.06),
    y: Math.round(video.height * (video.height > video.width ? 0.76 : 0.78)),
    width: Math.round(video.width * 0.88),
    height: Math.round(video.height * 0.18),
  };
  const selectedOverlapsSubtitle = Boolean(selectedItem && rectsOverlap(selectedItem.rect, subtitleSafeRect));

  const optimisticDraft = (next: StoryboardOverrides) => {
    draftRevisionRef.current += 1;
    setDraftOverrides(next);
    setEditError(undefined);
  };

  const resolveDraft = async (next: StoryboardOverrides) => {
    const version = ++resolveVersionRef.current;
    try {
      const resolved = await requestJson<EditorProjectPayload>(`${projectApi}/resolve`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(next),
      });
      if (version === resolveVersionRef.current) setPayload(resolved);
    } catch (reason) {
      if (version === resolveVersionRef.current) {
        setEditError(reason instanceof Error ? reason.message : String(reason));
      }
    }
  };

  const commit = (previous: StoryboardOverrides, next: StoryboardOverrides) => {
    if (sameJson(previous, next)) return;
    setUndoStack((stack) => [...stack.slice(-59), structuredClone(previous)]);
    setRedoStack([]);
    optimisticDraft(next);
    void resolveDraft(next);
  };

  const applyDirect = (mutator: (current: StoryboardOverrides) => StoryboardOverrides) => {
    if (!draftOverrides) return;
    const previous = structuredClone(draftOverrides);
    const next = mutator(draftOverrides);
    commit(previous, next);
  };

  const doUndo = () => {
    if (!draftOverrides || undoStack.length === 0) return;
    const previous = undoStack.at(-1)!;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack.slice(-59), structuredClone(draftOverrides)]);
    optimisticDraft(previous);
    void resolveDraft(previous);
  };

  const doRedo = () => {
    if (!draftOverrides || redoStack.length === 0) return;
    const next = redoStack.at(-1)!;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack.slice(-59), structuredClone(draftOverrides)]);
    optimisticDraft(next);
    void resolveDraft(next);
  };

  const save = async () => {
    if (!draftOverrides || !dirty) return;
    const snapshot = structuredClone(draftOverrides);
    const revision = draftRevisionRef.current;
    // Invalidate older resolve requests. A later edit will allocate a newer version.
    resolveVersionRef.current += 1;
    setSaving(true);
    setEditError(undefined);
    try {
      const saved = await requestJson<EditorProjectPayload>(`${projectApi}/overrides`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(snapshot),
      });
      setSavedOverrides(saved.overrides);
      if (revision === draftRevisionRef.current) {
        setPayload(saved);
        setDraftOverrides(saved.overrides);
        setUndoStack([]);
        setRedoStack([]);
      }
    } catch (reason) {
      setEditError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      const frame = playerRef.current?.getCurrentFrame();
      if (frame === undefined) return;
      setCurrentFrame(frame);
      const active = sceneTimeline.find((span) => frame >= span.startFrame && frame < span.endFrame);
      if (active && active.sceneId !== selectedSceneId) {
        setSelectedSceneId(active.sceneId);
        setSelectedItemId(undefined);
      }
      const local = active ? frame - active.startFrame : currentLocalFrame;
      timelineRef.current?.setTime(local / fps);
    }, 50);
    return () => window.clearInterval(timer);
  }, [sceneTimeline, selectedSceneId, fps, currentLocalFrame]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) doRedo(); else doUndo();
      } else if (event.key === 'Escape' && gestureRef.current && draftOverrides) {
        const start = gestureRef.current.startDraft;
        gestureRef.current = undefined;
        optimisticDraft(start);
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedItemId) {
        const target = event.target as HTMLElement | null;
        if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
        event.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  if (error) return <div className="composer-center composer-error">{error}</div>;
  if (!payload || !draftOverrides || !localProject || !selectedScene || !selectedSpan) {
    return <div className="composer-center">Loading {projectName}…</div>;
  }

  const writeEditableTrack = (
    track: EditableTrackId,
    items: PresenterSegment[] | VisualSegment[] | CompositionOverlay[],
  ) => writeTrack(draftOverrides, selectedScene.id, track, items, compositionBasis);

  const constraintAllows = (track: TrackId, actionId: string, start: number, end: number) => {
    if (calibrationStatus.state !== 'current' || track === 'subtitle' || track === 'audio') return false;
    const startFrame = Math.round(start * fps);
    const endFrame = Math.round(end * fps);
    if (startFrame < 0 || endFrame <= startFrame || endFrame > sceneDurationFrames) return false;
    if (track !== 'presenter' && track !== 'visual') return true;
    const peers = track === 'presenter' ? composition.presenter : composition.visual;
    return !peers.some((item) => item.id !== actionId && startFrame < item.endFrame && endFrame > item.startFrame);
  };

  const updateTrackFromRows = (nextRows: TimelineRow[], track: EditableTrackId) => {
    const row = nextRows.find((item) => item.id === track);
    if (!row) return draftOverrides;
    const currentItems: CompositionItem[] = track === 'presenter'
      ? composition.presenter
      : track === 'visual'
        ? composition.visual
        : composition.overlays;
    const byId = new Map(currentItems.map((item) => [item.id, item]));
    const mapAction = (action: TimelineAction): CompositionItem | undefined => {
      const old = byId.get(action.id);
      if (!old) return undefined;
      const startFrame = Math.max(0, Math.round(action.start * fps));
      const endFrame = Math.min(sceneDurationFrames, Math.round(action.end * fps));
      const next = {...old, startFrame, endFrame} as CompositionItem;
      const kind = timelineEditKindRef.current;
      if (kind === 'resize-left' && startFrame !== old.startFrame) {
        if ('type' in next && next.type === 'animation') {
          next.playbackOffsetFrame = Math.max(0, (next.playbackOffsetFrame ?? 0) + startFrame - old.startFrame);
        } else if (!('type' in next) && 'playbackOffsetFrame' in next) {
          next.playbackOffsetFrame = Math.max(0, (next.playbackOffsetFrame ?? 0) + startFrame - old.startFrame);
        }
      }
      return next;
    };
    if (track === 'presenter' || track === 'visual') {
      const mapped = row.actions.map(mapAction).filter(Boolean) as CompositionItem[];
      return writeEditableTrack(track, mapped as PresenterSegment[] | VisualSegment[]);
    }
    const otherOverlayTrack = track === 'animation' ? 'text' : 'animation';
    const otherRow = nextRows.find((item) => item.id === otherOverlayTrack);
    const updated = row.actions.map(mapAction).filter(Boolean) as CompositionOverlay[];
    const other = otherRow?.actions.map((action) => byId.get(action.id)).filter(Boolean) as CompositionOverlay[] ?? [];
    return writeEditableTrack(track, [...updated, ...other]);
  };

  const onTimelineChange = (nextRows: TimelineRow[]) => {
    const track = timelineEditTrackRef.current;
    const startDraft = timelineStartDraftRef.current;
    if (!track || !startDraft) return;
    const next = updateTrackFromRows(nextRows, track);
    timelineStartDraftRef.current = undefined;
    timelineEditTrackRef.current = undefined;
    commit(startDraft, next);
  };

  const selectScene = (sceneId: string) => {
    const span = sceneTimeline.find((item) => item.sceneId === sceneId);
    if (!span) return;
    setSelectedSceneId(sceneId);
    setSelectedItemId(undefined);
    setCurrentFrame(span.startFrame);
    playerRef.current?.seekTo(span.startFrame);
    timelineRef.current?.setTime(0);
  };

  const seekLocal = (time: number) => {
    const localFrame = clampFrame(Math.round(time * fps), sceneDurationFrames);
    const global = sceneStartFrame + localFrame;
    setCurrentFrame(global);
    playerRef.current?.seekTo(global);
    timelineRef.current?.setTime(localFrame / fps);
  };

  const addText = () => {
    if (calibrationStatus.state !== 'current') return;
    const startFrame = currentLocalFrame;
    const endFrame = Math.min(sceneDurationFrames, startFrame + Math.max(1, fps * 2));
    const id = nextCompositionItemId(composition, 'text');
    const overlay: TextOverlay = {
      id,
      type: 'text',
      startFrame,
      endFrame: Math.max(startFrame + 1, endFrame),
      text: '新文字',
      rect: clampCompositionRect({x: localProject.video.width * 0.12, y: localProject.video.height * 0.36, width: localProject.video.width * 0.76, height: localProject.video.height * 0.11}, localProject.video.width, localProject.video.height),
      zIndex: 38,
    };
    applyDirect((current) => writeTrack(current, selectedScene.id, 'text', [...composition.overlays, overlay], compositionBasis));
    setSelectedItemId(id);
  };

  const addAnimation = () => {
    if (calibrationStatus.state !== 'current') return;
    const startFrame = currentLocalFrame;
    const endFrame = Math.min(sceneDurationFrames, startFrame + Math.max(1, fps * 4));
    const id = nextCompositionItemId(composition, 'animation');
    const overlay: AnimationOverlay = {
      id,
      type: 'animation',
      name: 'artery-pressure',
      startFrame,
      endFrame: Math.max(startFrame + 1, endFrame),
      playbackOffsetFrame: 0,
      rect: getDefaultAnimationPlacementRect(selectedScene, localProject.video.width, localProject.video.height),
      zIndex: 32,
    };
    applyDirect((current) => writeTrack(current, selectedScene.id, 'animation', [...composition.overlays, overlay], compositionBasis));
    setSelectedItemId(id);
  };

  const restorePresenter = () => {
    if (calibrationStatus.state !== 'current') return;
    const placement = getDefaultPresenterPlacement(selectedScene, localProject.video.width, localProject.video.height);
    if (!placement) return;
    const id = nextCompositionItemId(composition, 'presenter');
    const segment: PresenterSegment = {id, startFrame: 0, endFrame: sceneDurationFrames, rect: placement.rect, mask: placement.mask};
    applyDirect((current) => writeTrack(current, selectedScene.id, 'presenter', [segment], compositionBasis));
    setSelectedItemId(id);
  };

  const restoreVisual = () => {
    if (calibrationStatus.state !== 'current') return;
    if (!selectedScene.visual || selectedScene.visual.type === 'none') return;
    const id = nextCompositionItemId(composition, 'visual');
    const segment: VisualSegment = {
      id,
      startFrame: 0,
      endFrame: sceneDurationFrames,
      rect: getDefaultVisualPlacementRect(selectedScene.visual, localProject.video.width, localProject.video.height),
      playbackOffsetFrame: 0,
    };
    applyDirect((current) => writeTrack(current, selectedScene.id, 'visual', [segment], compositionBasis));
    setSelectedItemId(id);
  };

  const splitSelected = () => {
    if (calibrationStatus.state !== 'current') return;
    if (!selectedItem || currentLocalFrame <= selectedItem.startFrame || currentLocalFrame >= selectedItem.endFrame) return;
    const prefix = selectedItemId?.split('-')[0] ?? 'clip';
    const rightId = nextCompositionItemId(composition, prefix);
    const [left, right] = splitCompositionItem(selectedItem, currentLocalFrame, rightId);
    const nextComposition = replaceCompositionItem(composition, selectedItem.id, [left, right]);
    const track = selectedTrack;
    if (track === 'presenter') applyDirect((current) => writeTrack(current, selectedScene.id, track, nextComposition.presenter ?? [], compositionBasis));
    else if (track === 'visual') applyDirect((current) => writeTrack(current, selectedScene.id, track, nextComposition.visual ?? [], compositionBasis));
    else applyDirect((current) => writeTrack(current, selectedScene.id, track ?? 'text', nextComposition.overlays ?? [], compositionBasis));
    setSelectedItemId(rightId);
  };

  function deleteSelected() {
    if (!selectedScene) return;
    if (calibrationStatus.state !== 'current') return;
    if (!selectedItemId) return;
    const nextComposition = removeCompositionItem(composition, selectedItemId);
    if (composition.presenter.some((item) => item.id === selectedItemId)) {
      applyDirect((current) => writeTrack(current, selectedScene.id, 'presenter', nextComposition.presenter ?? [], compositionBasis));
    } else if (composition.visual.some((item) => item.id === selectedItemId)) {
      applyDirect((current) => writeTrack(current, selectedScene.id, 'visual', nextComposition.visual ?? [], compositionBasis));
    } else {
      applyDirect((current) => writeTrack(current, selectedScene.id, 'text', nextComposition.overlays ?? [], compositionBasis));
    }
    setSelectedItemId(undefined);
  }

  const updateSelected = (patch: CompositionItemPatch, resolve = true) => {
    if (calibrationStatus.state !== 'current') return;
    if (patch.text !== undefined && patch.text.trim().length === 0) return;
    if (!selectedItem || !draftOverrides || !selectedTrack) return;
    const nextItem = {...selectedItem, ...patch} as CompositionItem;
    if ('rect' in patch && patch.rect) {
      nextItem.rect = clampCompositionRect(patch.rect, localProject.video.width, localProject.video.height);
    }
    if (patch.zIndex !== undefined) {
      nextItem.zIndex = Math.max(0, Math.min(999, Math.round(patch.zIndex)));
    }
    if ('type' in nextItem && nextItem.type === 'text' && patch.style?.fontSize !== undefined) {
      nextItem.style = {...nextItem.style, ...patch.style, fontSize: Math.max(1, Math.min(240, patch.style.fontSize))};
    }
    nextItem.startFrame = Math.max(0, Math.round(nextItem.startFrame));
    nextItem.endFrame = Math.min(sceneDurationFrames, Math.round(nextItem.endFrame));
    if (!constraintAllows(selectedTrack, selectedItem.id, nextItem.startFrame / fps, nextItem.endFrame / fps)) return;
    if (patch.startFrame !== undefined && nextItem.startFrame !== selectedItem.startFrame) {
      const delta = nextItem.startFrame - selectedItem.startFrame;
      if ('type' in nextItem && nextItem.type === 'animation') {
        nextItem.playbackOffsetFrame = Math.max(0, (('type' in selectedItem && selectedItem.type === 'animation') ? selectedItem.playbackOffsetFrame : 0) + delta);
      } else if (!('type' in nextItem) && 'playbackOffsetFrame' in nextItem) {
        const previousOffset = !('type' in selectedItem) && 'playbackOffsetFrame' in selectedItem ? selectedItem.playbackOffsetFrame : 0;
        nextItem.playbackOffsetFrame = Math.max(0, previousOffset + delta);
      }
    }
    const nextComposition = replaceCompositionItem(composition, selectedItem.id, nextItem);
    let next: StoryboardOverrides;
    if (composition.presenter.some((item) => item.id === selectedItem.id)) {
      next = writeTrack(draftOverrides, selectedScene.id, 'presenter', nextComposition.presenter ?? [], compositionBasis);
    } else if (composition.visual.some((item) => item.id === selectedItem.id)) {
      next = writeTrack(draftOverrides, selectedScene.id, 'visual', nextComposition.visual ?? [], compositionBasis);
    } else {
      next = writeTrack(draftOverrides, selectedScene.id, 'text', nextComposition.overlays ?? [], compositionBasis);
    }
    if (resolve) commit(structuredClone(draftOverrides), next);
    else optimisticDraft(next);
  };

  const beginCanvasGesture = (event: React.PointerEvent, mode: 'move' | 'resize') => {
    if (calibrationStatus.state !== 'current') return;
    if (!selectedItem || !draftOverrides) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startRect: structuredClone(selectedItem.rect),
      startDraft: structuredClone(draftOverrides),
    };
  };

  const moveCanvasGesture = (event: React.PointerEvent) => {
    const gesture = gestureRef.current;
    const wrap = playerWrapRef.current;
    if (!gesture || !wrap || !selectedItem) return;
    const bounds = wrap.getBoundingClientRect();
    const dx = (event.clientX - gesture.startX) * localProject.video.width / bounds.width;
    const dy = (event.clientY - gesture.startY) * localProject.video.height / bounds.height;
    const rect = gesture.mode === 'move'
      ? {...gesture.startRect, x: gesture.startRect.x + dx, y: gesture.startRect.y + dy}
      : {...gesture.startRect, width: Math.max(24, gesture.startRect.width + dx), height: Math.max(24, gesture.startRect.height + dy)};
    updateSelected({rect: clampCompositionRect(rect, localProject.video.width, localProject.video.height)}, false);
  };

  const endCanvasGesture = (event: React.PointerEvent) => {
    const gesture = gestureRef.current;
    if (!gesture || !draftOverrides) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    gestureRef.current = undefined;
    const next = structuredClone(draftOverrides);
    if (!sameJson(gesture.startDraft, next)) {
      setUndoStack((stack) => [...stack.slice(-59), gesture.startDraft]);
      setRedoStack([]);
      void resolveDraft(next);
    }
  };

  const calibrateCurrentScene = () => {
    if (!selectedScene.composition) return;
    const calibrated = calibrateSceneComposition(selectedScene.composition, compositionBasis);
    applyDirect((current) => setSceneComposition(current, selectedScene.id, calibrated));
  };

  const selectedVisible = selectedItem
    && currentLocalFrame >= selectedItem.startFrame
    && currentLocalFrame < selectedItem.endFrame;
  const explicit = selectedScene.composition;

  return (
    <div className="composer-shell">
      <header className="composer-header">
        <div><strong>MedAvatar Composer</strong><span>{projectName}</span></div>
        <div className="composer-header-actions">
          {editError ? <span className="composer-error-inline">{editError}</span> : null}
          <button onClick={doUndo} disabled={!undoStack.length}>撤销</button>
          <button onClick={doRedo} disabled={!redoStack.length}>重做</button>
          <a href={`/?project=${encodeURIComponent(projectName)}&legacy=1`}>Legacy Inspector</a>
          <button className="primary" onClick={() => void save()} disabled={!dirty || saving}>{saving ? '保存中…' : dirty ? '保存' : '已保存'}</button>
        </div>
      </header>

      <main className="composer-main">
        <aside className="composer-scenes">
          <div className="composer-section-title">Scenes</div>
          <div className="composer-scene-list">
            {localProject.scenes.map((scene, index) => (
              <button key={scene.id} className={scene.id === selectedScene.id ? 'active' : ''} onClick={() => selectScene(scene.id)}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <b>{scene.title ?? scene.text.slice(0, 22)}</b>
                <small>{scene.id}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="composer-preview">
          <div className="composer-preview-toolbar">
            <span>{selectedScene.id}</span>
            <span>{formatFrameTime(currentLocalFrame, fps)} / {formatFrameTime(sceneDurationFrames, fps)}</span>
            <span>全片 {formatFrameTime(currentFrame, fps)}</span>
          </div>
          <div className="composer-player-stage">
            <div ref={playerWrapRef} className="composer-player-wrap" style={{aspectRatio: `${localProject.video.width} / ${localProject.video.height}`}}>
              <Player
                ref={playerRef}
                component={MedAvatarVideo}
                inputProps={{project: localProject, assets: payload.assets, captions: payload.captions}}
                durationInFrames={projectDurationInFrames}
                fps={fps}
                compositionWidth={localProject.video.width}
                compositionHeight={localProject.video.height}
                style={{width:'100%', aspectRatio:`${localProject.video.width} / ${localProject.video.height}`}}
              />
              <div
                className="composer-subtitle-safe-zone"
                style={{
                  left: `${subtitleSafeRect.x / localProject.video.width * 100}%`,
                  top: `${subtitleSafeRect.y / localProject.video.height * 100}%`,
                  width: `${subtitleSafeRect.width / localProject.video.width * 100}%`,
                  height: `${subtitleSafeRect.height / localProject.video.height * 100}%`,
                }}
              ><span>字幕安全区</span></div>
              {selectedVisible ? (
                <div
                  className="composer-selection-box"
                  style={{
                    left: `${selectedItem.rect.x / localProject.video.width * 100}%`,
                    top: `${selectedItem.rect.y / localProject.video.height * 100}%`,
                    width: `${selectedItem.rect.width / localProject.video.width * 100}%`,
                    height: `${selectedItem.rect.height / localProject.video.height * 100}%`,
                  }}
                  onPointerDown={(event: React.PointerEvent<HTMLDivElement>) => beginCanvasGesture(event, 'move')}
                  onPointerMove={moveCanvasGesture}
                  onPointerUp={endCanvasGesture}
                >
                  <span className="composer-selection-label">{selectedItem.id}</span>
                  <button
                    type="button"
                    className="composer-resize-handle"
                    aria-label="Resize selected element"
                    onPointerDown={(event: React.PointerEvent<HTMLButtonElement>) => beginCanvasGesture(event, 'resize')}
                    onPointerMove={moveCanvasGesture}
                    onPointerUp={endCanvasGesture}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <aside className="composer-inspector">
          <div className="composer-section-title">Inspector</div>
          <div className="composer-inspector-scroll">
            <div className="composer-tool-row">
              <button className="primary" onClick={addText} disabled={calibrationStatus.state !== 'current'}>+ 文字</button>
              <button className="primary" onClick={addAnimation} disabled={calibrationStatus.state !== 'current'}>+ 动画</button>
            </div>
            <div className="composer-tool-row">
              <button onClick={splitSelected} disabled={!selectedItem || currentLocalFrame <= (selectedItem?.startFrame ?? 0) || currentLocalFrame >= (selectedItem?.endFrame ?? 0)}>分割</button>
              <button onClick={deleteSelected} disabled={!selectedItem}>删除</button>
            </div>

            {calibrationStatus.state !== 'current' ? (
              <div className="composer-calibration-warning">
                <b>Composition 需要校准</b>
                <span>{calibrationStatus.reasons.join(' · ')}</span>
                <button onClick={calibrateCurrentScene}>按当前时间/画布校准</button>
              </div>
            ) : null}

            {selectedOverlapsSubtitle ? (
              <div className="composer-safe-warning">当前元素覆盖字幕安全区；最终字幕仍保持锁定。</div>
            ) : null}

            {!selectedItem ? (
              <div className="composer-empty-inspector">
                <b>选择时间轴片段或画布元素</b>
                <p>拖动画布可改变位置，右下角可缩放。内部全部使用整数帧。</p>
              </div>
            ) : (
              <div className="composer-fields">
                <label>ID<input value={selectedItem.id} disabled /></label>
                <div className="composer-field-grid">
                  <label>Start<input type="number" value={selectedItem.startFrame} min={0} max={selectedItem.endFrame - 1} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSelected({startFrame: Number(e.currentTarget.value)})} /></label>
                  <label>End<input type="number" value={selectedItem.endFrame} min={selectedItem.startFrame + 1} max={sceneDurationFrames} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSelected({endFrame: Number(e.currentTarget.value)})} /></label>
                </div>
                <div className="composer-field-grid">
                  {(['x','y','width','height'] as const).map((key) => (
                    <label key={key}>{key.toUpperCase()}<input type="number" value={Math.round(selectedItem.rect[key])} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSelected({rect: {...selectedItem.rect, [key]: Number(e.currentTarget.value)}})} /></label>
                  ))}
                </div>
                <label>层级 Z<input type="number" min={0} max={999} value={selectedItem.zIndex ?? (selectedTrack === 'presenter' ? 20 : selectedTrack === 'animation' ? 32 : selectedTrack === 'visual' ? 34 : 38)} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSelected({zIndex: Number(e.currentTarget.value)})} /></label>
                {'type' in selectedItem && selectedItem.type === 'text' ? (
                  <>
                    <label>文字<textarea value={selectedItem.text} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => updateSelected({text: e.currentTarget.value})} /></label>
                    <div className="composer-field-grid">
                      <label>字号<input type="number" min={12} max={240} value={selectedItem.style?.fontSize ?? Math.max(24, Math.round(selectedItem.rect.height * 0.28))} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSelected({style: {...selectedItem.style, fontSize: Number(e.currentTarget.value)}})} /></label>
                      <label>颜色<input type="color" value={selectedItem.style?.color ?? '#ffffff'} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSelected({style: {...selectedItem.style, color: e.currentTarget.value}})} /></label>
                    </div>
                    <label>对齐<select value={selectedItem.style?.align ?? 'center'} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateSelected({style: {...selectedItem.style, align: e.currentTarget.value as 'left' | 'center' | 'right'}})}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
                  </>
                ) : null}
                {'type' in selectedItem && selectedItem.type === 'animation' ? (
                  <label>动画<select value={selectedItem.name} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateSelected({name: e.currentTarget.value})}>{ANIMATION_PRESETS.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
                ) : null}
                {!('type' in selectedItem) && 'mask' in selectedItem ? (
                  <label>Mask<select value={selectedItem.mask ?? 'none'} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateSelected({mask: e.currentTarget.value as 'none' | 'circle'})}><option value="none">Rect</option><option value="circle">Circle</option></select></label>
                ) : null}
              </div>
            )}

            <div className="composer-track-state">
              <h3>轨道继承</h3>
              <div><span>数字人</span><b>{explicit?.presenter === undefined ? '继承' : explicit.presenter.length ? '自定义' : '隐藏'}</b><button onClick={() => applyDirect((current) => resetTrack(current, selectedScene.id, 'presenter'))} disabled={draftOverrides.scenes[selectedScene.id]?.composition?.presenter === undefined}>重置</button></div>
              <div><span>主视觉</span><b>{explicit?.visual === undefined ? '继承' : explicit.visual.length ? '自定义' : '隐藏'}</b><button onClick={() => applyDirect((current) => resetTrack(current, selectedScene.id, 'visual'))} disabled={draftOverrides.scenes[selectedScene.id]?.composition?.visual === undefined}>重置</button></div>
              <div><span>Overlay</span><b>{explicit?.overlays === undefined ? '继承' : explicit.overlays.length ? '自定义' : '空'}</b><button onClick={() => applyDirect((current) => resetTrack(current, selectedScene.id, 'text'))} disabled={draftOverrides.scenes[selectedScene.id]?.composition?.overlays === undefined}>重置</button></div>
            </div>
            {composition.presenter.length === 0 ? <button className="wide" onClick={restorePresenter}>恢复数字人片段</button> : null}
            {composition.visual.length === 0 && selectedScene.visual && selectedScene.visual.type !== 'none' ? <button className="wide" onClick={restoreVisual}>恢复主视觉片段</button> : null}
          </div>
        </aside>
      </main>

      <section className="composer-timeline-shell">
        <div className="composer-timeline-toolbar">
          <div>
            <button onClick={() => playerRef.current?.play()}>▶</button>
            <button onClick={() => playerRef.current?.pause()}>Ⅱ</button>
          </div>
          <strong>{formatFrameTime(currentLocalFrame, fps)}</strong>
          <span>Scene 起点 {formatFrameTime(sceneStartFrame, fps)} · {fps}fps · [start,end)</span>
          <div className="composer-timeline-zoom"><button onClick={() => setTimelineScaleWidth((value) => Math.max(60, value - 30))}>−</button><span>{Math.round(timelineScaleWidth / 120 * 100)}%</span><button onClick={() => setTimelineScaleWidth((value) => Math.min(360, value + 30))}>+</button></div>
        </div>
        <div className="composer-timeline-body">
          <div className="composer-track-labels">{TRACKS.map(([id,label]) => <div key={id}>{label}</div>)}</div>
          <div className="composer-timeline-widget">
            <Timeline
              ref={timelineRef}
              editorData={rows.map((row) => ({...row, actions: row.actions.map((action) => ({...action}))}))}
              effects={effects}
              scale={1}
              scaleSplitCount={fps}
              scaleWidth={timelineScaleWidth}
              minScaleCount={Math.max(1, Math.ceil(framesToSeconds(sceneDurationFrames, fps)))}
              maxScaleCount={Math.max(1, Math.ceil(framesToSeconds(sceneDurationFrames, fps)))}
              startLeft={10}
              rowHeight={42}
              gridSnap
              dragLine
              autoScroll
              disableDrag={calibrationStatus.state !== 'current'}
              onActionMoveStart={({action, row}) => {
                if (row.id === 'subtitle' || row.id === 'audio') return;
                timelineStartDraftRef.current = structuredClone(draftOverrides);
                timelineEditKindRef.current = 'move';
                timelineEditTrackRef.current = row.id as EditableTrackId;
                setSelectedItemId(action.id);
              }}
              onActionMoving={({action, row, start, end}) => constraintAllows(row.id as TrackId, action.id, start, end)}
              onActionResizeStart={({action, row, dir}) => {
                if (row.id === 'subtitle' || row.id === 'audio') return;
                timelineStartDraftRef.current = structuredClone(draftOverrides);
                timelineEditKindRef.current = dir === 'left' ? 'resize-left' : 'resize-right';
                timelineEditTrackRef.current = row.id as EditableTrackId;
                setSelectedItemId(action.id);
              }}
              onActionResizing={({action, row, start, end}) => constraintAllows(row.id as TrackId, action.id, start, end)}
              onChange={(nextRows) => { onTimelineChange(nextRows); }}
              onClickActionOnly={(_event, {action, row, time}) => {
                if (row.id === 'subtitle' || row.id === 'audio') return;
                setSelectedItemId(action.id);
                seekLocal(time);
              }}
              onCursorDrag={seekLocal}
              onClickTimeArea={(time) => { seekLocal(time); return true; }}
              getActionRender={(action, row) => {
                const meta = action as TimelineActionMeta;
                return <div className={`composer-timeline-clip clip-${row.id} ${selectedItemId === action.id ? 'selected' : ''}`}>{meta.label ?? action.id}</div>;
              }}
            />
          </div>
        </div>
      </section>
    </div>
  );
};
