import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Player, type PlayerRef} from '@remotion/player';
import {MedAvatarVideo} from '../../remotion/Video';
import type {StoryboardOverrides} from '../../src/core/overrides';
import type {Scene, SceneType, SubtitleStyle} from '../../src/core/schema';
import {
  setSceneAnimationName,
  setSceneAvatarLayout,
  setSceneAvatarScale,
  setSceneSlide,
  setSceneSubtitleStyle,
  setSceneType,
} from '../../src/editor/overrideDraft';
import type {EditorProjectPayload} from '../../src/production/renderProps';

const SUBTITLE_STYLES: SubtitleStyle[] = ['medical', 'minimal', 'social'];
type AvatarLayout = NonNullable<Scene['avatar']>['layout'];
const AVATAR_LAYOUTS: Array<{value: AvatarLayout; label: string}> = [
  {value: 'hero', label: 'Hero'},
  {value: 'bottom-left', label: 'Bottom Left'},
  {value: 'bottom-right', label: 'Bottom Right'},
  {value: 'hidden', label: 'Hidden'},
];
const visualAvatarLayout = (layout: AvatarLayout | undefined) =>
  layout === 'fullscreen' ? 'hero' : layout;
const SCENE_TYPES: Array<{value: SceneType; label: string; short: string}> = [
  {value: 'doctor_full', label: 'Doctor', short: 'Doctor'},
  {value: 'doctor_ppt', label: 'Doctor + PPT', short: 'Dr + PPT'},
  {value: 'medical_animation', label: 'Medical Animation', short: 'Animation'},
  {value: 'visual_full', label: 'Visual Only', short: 'Visual'},
];
const ANIMATION_PRESETS = [
  {value: 'artery-pressure', label: 'Artery Pressure', description: 'Sustained pressure on vessel walls'},
  {value: 'plaque-growth', label: 'Plaque Growth', description: 'Endothelial injury to narrowing'},
  {value: 'heart-beat', label: 'Heart Beat', description: 'Cardiac workload and heartbeat'},
  {value: 'risk-pathway', label: 'Risk Pathway', description: 'Hypertension to target-organ risk'},
] as const;

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
};

const sceneSummary = (scene: Scene) => scene.title ?? scene.text.slice(0, 26);
const slideAssetUrl = (src: string) => src.startsWith('/') ? src : `/${src}`;

const requestJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const body = await response.json() as T & {error?: string};
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
};

const Field: React.FC<{label: string; value: React.ReactNode; muted?: boolean}> = ({label, value, muted}) => (
  <div className="field">
    <div className="field-label">{label}</div>
    <div className={muted ? 'field-value muted' : 'field-value'}>{value}</div>
  </div>
);

const Provenance: React.FC<{
  base: React.ReactNode;
  override: React.ReactNode;
  effective: React.ReactNode;
}> = ({base, override, effective}) => (
  <div className="value-provenance">
    <span><b>Base</b>{base ?? '—'}</span>
    <span><b>Override</b>{override ?? '—'}</span>
    <span><b>Effective</b>{effective ?? '—'}</span>
  </div>
);

