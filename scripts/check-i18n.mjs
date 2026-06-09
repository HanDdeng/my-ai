#!/usr/bin/env node
// v5: i18n 资源完整性校验（CI 脚本 + 单测共用）。
// 规则：
//  1. en/translation.json 与 zh-CN/translation.json 都是合法 JSON
//  2. 两个文件 key 集合（递归收集路径）完全一致
//  3. 任何 value 不是 string → fail
// 失败码非 0 → CI 红。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOCALES_DIR = resolve('client/src/i18n/locales');
const LOCALES = ['en', 'zh-CN'];

/**
 * 校验给定 in-memory JSON 对象。
 * @param {Record<string, unknown>} data
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkI18n(data) {
  const errors = [];

  // 0. 顶层必须是 plain object（防御 locale 整个被替换为 primitive 的边界情况）
  for (const lng of Object.keys(data)) {
    if (data[lng] === null || typeof data[lng] !== 'object' || Array.isArray(data[lng])) {
      errors.push(
        `✖ ${lng} 根节点必须是 object（实际 ${Array.isArray(data[lng]) ? 'array' : typeof data[lng]}）`,
      );
    }
  }

  const flat = {};
  for (const lng of Object.keys(data)) {
    flat[lng] = flattenKeys(data[lng], '', `${lng}/`);
  }

  // 1. value 必须是 string
  for (const lng of Object.keys(flat)) {
    for (const { path, value } of flat[lng]) {
      if (typeof value !== 'string') {
        errors.push(
          `✖ ${lng}${path ? '.' + path : ''} 的 value 不是 string（实际类型 ${typeof value}）`,
        );
      }
    }
  }

  // 2. key 集合完全一致
  const keysByLng = {};
  for (const lng of Object.keys(flat)) {
    keysByLng[lng] = new Set(flat[lng].map(e => e.path));
  }
  const lngs = Object.keys(keysByLng);
  for (let i = 0; i < lngs.length; i++) {
    for (let j = i + 1; j < lngs.length; j++) {
      const a = lngs[i];
      const b = lngs[j];
      const missingA = [...keysByLng[b]].filter(k => !keysByLng[a].has(k));
      const missingB = [...keysByLng[a]].filter(k => !keysByLng[b].has(k));
      for (const k of missingA) {
        errors.push(`✖ ${a} 缺少 key "${k}"（${b} 存在）`);
      }
      for (const k of missingB) {
        errors.push(`✖ ${b} 缺少 key "${k}"（${a} 存在）`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 递归收集 key 路径 + value。
 * @param {unknown} obj
 * @param {string} prefix
 * @param {string} label
 * @returns {Array<{ path: string, value: unknown }>}
 */
function flattenKeys(obj, prefix, label) {
  const out = [];
  if (obj === null || obj === undefined || typeof obj !== 'object' || Array.isArray(obj)) {
    if (prefix) {
      out.push({ path: prefix, value: obj });
    }
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flattenKeys(v, path, label));
    } else {
      out.push({ path, value: v });
    }
  }
  return out;
}

// CLI 入口：仅在直接运行时执行
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const data = {};
  let loadOk = true;
  for (const lng of LOCALES) {
    const path = resolve(LOCALES_DIR, lng, 'translation.json');
    try {
      const text = readFileSync(path, 'utf8');
      data[lng] = JSON.parse(text);
    } catch (e) {
      console.error(`✖ JSON 解析失败: ${path}\n  ${e.message}`);
      loadOk = false;
    }
  }
  if (!loadOk) {
    process.exit(1);
  }
  const result = checkI18n(data);
  for (const err of result.errors) {
    console.error(err);
  }
  if (result.ok) {
    console.log(`✓ i18n check passed: ${LOCALES.length} locales, key 集合一致`);
  } else {
    process.exit(1);
  }
}
