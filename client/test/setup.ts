// Vitest 通用 setup：注册 @testing-library/jest-dom 断言（toBeInTheDocument 等）。
import '@testing-library/jest-dom/vitest';

// v5: 钉死测试语种为 zh-CN，避免依赖 navigator.language
import i18n from '@/i18n/index.js';
i18n.changeLanguage('zh-CN');
