#!/usr/bin/env node
// CI 校验：versions/compat-matrix.json 必须满足 schema 1 规则。
// 任一检查失败即非零退出，并把第一个错误打印到 stderr。
import semver from 'semver';

const REQUIRED_COMPONENTS = ['client', 'gateway', 'core'];

/**
 * 校验 matrix 对象。返回 null 表示通过；返回字符串表示第一个错误。
 */
export function checkMatrix(matrix) {
  if (!matrix || typeof matrix !== 'object') {
    return 'matrix 不是对象';
  }
  if (matrix.schema !== 1) {
    return `schema 必须是 1，当前为 ${matrix.schema}`;
  }
  if (!matrix.components || typeof matrix.components !== 'object') {
    return '缺 components 字段';
  }
  const missing = REQUIRED_COMPONENTS.filter(name => !matrix.components[name]);
  if (missing.length > 0) {
    return `components 缺 ${missing.join(', ')}`;
  }
  if (!matrix.compat || typeof matrix.compat !== 'object') {
    return '缺 compat 字段';
  }
  for (const [downstream, upstreamMap] of Object.entries(matrix.compat)) {
    if (!matrix.components[downstream]) {
      return `compat 引用的下游 ${downstream} 不在 components 里`;
    }
    for (const [upstream, range] of Object.entries(upstreamMap)) {
      if (!matrix.components[upstream]) {
        return `compat.${downstream}.${upstream} 引用了不存在的组件 ${upstream}`;
      }
      if (!semver.validRange(range)) {
        return `compat.${downstream}.${upstream} 的 range "${range}" 不是合法 semver range`;
      }
    }
  }
  return null;
}

// CLI 入口：仅当作为主模块运行时执行
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  import('node:fs').then(async ({ readFileSync }) => {
    const path = process.argv[2] ?? 'versions/compat-matrix.json';
    let matrix;
    try {
      matrix = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      console.error(`✖ 读取 ${path} 失败: ${e.message}`);
      process.exit(1);
    }
    const err = checkMatrix(matrix);
    if (err) {
      console.error(`✖ ${err}`);
      process.exit(1);
    }
    console.log(`✓ ${path} 通过 schema 1 校验`);
  });
}
