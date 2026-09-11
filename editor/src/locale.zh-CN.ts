const EXACT_TEXT: Record<string, string> = {
  'MedAvatar Studio': 'MedAvatar 医学科普工作室',
  'Scenes': '场景',
  'Preview': '预览',
  'Inspector': '属性',
  'Scene ID': '场景 ID',
  'Title': '标题',
  'Scene Type': '场景类型',
  'Compatibility renderer; narration and timing stay unchanged': '兼容渲染模式；旁白与时间轴保持不变',
  'Reset': '重置',
  'Doctor': '医生',
  'Doctor + PPT': '医生 + PPT',
  'Dr + PPT': '医生 + PPT',
  'Medical Animation': '医学动画',
  'Animation': '动画',
  'Visual Only': '纯视觉',
  'Visual': '视觉',
  'Formal scene.visual · independent from presenter layout': '正式 scene.visual · 与数字人布局相互独立',
  'None': '无',
  'Emphasis': '重点强调',
  'Statistic': '数据指标',
  'No formal visual · legacy Scene Type visual remains active until migrated': '未设置正式视觉 · 迁移完成前继续使用旧场景类型视觉',
  'Base': '基础',
  'Override': '覆盖',
  'Effective': '生效',
  'Headline': '标记文案',
  'Highlight': '强调内容',
  'Support · optional': '辅助说明 · 可选',
  'Value': '数值',
  'Label · optional': '标签 · 可选',
  'Context · optional': '补充说明 · 可选',
  'Presentation': '呈现语义',
  'Number': '数字',
  'Percent': '百分比',
  'Range': '范围',
  'Trend': '趋势',
  'Visual Source · Slide': '视觉来源 · 幻灯片',
  'Legacy SceneType visual; selection stays stored when dormant': '旧场景类型视觉；停用时仍保留当前选择',
  'No rendered slide PNGs.': '暂无已渲染的幻灯片 PNG。',
  'Visual Source · Medical Animation': '视觉来源 · 医学动画',
  'No animation selected': '未选择动画',
  'Artery Pressure': '血管压力',
  'Sustained pressure on vessel walls': '持续偏高的血压对血管壁产生机械负荷',
  'Plaque Growth': '斑块增长',
  'Endothelial injury to narrowing': '从内皮损伤到血管逐渐狭窄',
  'Heart Beat': '心脏搏动',
  'Cardiac workload and heartbeat': '展示心脏负荷与搏动变化',
  'Risk Pathway': '风险路径',
  'Hypertension to target-organ risk': '展示高血压到靶器官损伤风险的路径',
  'Avatar Layout': '数字人布局',
  'Presenter-only override · independent from scene.visual': '仅影响数字人 · 与 scene.visual 独立',
  'Hero': '主讲',
  'Bottom Left': '左下画中画',
  'Bottom Right': '右下画中画',
  'Hidden': '隐藏',
  'PiP Scale': '画中画缩放',
  'Subtitle Style': '字幕样式',
  'Visual-only override · narration timing is unchanged': '仅视觉覆盖 · 不改变旁白时间轴',
  'Medical': '医疗',
  'Minimal': '极简',
  'Social': '社交',
  'Type': '类型',
  'Slide': '幻灯片',
  'Avatar': '数字人',
  'Subtitle': '字幕',
  'Override draft': '覆盖草稿',
  'Actual timing': '实际时间轴',
  'Stale timing · estimated preview': '时间轴已过期 · 使用估算预览',
  'Estimated timing': '估算时间轴',
  '● Unsaved': '● 未保存',
  'Saved': '已保存',
  'Save': '保存',
  'Saving…': '保存中…',
  'Resolving…': '正在解析…',
  'Play': '播放',
  'Pause': '暂停',
  'Mute': '静音',
  'Unmute': '取消静音',
  'Fullscreen': '全屏',
  'Exit fullscreen': '退出全屏',
};

const ATTR_TEXT: Record<string, string> = {
  'Visual headline': '视觉标记文案',
  'Visual highlight': '视觉强调内容',
  'Visual support': '视觉辅助说明',
  'Statistic value': '数据指标数值',
  'Statistic label': '数据指标标签',
  'Statistic context': '数据指标补充说明',
  'Avatar scale': '数字人缩放',
};

const shouldSkip = (element: Element | null) =>
  Boolean(element?.closest('pre, code, script, style'));

export const translateEditorText = (source: string) => {
  const trimmed = source.trim();
  const exact = EXACT_TEXT[trimmed];
  if (exact) return source.replace(trimmed, exact);

  let next = source
    .replace(/^Loading\s+(.+?)…$/, '正在加载 $1…')
    .replace(/^Page\s+(\d+)$/, '第 $1 页')
    .replace(/^Slide\s+(\d+)$/i, '幻灯片第 $1 页')
    .replace(/\bDoctor\b/g, '医生')
    .replace(/\bDr \+ PPT\b/g, '医生 + PPT')
    .replace(/\bAnimation\b/g, '动画')
    .replace(/\bVisual\b/g, '视觉')
    .replace(/(\d+(?:\.\d+)?)s\b/g, '$1 秒')
    .replace(/(\d+)fps\b/g, '$1 帧/秒');

  return next;
};

const translateElementAttributes = (element: Element) => {
  if (shouldSkip(element)) return;

  for (const attribute of ['aria-label', 'title', 'alt', 'placeholder'] as const) {
    const value = element.getAttribute(attribute);
    if (!value) continue;
    const translated = ATTR_TEXT[value] ?? translateEditorText(value);
    if (translated !== value) element.setAttribute(attribute, translated);
  }

  if (element.classList.contains('project-name')) {
    const text = element.textContent?.trim();
    if (text && !text.startsWith('项目：')) element.textContent = `项目：${text}`;
  }
};

const translateNode = (node: Node) => {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    if (!parent || shouldSkip(parent) || !node.nodeValue) return;
    const translated = translateEditorText(node.nodeValue);
    if (translated !== node.nodeValue) node.nodeValue = translated;
    return;
  }

  if (!(node instanceof Element) || shouldSkip(node)) return;
  translateElementAttributes(node);

  const walker = document.createTreeWalker(
    node,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) {
      const parent = current.parentElement;
      if (parent && !shouldSkip(parent) && current.nodeValue) {
        const translated = translateEditorText(current.nodeValue);
        if (translated !== current.nodeValue) current.nodeValue = translated;
      }
    } else if (current instanceof Element) {
      translateElementAttributes(current);
    }
    current = walker.nextNode();
  }
};

export const enableChineseEditorUi = () => {
  document.documentElement.lang = 'zh-CN';
  document.title = 'MedAvatar 医学科普视频工作室';

  if (document.body) translateNode(document.body);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        translateNode(mutation.target);
        continue;
      }
      mutation.addedNodes.forEach(translateNode);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  return () => observer.disconnect();
};
