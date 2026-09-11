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

const statistic = (
  value: string,
  label?: string,
  context?: string,
  presentation?: 'number' | 'percent' | 'range' | 'trend',
): SceneVisual => ({
  type: 'statistic',
  value,
  ...(label ? {label} : {}),
  ...(context ? {context} : {}),
  ...(presentation ? {presentation} : {}),
});

const comparison = (
  left: Extract<SceneVisual, {type: 'comparison'}>['left'],
  right: Extract<SceneVisual, {type: 'comparison'}>['right'],
  relation?: 'vs' | 'before-after' | 'normal-abnormal' | 'low-high',
): SceneVisual => ({
  type: 'comparison',
  left,
  right,
  ...(relation ? {relation} : {}),
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

const statisticVisual = statistic('30%', '风险下降', '规律控制血压后', 'percent');
const statisticDraft = setSceneVisual(overriddenDraft, 's1', statisticVisual);
const statisticOverride = applyStoryboardOverrides(base, statisticDraft).project;
assert.deepEqual(statisticOverride.scenes[0]?.visual, statisticVisual);
assert.equal(statisticOverride.scenes[0]?.avatar?.layout, 'hero');

for (const presentation of ['number', 'percent', 'range', 'trend'] as const) {
  const parsed = projectSchema.parse({
    ...base,
    scenes: [{...base.scenes[0], visual: statistic('2–3倍', '脑卒中风险', undefined, presentation)}],
  });
  assert.equal(parsed.scenes[0]?.visual?.type, 'statistic');
  if (parsed.scenes[0]?.visual?.type === 'statistic') {
    assert.equal(parsed.scenes[0].visual.presentation, presentation);
  }
}

const statisticWithoutPresentation = projectSchema.parse({
  ...base,
  scenes: [{...base.scenes[0], visual: statistic('120/80', '血压示例')}],
});
assert.equal(statisticWithoutPresentation.scenes[0]?.visual?.type, 'statistic');
if (statisticWithoutPresentation.scenes[0]?.visual?.type === 'statistic') {
  assert.equal(statisticWithoutPresentation.scenes[0].visual.presentation, undefined);
}

const comparisonDensities: SceneVisual[] = [
  comparison({label: '正常血压'}, {label: '高血压'}),
  comparison(
    {label: '治疗前', value: '数值 A'},
    {label: '治疗后', value: '数值 B'},
    'before-after',
  ),
  comparison(
    {label: '低风险', value: '较低', context: '示例说明 A'},
    {label: '高风险', value: '较高', context: '示例说明 B'},
    'low-high',
  ),
];
for (const visual of comparisonDensities) {
  const parsed = projectSchema.parse({...base, scenes: [{...base.scenes[0], visual}]});
  assert.equal(parsed.scenes[0]?.visual?.type, 'comparison');
}
if (comparisonDensities[0]?.type === 'comparison') {
  assert.equal(comparisonDensities[0].left.value, undefined);
  assert.equal(comparisonDensities[0].left.context, undefined);
  assert.equal(comparisonDensities[0].right.value, undefined);
  assert.equal(comparisonDensities[0].right.context, undefined);
  assert.equal(comparisonDensities[0].relation, undefined);
}

for (const relation of ['vs', 'before-after', 'normal-abnormal', 'low-high'] as const) {
  const parsed = projectSchema.parse({
    ...base,
    scenes: [{...base.scenes[0], visual: comparison({label: 'A'}, {label: 'B'}, relation)}],
  });
  assert.equal(parsed.scenes[0]?.visual?.type, 'comparison');
  if (parsed.scenes[0]?.visual?.type === 'comparison') {
    assert.equal(parsed.scenes[0].visual.relation, relation);
  }
}

const comparisonVisual = comparison(
  {label: '没有明显感觉'},
  {label: '血管仍在承受压力'},
  'vs',
);
const comparisonDraft = setSceneVisual(statisticDraft, 's1', comparisonVisual);
const comparisonApplied = applyStoryboardOverrides(base, comparisonDraft).project;
assert.deepEqual(comparisonApplied.scenes[0]?.visual, comparisonVisual);
assert.equal(comparisonApplied.scenes[0]?.avatar?.layout, 'hero');

const noneDraft = setSceneVisual(comparisonDraft, 's1', {type: 'none'});
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
const intro = prepared.state.effective.scenes.find((scene) => scene.id === 'intro');
const silentRisk = prepared.state.effective.scenes.find((scene) => scene.id === 'silent-risk');
const cumulativeDamage = prepared.state.effective.scenes.find((scene) => scene.id === 'cumulative-damage');
assert.deepEqual(intro?.visual, comparison({label: '没有明显感觉'}, {label: '血管仍在承受压力'}, 'vs'));
assert.deepEqual(silentRisk?.visual, emphasis('没有症状', '≠', '没有风险'));
assert.deepEqual(
  cumulativeDamage?.visual,
  statistic('1次', '单次血压数字', '更应关注长期累积损伤', 'number'),
);
assert.equal('prototypeVisuals' in prepared.renderProps, false);

const props = JSON.parse(await readFile(prepared.paths.props, 'utf8')) as Record<string, unknown>;
assert.equal('prototypeVisuals' in props, false);
const project = props.project as {scenes?: Array<{id?: string; visual?: SceneVisual}>};
assert.equal(project.scenes?.find((scene) => scene.id === 'intro')?.visual?.type, 'comparison');
assert.equal(project.scenes?.find((scene) => scene.id === 'silent-risk')?.visual?.type, 'emphasis');
assert.equal(project.scenes?.find((scene) => scene.id === 'cumulative-damage')?.visual?.type, 'statistic');


for (const file of [
  'src/core/overrides.ts',
  'src/editor/overrideDraft.ts',
  'src/production/effectiveProject.ts',
  'src/production/renderProps.ts',
]) {
  const source = await readFile(file, 'utf8');
  assert.equal(/comparison/i.test(source), false, `${file} must remain comparison-unaware`);
}

console.log('✓ visual model contract');
