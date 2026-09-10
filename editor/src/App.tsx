import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Player, type PlayerRef} from '@remotion/player';
import {MedAvatarVideo} from '../../remotion/Video';
import type {StoryboardOverrides} from '../../src/core/overrides';
import type {Scene, SubtitleStyle} from '../../src/core/schema';
import {setSceneSubtitleStyle} from '../../src/editor/overrideDraft';
import type {EditorProjectPayload} from '../../src/production/renderProps';

const SUBTITLE_STYLES: SubtitleStyle[] = ['medical', 'minimal', 'social'];

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
};

const sceneSummary = (scene: Scene) => scene.title ?? scene.text.slice(0, 26);

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

  const selectScene = (scene: Scene) => {
    setSelectedSceneId(scene.id);
    playerRef.current?.seekTo(Math.round((sceneStarts.get(scene.id) ?? 0) * fps));
  };

  const changeSubtitleStyle = (style: SubtitleStyle) => {
    if (!selected) return;
    void resolveDraft(setSceneSubtitleStyle(draftOverrides, selected.id, style));
  };

  const resetSubtitleStyle = () => {
    if (!selected) return;
    void resolveDraft(setSceneSubtitleStyle(draftOverrides, selected.id, undefined));
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
          <button
            type="button"
            className="save-button"
            disabled={!dirty || resolving || saving}
            onClick={() => void saveOverrides()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      <main>
        <aside className="scene-panel panel">
          <div className="panel-title">Scenes</div>
          <div className="scene-list">
            {payload.effective.scenes.map((scene, index) => (
              <button
                type="button"
                key={scene.id}
                className={scene.id === selected?.id ? 'scene-card selected' : 'scene-card'}
                onClick={() => selectScene(scene)}
              >
                <span className="scene-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="scene-card-body">
                  <strong>{sceneSummary(scene)}</strong>
                  <span>{scene.type} · {scene.durationInSeconds.toFixed(1)}s</span>
                  <span>{scene.id}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="preview-panel panel">
          <div className="panel-title preview-title">
            <span>Preview</span>
            {resolving ? <span className="resolving">Resolving…</span> : null}
          </div>
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
              <Field label="Type" value={selected.type} />
              <Field label="Title" value={selected.title ?? '—'} />
              <Field label="Slide" value={selected.slide ?? '—'} />
              <Field label="Avatar" value={`${selected.avatar?.layout ?? '—'} · ${selected.avatar?.scale ?? '—'}`} />

              <section className="edit-section">
                <div className="edit-section-heading">
                  <div>
                    <div className="edit-title">Subtitle Style</div>
                    <div className="edit-hint">Visual-only override · narration timing is unchanged</div>
                  </div>
                  <button
                    type="button"
                    className="reset-button"
                    disabled={override?.subtitle?.style === undefined || resolving}
                    onClick={resetSubtitleStyle}
                  >
                    Reset
                  </button>
                </div>
                <div className="segmented-control">
                  {SUBTITLE_STYLES.map((style) => (
                    <button
                      type="button"
                      key={style}
                      disabled={resolving}
                      className={selected.subtitle?.style === style ? 'active' : ''}
                      onClick={() => changeSubtitleStyle(style)}
                    >
                      {style[0].toUpperCase()}{style.slice(1)}
                    </button>
                  ))}
                </div>
                <div className="value-provenance">
                  <span><b>Base</b>{base?.subtitle?.style ?? '—'}</span>
                  <span><b>Override</b>{override?.subtitle?.style ?? '—'}</span>
                  <span><b>Effective</b>{selected.subtitle?.style ?? '—'}</span>
                </div>
              </section>

              <Field label="Subtitle" value={`${selected.subtitle?.mode ?? '—'} · ${selected.subtitle?.style ?? '—'}`} />
              <Field label="Animation" value={selected.animation?.name ?? '—'} />

              <div className="source-grid">
                <div>
                  <div className="source-title">Base</div>
                  <pre>{JSON.stringify(base ?? null, null, 2)}</pre>
                </div>
                <div>
                  <div className="source-title">Override draft</div>
                  <pre>{JSON.stringify(override ?? {}, null, 2)}</pre>
                </div>
                <div>
                  <div className="source-title">Effective</div>
                  <pre>{JSON.stringify(selected, null, 2)}</pre>
                </div>
              </div>
            </div>
          ) : null}
        </aside>
      </main>

      <footer className="timeline-panel panel">
        <div className="timeline-meta">00:00.0 / {formatTime(durationSeconds)}</div>
        <div className="timeline-track">
          {payload.effective.scenes.map((scene) => (
            <button
              type="button"
              key={scene.id}
              title={`${scene.id} · ${scene.durationInSeconds.toFixed(1)}s`}
              className={scene.id === selected?.id ? 'timeline-scene selected' : 'timeline-scene'}
              style={{flexGrow: Math.max(0.1, scene.durationInSeconds)}}
              onClick={() => selectScene(scene)}
            >
              {scene.id}
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
};
