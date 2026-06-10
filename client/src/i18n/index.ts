// 客户端 i18n 初始化（v5）：静态 import 资源 + 检测链。
// 资源文件小（en + zh-CN 合计 < 5KB），无 HTTP 开销、无 CORS 顾虑（Tauri file:// 协议）。
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en/translation.json';
import zhCN from './locales/zh-CN/translation.json';

const STORAGE_KEY = 'my-ai:lang';
const SUPPORTED = ['zh-CN', 'en'] as const;
export type Supported = (typeof SUPPORTED)[number];

function detectLng(): Supported {
  // 1. localStorage
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (SUPPORTED as readonly string[]).includes(stored)) {
      return stored as Supported;
    }
  } catch {
    // 隐私模式 / localStorage 不可用 → 降级
  }
  // 2. navigator.language 主语种
  const primary = typeof navigator !== 'undefined' ? (navigator.language.split('-')[0] ?? '') : '';
  if (primary === 'zh') {
    return 'zh-CN';
  }
  if (primary === 'en') {
    return 'en';
  }
  // 3. fallback
  return 'zh-CN';
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      'zh-CN': { translation: zhCN },
    },
    lng: detectLng(),
    fallbackLng: 'zh-CN',
    interpolation: {
      escapeValue: false, // React 已防 XSS，i18next 不必再 escape
    },
    returnNull: false, // 缺 key 时返回 fallbackLng 串，不返回空串
  })
  .catch((e: unknown) => {
    // i18n init 失败时只 log，不阻塞应用启动
    console.error('i18n init failed:', e);
  });

export { SUPPORTED };
export default i18n;
