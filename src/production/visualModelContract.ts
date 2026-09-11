import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {applyStoryboardOverrides, type StoryboardOverrides} from '../core/overrides.js';
import {projectSchema, type SceneVisual} from '../core/schema.js';
import {setSceneVisual} from '../editor/overrideDraft.js';
import {prepareRenderProps} from './renderProps.js';

const emphasis = (headline: string, highlight: string, support?: string): SceneVisual => ({
  type: 'emphasis',
  headline,
  highlight,
  ...(support ? {support} : {}),
});

const base = projectSchema.parse({
  version: '1.0',
  title: 'visual-contract',
  video: {width: 1080, height: 1920, fps: 25},
  scenes: [{
    id: 's1',
    type: 'doctor_full',
    text: '测试口播',
    durationInSeconds: 4,
    avatar: {layout: 'hero', scale: 1},
    visual: emphasis('基础重点', '≠', '基础说明'),
  }],
});

const empty: StoryboardOverrides = {version: '1.0', scenes: {}};
const overrideVisual = emphasis('覆盖重点', '→', '覆盖说明');
const overriddenDraft = setSceneVisual(empty, 's1', overrideVisual);
const overridden = applyStoryboardOverrides(base, overriddenDraft).project;
assert.deepEqual(overridden.scenes[0]?.visual, overrideVisual);

const noneDraft = setSceneVisual(overriddenDraft, 's1', {type: 'none'});
const none = applyStoryboardOverrides(base, noneDraft).project;
assert.deepEqual(none.scenes[0]?.visual, {type: 'none'});

const resetDraft = setSceneVisual(noneDraft, 's1', undefined);
assert.equal(resetDraft.scenes.s1, undefined);
const reset = applyStoryboardOverrides(base, resetDraft).project;
assert.deepEqual(reset.scenes[0]?.visual, base.scenes[0]?.visual);

const withoutSupport = projectSchema.parse({
  ...base,
  scenes: [{...base.scenes[0], visual: emphasis('仅两层', '重点')}],
});
assert.equal(withoutSupport.scenes[0]?.visual?.type, 'emphasis');
if (withoutSupport.scenes[0]?.visual?.type === 'emphasis') {
  assert.equal(withoutSupport.scenes[0].visual.support, undefined);
}

const prepared = await prepareRenderProps('portrait-demo');
const silentRisk = prepared.state.effective.scenes.find((scene) => scene.id === 'silent-risk');
const cumulativeDamage = prepared.state.effective.scenes.find((scene) => scene.id === 'cumulative-damage');
assert.deepEqual(silentRisk?.visual, emphasis('没有症状', '≠', '没有风险'));
assert.deepEqual(cumulativeDamage?.visual, emphasis('长期高血压', '→', '血管损伤'));
assert.equal('prototypeVisuals' in prepared.renderProps, false);

const props = JSON.parse(await readFile(prepared.paths.props, 'utf8')) as Record<string, unknown>;
assert.equal('prototypeVisuals' in props, false);
const project = props.project as {scenes?: Array<{id?: string; visual?: SceneVisual}>};
assert.equal(project.scenes?.find((scene) => scene.id === 'silent-risk')?.visual?.type, 'emphasis');

console.log('✓ visual model contract');
