/**
 * ChatGPT DOM knowledge is intentionally kept in this file. The page adapter
 * calls these scripts through CDP so a future ChatGPT DOM change has one
 * place to update.
 */
export const CHATGPT_SELECTORS = {
  assistantMessages: '[data-message-author-role="assistant"]',
  conversationTurns: '[data-testid*="conversation-turn"]',
  composer: 'textarea, [contenteditable="true"], [role="textbox"]',
  stopButtons: '[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="停止"]',
  sendButtons: '[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="发送"]',
  errorNodes: '[role="alert"], [data-testid*="error"], [data-testid*="Error"]',
} as const;

const selectorsJson = JSON.stringify(CHATGPT_SELECTORS);

export const installMutationObserverScript = `(() => {
  const key = '__medavatarRelayMutationState';
  if (window[key]) return window[key];
  const state = {version: 0, lastMutationAt: Date.now()};
  window[key] = state;
  const mark = () => {
    state.version += 1;
    state.lastMutationAt = Date.now();
  };
  if (document.body) {
    new MutationObserver(mark).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'data-state'],
    });
  }
  return state;
})()`;

export const inspectChatGptPageScript = `(() => {
  const selectors = ${selectorsJson};
  const all = (selector) => Array.from(document.querySelectorAll(selector));
  const visible = (element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const editable = (element) => Boolean(
    element
    && visible(element)
    && (element.tagName === 'TEXTAREA' || element.isContentEditable || element.getAttribute('contenteditable') === 'true' || element.getAttribute('role') === 'textbox'),
  );
  const fingerprint = (value) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16) + ':' + value.length;
  };
  const candidates = [];
  const seen = new Set();
  for (const element of all(selectors.assistantMessages)) {
    if (!seen.has(element)) { seen.add(element); candidates.push(element); }
  }
  if (candidates.length === 0) {
    for (const element of all(selectors.conversationTurns)) {
      if (element.querySelector('[data-message-author-role="assistant"]') && !seen.has(element)) {
        seen.add(element);
        candidates.push(element);
      }
    }
  }
  const latestElement = candidates[candidates.length - 1];
  const latestText = latestElement ? (latestElement.innerText || latestElement.textContent || '').trim() : '';
  const latestIdentity = latestElement
    ? latestElement.getAttribute('data-message-id') || latestElement.id || latestElement.getAttribute('data-testid') || String(candidates.length - 1)
    : '';
  const stopButton = all(selectors.stopButtons).find(visible);
  const stopText = all('button').some((button) => {
    if (!visible(button)) return false;
    const text = (button.innerText || button.getAttribute('aria-label') || '').trim().toLowerCase();
    return text === 'stop' || text.includes('stop generating') || text.includes('停止生成') || text === '停止';
  });
  const generating = Boolean(stopButton || stopText);
  const composers = all(selectors.composer).filter(editable);
  const composer = composers[composers.length - 1];
  const disabled = Boolean(composer && (composer.disabled || composer.getAttribute('aria-disabled') === 'true'));
  const errors = all(selectors.errorNodes)
    .map((element) => (element.innerText || element.textContent || '').trim())
    .filter(Boolean)
    .join('\\n');
  const contextLimitReached = /(maximum context|context window|conversation is too long|reached the maximum|最大上下文|上下文.{0,8}(超限|已满|过长)|对话.{0,8}(过长|达到上限))/i.test(errors);
  const mutation = window.__medavatarRelayMutationState || {version: 0, lastMutationAt: Date.now()};
  return {
    hasComposer: Boolean(composer),
    inputReady: Boolean(composer && !disabled),
    generating,
    contextLimitReached,
    pageError: errors || undefined,
    latestAssistant: latestText ? {fingerprint: fingerprint(latestIdentity + '\\n' + latestText), text: latestText} : undefined,
    mutationVersion: Number(mutation.version) || 0,
    lastMutationAt: Number(mutation.lastMutationAt) || Date.now(),
  };
})()`;

export const focusComposerScript = `(() => {
  const selectors = ${selectorsJson};
  const visible = (element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const composer = Array.from(document.querySelectorAll(selectors.composer)).filter((element) => (
    visible(element)
    && (element.tagName === 'TEXTAREA' || element.isContentEditable || element.getAttribute('contenteditable') === 'true' || element.getAttribute('role') === 'textbox')
  )).at(-1);
  if (!composer || composer.disabled || composer.getAttribute('aria-disabled') === 'true') return false;
  composer.focus();
  return document.activeElement === composer;
})()`;

export const clickSendButtonScript = `(() => {
  const selectors = ${selectorsJson};
  const visible = (element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const candidates = Array.from(document.querySelectorAll(selectors.sendButtons)).filter(visible);
  const fallback = Array.from(document.querySelectorAll('button')).filter((button) => {
    if (!visible(button)) return false;
    const text = (button.innerText || button.getAttribute('aria-label') || '').trim().toLowerCase();
    return text === 'send' || text.includes('send message') || text === '发送';
  });
  const button = [...candidates, ...fallback].find((element) => !element.disabled && element.getAttribute('aria-disabled') !== 'true');
  if (!button) return {clicked: false};
  button.click();
  return {clicked: true};
})()`;
