// ESLint 9 flat config：根目录集中管理，跨子项目复用。
// 子项目目录内执行 `eslint .` 时会沿父目录链查找本文件。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// 通用忽略：构建产物、依赖、临时数据、Tauri 现场生成物。
const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/coverage/**',
  '**/.turbo/**',
  '**/.vite/**',
  '**/*.tsbuildinfo',
  'client/src-tauri/target/**',
  'client/src-tauri/gen/**',
  'data/**',
  'screenshots/**',
  'tmp/**',
  'logs/**',
];

export default [
  {
    ignores,
  },
  // 基础 JS 推荐 + TS 推荐规则。
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // 整库通用规则：未使用变量、类型导入一致性、显式 any 警告。
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      // 强制 if / else / for / while / do 必须带花括号（与 Prettier 的紧凑行为互补）。
      curly: ['error', 'all'],
    },
  },
  // Node 子项目（gateway、core）：Node 全局 + 允许 process.exit。
  {
    files: ['gateway/**/*.ts', 'core/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-process-exit': 'off',
    },
  },
  // 客户端源码：浏览器全局 + React / Hooks 规则。
  {
    files: ['client/src/**/*.{ts,tsx,jsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
    },
  },
  // 客户端配置文件：vite.config.ts 等 Node 环境。
  {
    files: ['client/vite.config.ts', 'client/**/*.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  // 测试文件：放宽 any / 魔法数字等约束，便于断言。
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
];
