// 旧入口：保持向后兼容（node dist/index.js 等价于 my-ai-gateway start）。
import { cmdStart } from './cli.js';
void cmdStart();
