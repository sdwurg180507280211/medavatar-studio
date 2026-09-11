import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  buildSceneFrameTimeline,
  framesToSeconds,
  getProjectDurationInFrames,
  getTimelineDurationInFrames,
  secondsToDurationFrames,
} from './frameMath.js';

const fps = 25;
const driftingScenes = [
  {id: 'a', durationInSeconds: 0.51},
  {id: 'b', durationInSeconds: 0.51},
  {id: 'c', durationInSeconds: 0.51},
];

const timeline = buildSceneFrameTimeline(driftingScenes, fps);
assert.deepEqual(timeline, [
  {sceneId: 'a', index: 0, startFrame: 0, durationInFrames: 13, endFrame: 13},
  {sceneId: 'b', index: 1, startFrame: 13, durationInFrames: 13, endFrame: 26},
  {sceneId: 'c', index: 2, startFrame: 26, durationInFrames: 13, endFrame: 39},
]);
assert.equal(getTimelineDurationInFrames(driftingScenes, fps), 39);
assert.equal(Math.round(driftingScenes.reduce((sum, scene) => sum + scene.durationInSeconds, 0) * fps), 38);
assert.equal(framesToSeconds(39, fps), 1.56);
assert.equal(secondsToDurationFrames(0.001, fps), 1);
assert.equal(getProjectDurationInFrames({video: {fps}, scenes: driftingScenes}), 39);
assert.equal(getProjectDurationInFrames({video: {fps}, scenes: [{id: 'short', durationInSeconds: 0.01}]}), fps);

for (const span of timeline) {
  assert.equal(span.endFrame - span.startFrame, span.durationInFrames);
}
for (let index = 1; index < timeline.length; index += 1) {
  assert.equal(timeline[index]?.startFrame, timeline[index - 1]?.endFrame);
}

const canonicalConsumers = [
  'editor/src/App.tsx',
  'remotion/Video.tsx',
  'remotion/PresenterTrack.tsx',
  'remotion/Root.tsx',
  'src/production/portraitIteration.ts',
  'src/production/renderPortraitGolden.ts',
];
const forbiddenSceneBoundaryPatterns = [
  /cursor\s*\+=\s*scene\.durationInSeconds/,
  /Math\.round\(\s*scene\.durationInSeconds\s*\*/,
  /Math\.round\(\s*\(sceneStarts\.get\([^)]*\)[^)]*\*\s*fps/,
];
for (const file of canonicalConsumers) {
  const source = readFileSync(file, 'utf8');
  assert.match(source, /frameMath/, `${file} must consume canonical frame math`);
  for (const pattern of forbiddenSceneBoundaryPatterns) {
    assert.equal(pattern.test(source), false, `${file} contains duplicate scene-boundary frame math`);
  }
}
const editorSource = readFileSync('editor/src/App.tsx', 'utf8');
assert.match(editorSource, /default:\s*return assertNever\(type\)/, 'changeVisualType must remain exhaustive');

console.log('✓ canonical frame math contract');
