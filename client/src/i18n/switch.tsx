// 顶栏语言切换按钮（v5）：zh-CN ↔ en。点轮换 + 写 localStorage。
// 与 ThemeToggle 同级（header 内右侧）。2 个语种用按钮最简，不做下拉。
import { useTranslation } from 'react-i18next';
import { SUPPORTED } from './index.js';

const NEXT: Record<string, string> = { 'zh-CN': 'en', en: 'zh-CN' };
// i18n.language 是 'zh-CN' / 'en'，但 lang 资源 key 是 'lang.zh' / 'lang.en'（短码作 label）。
// zh-CN → 'lang.zh'，en → 'lang.en'。未知语种兜底 'lang.zh'（与 fallbackLng 一致）。
const LABEL_KEY: Record<string, string> = { 'zh-CN': 'lang.zh', en: 'lang.en' };

function labelKeyFor(lng: string): string {
  return LABEL_KEY[lng] ?? 'lang.zh';
}

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const current = i18n.language;
  const next = NEXT[current] ?? 'en';
  const nextLabel = t(labelKeyFor(next));
  const currentLabel = t(labelKeyFor(current));

  const handleClick = () => {
    void i18n.changeLanguage(next).then(() => {
      try {
        localStorage.setItem('my-ai:lang', next);
      } catch {
        // 隐私模式 / localStorage 不可用 → 静默忽略（会话期内有效即可）
      }
    });
  };

  return (
    <button
      type="button"
      className="lang-toggle"
      data-current={current}
      onClick={handleClick}
      aria-label={t('lang.aria', { current: currentLabel })}
      title={`${currentLabel} → ${nextLabel}`}
    >
      <span className="dot" aria-hidden="true" />
      <span>{currentLabel}</span>
    </button>
  );
}

export { SUPPORTED };
