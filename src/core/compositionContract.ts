import assert from 'node:assert/strict';
import {
  assertCompositionReady,
  calibrateSceneComposition,
  getCompositionCalibrationStatus,
  makeCompositionBasis,
  splitCompositionItem,
} from './composition.js';
import {projectSchema, type SceneComposition} from './schema.js';

const basis = makeCompositionBasis({text: '测试旁白'}, 300, {fps: 25, width: 1080, height: 1920});
const composition: SceneComposition = {
  basis,
  presenter: [
    {id: 'presenter-01', startFrame: 0, endFrame: 100, rect: {x: 700, y: 1200, width: 300, height: 300}, mask: 'circle'},
  ],
  visual: [
    {id: 'visual-01', startFrame: 25, endFrame: 150, rect: {x: 60, y: 120, width: 960, height: 520}, playbackOffsetFrame: 0},
  ],
  overlays: [
    {id: 'text-01', type: 'text', startFrame: 50, endFrame: 120, rect: {x: 120, y: 820, width: 840, height: 180}, text: '没有症状 ≠ 没有风险'},
    {id: 'animation-01', type: 'animation', startFrame: 100, endFrame: 200, rect: {x: 80, y: 420, width: 920, height: 720}, name: 'artery-pressure', playbackOffsetFrame: 0},
  ],
};

const parsed = projectSchema.parse({
  version: '1.0',
  title: 'composition-contract',
  video: {width: 1080, height: 1920, fps: 25},
  scenes: [{
    id: 's1',
    type: 'doctor_full',
    text: '测试旁白',
    durationInSeconds: 12,
    composition,
  }],
});
assert.deepEqual(parsed.scenes[0]?.composition, composition);
assert.deepEqual(getCompositionCalibrationStatus(parsed.scenes[0]!, parsed.video), {state: 'current', reasons: []});
assert.doesNotThrow(() => assertCompositionReady(parsed));

const animation = composition.overlays?.find((item) => item.type === 'animation');
assert(animation && animation.type === 'animation');
const [, animationRight] = splitCompositionItem(animation, 150, 'animation-02');
assert.equal(animationRight.startFrame, 150);
assert.equal(animationRight.playbackOffsetFrame, 50);

const visual = composition.visual?.[0];
assert(visual);
const [, visualRight] = splitCompositionItem(visual, 75, 'visual-02');
assert.equal(visualRight.playbackOffsetFrame, 50);

assert.throws(() => projectSchema.parse({
  ...parsed,
  scenes: [{...parsed.scenes[0], composition: {
    basis,
    presenter: [
      {id: 'p1', startFrame: 0, endFrame: 80, rect: {x: 0, y: 0, width: 200, height: 200}},
      {id: 'p2', startFrame: 70, endFrame: 100, rect: {x: 0, y: 0, width: 200, height: 200}},
    ],
  }}],
}));

assert.throws(() => projectSchema.parse({
  ...parsed,
  scenes: [{...parsed.scenes[0], composition: {
    basis,
    overlays: [{id: 'bad', type: 'text', startFrame: 0, endFrame: 400, rect: {x: 0, y: 0, width: 200, height: 200}, text: 'bad'}],
  }}],
}));

const hiddenPresenter = projectSchema.parse({
  ...parsed,
  scenes: [{...parsed.scenes[0], composition: {basis, presenter: []}}],
});
assert.deepEqual(hiddenPresenter.scenes[0]?.composition?.presenter, []);

assert.throws(() => projectSchema.parse({
  ...parsed,
  scenes: [{...parsed.scenes[0], composition: {
    basis,
    presenter: [{id: 'duplicate', startFrame: 0, endFrame: 20, rect: {x: 0, y: 0, width: 100, height: 100}}],
    overlays: [{id: 'duplicate', type: 'text', startFrame: 20, endFrame: 40, rect: {x: 0, y: 0, width: 100, height: 100}, text: 'duplicate'}],
  }}],
}));

const changedNarrationProject = projectSchema.parse({
  ...parsed,
  scenes: [{...parsed.scenes[0], text: '新的测试旁白'}],
});
assert.equal(getCompositionCalibrationStatus(changedNarrationProject.scenes[0]!, changedNarrationProject.video).state, 'stale');
assert.throws(() => assertCompositionReady(changedNarrationProject));

const staleProject = projectSchema.parse({
  ...parsed,
  video: {...parsed.video, fps: 30},
});
assert.equal(getCompositionCalibrationStatus(staleProject.scenes[0]!, staleProject.video).state, 'stale');
assert.throws(() => assertCompositionReady(staleProject));
const newBasis = makeCompositionBasis(staleProject.scenes[0]!, 360, {fps: 30, width: 1080, height: 1920});
const calibrated = calibrateSceneComposition(staleProject.scenes[0]!.composition!, newBasis);
assert.equal(calibrated.visual?.[0]?.startFrame, 30);
assert.equal(calibrated.visual?.[0]?.endFrame, 180);
const repaired = projectSchema.parse({...staleProject, scenes: [{...staleProject.scenes[0], composition: calibrated}]});
assert.equal(getCompositionCalibrationStatus(repaired.scenes[0]!, repaired.video).state, 'current');
assert.doesNotThrow(() => assertCompositionReady(repaired));

console.log('✓ composition contract');
