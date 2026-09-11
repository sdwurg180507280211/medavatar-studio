import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
import {ComposerApp} from './ComposerApp';
import {enableChineseEditorUi} from './locale.zh-CN';
import './styles.css';
import './composer.css';

enableChineseEditorUi();

const legacy = new URLSearchParams(window.location.search).get('legacy') === '1';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {legacy ? <App /> : <ComposerApp />}
  </React.StrictMode>,
);
