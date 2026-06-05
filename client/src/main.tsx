// React 应用入口：把根组件挂载到 #root，并启用严格模式以便尽早暴露副作用问题。
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// 拿挂载点；找不到说明 HTML 模板有问题，直接抛错比静默失败更安全。
const root = document.getElementById('root');
if (!root) {
  throw new Error('root element not found');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
