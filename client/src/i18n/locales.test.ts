// v6.5: lock v6.5 zh-CN i18n key 中文化 + 校验真实 locale 文件 key 集合一致。
//   1) 直接读 client/src/i18n/locales/{en,zh-CN}/translation.json，过 check-i18n。
//      真实文件（不在内存里造数据），锁住未来增删 key 时 CI 会立刻红。
//   2) 锁 v6.5 落地的中文化串（避免后续 refactor 时串被误改回英文）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { describe, it, expect } from 'vitest';
// @ts-expect-error: check-i18n.mjs 是 plain Node 脚本，没有 .d.ts
import { checkI18n } from '../../../scripts/check-i18n.mjs';
import en from './locales/en/translation.json';
import zhCN from './locales/zh-CN/translation.json';

const localesDir = resolve(dirname(fileURLToPath(import.meta.url)), 'locales');

describe('i18n 真实文件 lock (v6.5)', () => {
  it('en + zh-CN 真实 translation.json 过 check-i18n (key 集合一致 + value 全是 string)', () => {
    const enData = JSON.parse(
      readFileSync(resolve(localesDir, 'en/translation.json'), 'utf8'),
    ) as Record<string, unknown>;
    const zhData = JSON.parse(
      readFileSync(resolve(localesDir, 'zh-CN/translation.json'), 'utf8'),
    ) as Record<string, unknown>;
    const result = checkI18n({ en: enData, 'zh-CN': zhData });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('v6.5: theme / 主页 / 配对弹窗 / lang 标签中文化', () => {
  it('theme.light / theme.dark zh-CN 文本', () => {
    expect(zhCN.theme.light).toBe('亮色');
    expect(zhCN.theme.dark).toBe('暗色');
  });

  it('app.title / app.titleEm zh-CN 文本（主页）', () => {
    expect(zhCN.app.title).toBe('网关配对');
    expect(zhCN.app.titleEm).toBe('配对');
  });

  it('pair.dialog.sub / fields.url.req / fields.pairKey.opt zh-CN 文本（配对弹窗）', () => {
    expect(zhCN.pair.dialog.sub).toBe('配对流程 / 第 1 步');
    expect(zhCN.pair.dialog.fields.url.req).toBe('必填');
    expect(zhCN.pair.dialog.fields.pairKey.opt).toBe('可选');
  });

  it('lang.en zh-CN 文本（"英"）', () => {
    expect(zhCN.lang.en).toBe('英');
  });

  it('chat.headerSummary zh-CN 文本（v6.5 增量：聊天侧边栏顶部 "{{name}} · N 条消息"）', () => {
    expect(zhCN.chat.headerSummary).toBe('{{name}} · {{count}} 条消息');
  });

  // 防御：英文 locale 不应该被中文化污染（双向锁）。
  it('英文 locale 保持原值（v6.5 改动不影响 en）', () => {
    expect(en.theme.light).toBe('LIGHT');
    expect(en.theme.dark).toBe('DARK');
    expect(en.app.title).toBe('GATEWAY PAIR');
    expect(en.app.titleEm).toBe('PAIR');
    expect(en.pair.dialog.sub).toBe('PAIRING / STEP 01');
    expect(en.pair.dialog.fields.url.req).toBe('REQ');
    expect(en.pair.dialog.fields.pairKey.opt).toBe('OPT');
    expect(en.lang.en).toBe('EN');
    expect(en.chat.headerSummary).toBe('{{name}} · {{count}} messages');
  });
});
