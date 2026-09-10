import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Player, type PlayerRef} from '@remotion/player';
import {MedAvatarVideo} from '../../remotion/Video';
import type {Scene} from '../../src/core/schema';
import type {EditorProjectPayload} from '../../src/production/renderProps';

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
};

const sceneSummary = (scene: Scene) => scene.title ?? scene.text.slice(0, 26);

const Field: React.FC<{label: string; value: React.ReactNode; muted?: boolean}> = ({label, value, muted}) => (
  <div className="field">
    <div className="field-label">{label}</div>
    <div className={muted ? 'field-value muted' : 'field-value'}>{value}</div>
  </div>
);

export const App: React.FC = () => {
  const projectName = new URLSearchParams(window.location.search).get('project') ?? 'demo';
  const [payload, setPayload] = useState<EditorProjectPayload | null>(null);
  const [error, setError] = useState<string>();
  const [selectedSceneId, setSelectedSceneId] = useState<string>();
  const playerRef = useRef<PlayerRef>(null);

  useEffect(() => {
    fetch(`/api/projects/${encodeURIComponent(projectName)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
        return body as EditorProjectPayload;
      })
      .then((next) => {
        setPayload(next);
        setSelectedSceneId(next.effective.scenes[0]?.id);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [projectName]);

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

  if (error) return <div className="center-message error">{error}</div>;
  if (!payload) return <div className="center-message">Loading {projectName}…</div>;

  const selected = payload.effective.scenes.find((scene) => scene.id === selectedSceneId) ?? payload.effective.scenes[0];
  const base = payload.base.scenes.find((scene) => scene.id === selected?.id);
  const override = selected ? payload.overrides.scenes[selected.id] : undefined;
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

  return (
    <div className="app-shell">
      <header>
        <div>
          <div className="brand">MedAvatar Studio</div>
          <div className="project-name">{projectName}</div>
        </div>
        <div className="header-status">
          <span className={payload.timeline.stale ? 'badge warning' : 'badge'}>
            {payload.timeline.source === 'actual' ? 'Actual timing' : payload.timeline.stale ? 'Stale timing · estimated preview' : 'Estimated timing'}
          </span>
          <span>{payload.effective.video.width}×{payload.effective.video.height} · {fps}fps</span>
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
          <div className="panel-title">Preview</div>
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
              <Field label="Scene ID" value={selected.id} />
              <Field label="Type" value={selected.type} />
              <Field label="Title" value={selected.title ?? '—'} />
              <Field label="Slide" value={selected.slide ?? '—'} />
              <Field label="Avatar" value={`${selected.avatar?.layout ?? '—'} · ${selected.avatar?.scale ?? '—'}`} />
              <Field label="Subtitle" value={`${selected.subtitle?.mode ?? '—'} · ${selected.subtitle?.style ?? '—'}`} />
              <Field label="Animation" value={selected.animation?.name ?? '—'} />

              <div className="source-grid">
                <div>
                  <div className="source-title">Base</div>
                  <pre>{JSON.stringify(base ?? null, null, 2)}</pre>
                </div>
                <div>
                  <div className="source-title">Override</div>
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
