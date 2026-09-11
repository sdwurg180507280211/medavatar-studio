import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
import {enableChineseEditorUi} from './locale.zh-CN';
import './styles.css';

enableChineseEditorUi();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