export const App: React.FC = () => {
  const projectName = new URLSearchParams(window.location.search).get('project') ?? 'demo';
  const projectApi = `/api/projects/${encodeURIComponent(projectName)}`;
  const [payload, setPayload] = useState<EditorProjectPayload | null>(null);
  const [savedOverrides, setSavedOverrides] = useState<StoryboardOverrides | null>(null);
  const [draftOverrides, setDraftOverrides] = useState<StoryboardOverrides | null>(null);
  const [error, setError] = useState<string>();
  const [editError, setEditError] = useState<string>();
  const [selectedSceneId, setSelectedSceneId] = useState<string>();
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const playerRef = useRef<PlayerRef>(null);
  const resolveVersionRef = useRef(0);

  useEffect(() => {
    requestJson<EditorProjectPayload>(projectApi)
      .then((next) => {
        setPayload(next);
        setSavedOverrides(next.overrides);
        setDraftOverrides(next.overrides);
        setSelectedSceneId(next.effective.scenes[0]?.id);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [projectApi]);

  const dirty = Boolean(
    savedOverrides
    && draftOverrides
    && JSON.stringify(savedOverrides) !== JSON.stringify(draftOverrides),
  );

  useEffect(() => {
    if (!dirty) return undefined;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [dirty]);

  const sceneStarts = useMemo(() => {
    if (!payload) return new Map<string, number>();
    const starts = new Map<string, number>();
    let cursor = 0;
    for (const scene of payload.effective.scenes) {
      starts.set(scene.id, cursor);
      cursor += scene.durationInSeconds;
    }
    return starts;
  }, [payload]);

  const resolveDraft = async (nextOverrides: StoryboardOverrides) => {
    const version = resolveVersionRef.current + 1;
    resolveVersionRef.current = version;
    setDraftOverrides(nextOverrides);
    setResolving(true);
    setEditError(undefined);
    try {
      const next = await requestJson<EditorProjectPayload>(`${projectApi}/resolve`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(nextOverrides),
      });
      if (version !== resolveVersionRef.current) return;
      setPayload(next);
    } catch (reason) {
      if (version !== resolveVersionRef.current) return;
      setEditError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (version === resolveVersionRef.current) setResolving(false);
    }
  };

  const saveOverrides = async () => {
    if (!draftOverrides || !dirty || resolving) return;
    setSaving(true);
    setEditError(undefined);
    try {
      const next = await requestJson<EditorProjectPayload>(`${projectApi}/overrides`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(draftOverrides),
      });
      setPayload(next);
      setSavedOverrides(next.overrides);
      setDraftOverrides(next.overrides);
    } catch (reason) {
      setEditError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  if (error) return <div className="center-message error">{error}</div>;
  if (!payload || !draftOverrides) return <div className="center-message">Loading {projectName}…</div>;

  const selected = payload.effective.scenes.find((scene) => scene.id === selectedSceneId) ?? payload.effective.scenes[0];
  const base = payload.base.scenes.find((scene) => scene.id === selected?.id);
  const override = selected ? draftOverrides.scenes[selected.id] : undefined;
  const fps = payload.effective.video.fps;
  const durationSeconds = payload.effective.scenes.reduce((sum, scene) => sum + scene.durationInSeconds, 0);
  const durationInFrames = Math.max(fps, payload.effective.scenes.reduce(
    (sum, scene) => sum + Math.max(1, Math.round(scene.durationInSeconds * fps)),
    0,
  ));
  const portrait = payload.effective.video.height > payload.effective.video.width;
  const avatarLayout = visualAvatarLayout(override?.avatar?.layout ?? selected?.avatar?.layout);
  const effectiveAvatarScale = selected?.avatar?.scale ?? 0.28;
  const avatarScale = override?.avatar?.scale ?? effectiveAvatarScale;
  const pipScaleEditable = avatarLayout === 'bottom-left' || avatarLayout === 'bottom-right';
  const slideBacked = selected?.type === 'doctor_ppt' || selected?.type === 'visual_full';
  const animationBacked = selected?.type === 'medical_animation';

  const selectScene = (scene: Scene) => {
    setSelectedSceneId(scene.id);
    playerRef.current?.seekTo(Math.round((sceneStarts.get(scene.id) ?? 0) * fps));
  };

  const changeSceneType = (type: SceneType) => {
    if (!selected) return;
    void resolveDraft(setSceneType(draftOverrides, selected.id, type));
  };
  const resetSceneType = () => {
    if (!selected) return;
    void resolveDraft(setSceneType(draftOverrides, selected.id, undefined));
  };
  const changeSlide = (slide: number) => {
    if (!selected) return;
    void resolveDraft(setSceneSlide(draftOverrides, selected.id, slide));
  };
  const resetSlide = () => {
    if (!selected) return;
    void resolveDraft(setSceneSlide(draftOverrides, selected.id, undefined));
  };
  const changeAnimation = (name: string) => {
    if (!selected) return;
    void resolveDraft(setSceneAnimationName(draftOverrides, selected.id, name));
  };
  const resetAnimation = () => {
    if (!selected) return;
    void resolveDraft(setSceneAnimationName(draftOverrides, selected.id, undefined));
  };
  const changeSubtitleStyle = (style: SubtitleStyle) => {
    if (!selected) return;
    void resolveDraft(setSceneSubtitleStyle(draftOverrides, selected.id, style));
  };
  const resetSubtitleStyle = () => {
    if (!selected) return;
    void resolveDraft(setSceneSubtitleStyle(draftOverrides, selected.id, undefined));
  };
  const changeAvatarLayout = (layout: AvatarLayout) => {
    if (!selected) return;
    void resolveDraft(setSceneAvatarLayout(draftOverrides, selected.id, layout));
  };
  const resetAvatarLayout = () => {
    if (!selected) return;
    void resolveDraft(setSceneAvatarLayout(draftOverrides, selected.id, undefined));
  };
  const changeAvatarScale = (scale: number) => {
    if (!selected) return;
    void resolveDraft(setSceneAvatarScale(draftOverrides, selected.id, scale));
  };
  const resetAvatarScale = () => {
    if (!selected) return;
    void resolveDraft(setSceneAvatarScale(draftOverrides, selected.id, undefined));
  };

  return (
    <div className="app-shell">
      <header>
        <div>
          <div className="brand">MedAvatar Studio</div>
          <div className="project-name">{projectName}</div>
        </div>
        <div className="header-actions">
          <div className="header-status">
            <span className={payload.timeline.stale ? 'badge warning' : 'badge'}>
              {payload.timeline.source === 'actual' ? 'Actual timing' : payload.timeline.stale ? 'Stale timing · estimated preview' : 'Estimated timing'}
            </span>
            {dirty ? <span className="badge unsaved">● Unsaved</span> : <span className="badge saved">Saved</span>}
            <span>{payload.effective.video.width}×{payload.effective.video.height} · {fps}fps</span>
          </div>
          <button type="button" className="save-button" disabled={!dirty || resolving || saving} onClick={() => void saveOverrides()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      <main>
        <aside className="scene-panel panel">
          <div className="panel-title">Scenes</div>
          <div className="scene-list">
            {payload.effective.scenes.map((scene, index) => (
              <button type="button" key={scene.id} className={scene.id === selected?.id ? 'scene-card selected' : 'scene-card'} onClick={() => selectScene(scene)}>
                <span className="scene-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="scene-card-body">
                  <strong>{sceneSummary(scene)}</strong>
                  <span>{SCENE_TYPES.find((item) => item.value === scene.type)?.short ?? scene.type} · {scene.durationInSeconds.toFixed(1)}s</span>
                  <span>{scene.id}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="preview-panel panel">
          <div className="panel-title preview-title"><span>Preview</span>{resolving ? <span className="resolving">Resolving…</span> : null}</div>
          <div className={portrait ? 'player-stage portrait' : 'player-stage landscape'}>
            <Player
              ref={playerRef}
              component={MedAvatarVideo}
              inputProps={{project: payload.effective, assets: payload.assets, captions: payload.captions}}
              durationInFrames={durationInFrames}
              fps={fps}
              compositionWidth={payload.effective.video.width}
              compositionHeight={payload.effective.video.height}
              controls
              style={{width: '100%', aspectRatio: `${payload.effective.video.width} / ${payload.effective.video.height}`}}
            />
          </div>
        </section>

        <aside className="inspector-panel panel">
          <div className="panel-title">Inspector</div>
          {selected ? (
            <div className="inspector-content">
              {editError ? <div className="edit-error">{editError}</div> : null}
              <Field label="Scene ID" value={selected.id} />
              <Field label="Title" value={selected.title ?? '—'} />

              <section className="edit-section">
                <div className="edit-section-heading">
                  <div>
                    <div className="edit-title">Scene Type</div>
                    <div className="edit-hint">Chooses the renderer; narration and timing stay unchanged</div>
                  </div>
                  <button type="button" className="reset-button" disabled={override?.type === undefined || resolving} onClick={resetSceneType}>Reset</button>
                </div>
                <div className="segmented-control scene-type-control">
                  {SCENE_TYPES.map(({value, label}) => (
                    <button type="button" key={value} disabled={resolving} className={selected.type === value ? 'active' : ''} onClick={() => changeSceneType(value)}>{label}</button>
                  ))}
                </div>
                <Provenance base={base?.type} override={override?.type} effective={selected.type} />
              </section>

              <section className={slideBacked ? 'edit-section' : 'edit-section inactive-section'}>
                <div className="edit-section-heading">
                  <div>
                    <div className="edit-title">Visual Source · Slide</div>
                    <div className="edit-hint">Rendered by Doctor + PPT / Visual Only; selection stays stored when dormant</div>
                  </div>
                  <button type="button" className="reset-button" disabled={override?.slide === undefined || resolving} onClick={resetSlide}>Reset</button>
                </div>
                {payload.assets.slides.length > 0 ? (
                  <div className="slide-picker">
                    {payload.assets.slides.map((src, index) => {
                      const page = index + 1;
                      return (
                        <button
                          type="button"
                          key={src}
                          className={selected.slide === page ? 'slide-option active' : 'slide-option'}
                          disabled={resolving}
                          onClick={() => changeSlide(page)}
                          title={`Slide ${page}`}
                        >
                          <img src={slideAssetUrl(src)} alt={`Slide ${page}`} />
                          <span>Page {page}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-slides">No rendered slide PNGs. Run <code>pnpm medavatar slides {projectName}</code>.</div>
                )}
                <Provenance base={base?.slide} override={override?.slide} effective={selected.slide} />
              </section>

              <section className={animationBacked ? 'edit-section' : 'edit-section inactive-section'}>
                <div className="edit-section-heading">
                  <div>
                    <div className="edit-title">Visual Source · Medical Animation</div>
                    <div className="edit-hint">Rendered by Medical Animation; selection stays stored when dormant</div>
                  </div>
                  <button type="button" className="reset-button" disabled={override?.animation === undefined || resolving} onClick={resetAnimation}>Reset</button>
                </div>
                <div className="segmented-control avatar-layout-control">
                  {ANIMATION_PRESETS.map(({value, label}) => (
                    <button
                      type="button"
                      key={value}
                      disabled={resolving}
                      className={selected.animation?.name === value ? 'active' : ''}
                      onClick={() => changeAnimation(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="edit-hint">
                  {ANIMATION_PRESETS.find((preset) => preset.value === selected.animation?.name)?.description
                    ?? (selected.animation?.name ? `Custom animation: ${selected.animation.name}` : 'No animation selected')}
                </div>
                <Provenance
                  base={base?.animation?.name}
                  override={override?.animation?.name}
                  effective={selected.animation?.name}
                />
              </section>

              <section className="edit-section">
                <div className="edit-section-heading">
                  <div>
                    <div className="edit-title">Avatar Layout</div>
                    <div className="edit-hint">Presentation-only override · source HeyGen video is unchanged</div>
                  </div>
                  <button type="button" className="reset-button" disabled={override?.avatar?.layout === undefined || resolving} onClick={resetAvatarLayout}>Reset</button>
                </div>
                <div className="segmented-control avatar-layout-control">
                  {AVATAR_LAYOUTS.map(({value, label}) => (
                    <button type="button" key={value} disabled={resolving} className={avatarLayout === value ? 'active' : ''} onClick={() => changeAvatarLayout(value)}>{label}</button>
                  ))}
                </div>
                <Provenance base={base?.avatar?.layout} override={override?.avatar?.layout} effective={selected.avatar?.layout} />

                <div className="scale-editor">
                  <div className="scale-heading">
                    <div><div className="scale-label">PiP Scale</div><div className="edit-hint">Used by bottom-left / bottom-right layouts</div></div>
                    <div className="scale-actions">
                      <span className={pipScaleEditable ? 'scale-value' : 'scale-value muted'}>{avatarScale.toFixed(2)}</span>
                      <button type="button" className="reset-button" disabled={override?.avatar?.scale === undefined || resolving} onClick={resetAvatarScale}>Reset</button>
                    </div>
                  </div>
                  <input aria-label="Avatar scale" className="scale-slider" type="range" min="0.18" max="0.50" step="0.01" value={Math.min(0.5, Math.max(0.18, avatarScale))} disabled={!pipScaleEditable || saving} onChange={(event) => changeAvatarScale(Number(event.currentTarget.value))} />
                  <Provenance base={base?.avatar?.scale?.toFixed(2)} override={override?.avatar?.scale?.toFixed(2)} effective={selected.avatar?.scale?.toFixed(2)} />
                </div>
              </section>

              <section className="edit-section">
                <div className="edit-section-heading">
                  <div><div className="edit-title">Subtitle Style</div><div className="edit-hint">Visual-only override · narration timing is unchanged</div></div>
                  <button type="button" className="reset-button" disabled={override?.subtitle?.style === undefined || resolving} onClick={resetSubtitleStyle}>Reset</button>
                </div>
                <div className="segmented-control">
                  {SUBTITLE_STYLES.map((style) => (
                    <button type="button" key={style} disabled={resolving} className={selected.subtitle?.style === style ? 'active' : ''} onClick={() => changeSubtitleStyle(style)}>{style[0].toUpperCase()}{style.slice(1)}</button>
                  ))}
                </div>
                <Provenance base={base?.subtitle?.style} override={override?.subtitle?.style} effective={selected.subtitle?.style} />
              </section>

              <Field label="Type" value={selected.type} />
              <Field label="Slide" value={selected.slide ?? '—'} />
              <Field label="Avatar" value={`${selected.avatar?.layout ?? '—'} · ${selected.avatar?.scale ?? '—'}`} />
              <Field label="Subtitle" value={`${selected.subtitle?.mode ?? '—'} · ${selected.subtitle?.style ?? '—'}`} />
              <Field label="Animation" value={selected.animation?.name ?? '—'} />

              <div className="source-grid">
                <div><div className="source-title">Base</div><pre>{JSON.stringify(base ?? null, null, 2)}</pre></div>
                <div><div className="source-title">Override draft</div><pre>{JSON.stringify(override ?? {}, null, 2)}</pre></div>
                <div><div className="source-title">Effective</div><pre>{JSON.stringify(selected, null, 2)}</pre></div>
              </div>
            </div>
          ) : null}
        </aside>
      </main>

      <footer className="timeline-panel panel">
        <div className="timeline-meta">00:00.0 / {formatTime(durationSeconds)}</div>
        <div className="timeline-track">
          {payload.effective.scenes.map((scene) => (
            <button type="button" key={scene.id} title={`${scene.id} · ${scene.durationInSeconds.toFixed(1)}s`} className={scene.id === selected?.id ? 'timeline-scene selected' : 'timeline-scene'} style={{flexGrow: Math.max(0.1, scene.durationInSeconds)}} onClick={() => selectScene(scene)}>{scene.id}</button>
          ))}
        </div>
      </footer>
    </div>
  );
};
