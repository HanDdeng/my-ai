// commitlint 根配置：强制 Conventional Commits 规范。
// 详细规则见 https://www.conventionalcommits.org/
//
// 允许的 type（在 config-conventional 基础上略放宽，纳入 docs/ci/style/build/test/chore/perf）：
//   feat     新功能
//   fix      修 bug
//   docs     仅文档变更
//   style    格式（不影响代码运行）
//   refactor 重构（既不是 feat 也不是 fix）
//   perf     性能优化
//   test     仅测试变更
//   build    构建系统或外部依赖变更
//   ci       CI 配置变更
//   chore    其他不影响 src / test 的变更
//   revert   回滚
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    'header-max-length': [2, 'always', 100],
  },
};
