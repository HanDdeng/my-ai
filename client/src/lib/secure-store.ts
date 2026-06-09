// 客户端加密 store：封装 tauri-plugin-stronghold。
// 数据：clientKey、gatewayUrl、pairKey（可选）、clientName（可选）
// 存到 OS keychain（macOS Keychain / Windows DPAPI / Linux Secret Service）。
// 浏览器测试用 mock 替代（dev / test 环境无原生 plugin）。
import { Stronghold } from '@tauri-apps/plugin-stronghold';
import { isTauri } from '@tauri-apps/api/core';

const STORE_PATH = 'pair-config.dat';
const RECORD_NAME = 'pair-config';
const CONFIG_KEY = 'v1';
// v3 里程碑：真正的 password 由 OS keychain 派生（Task 5.6 接入）。
// 此处先用占位常量保证类型 / 流程跑通；CI 测试全靠 mock，不会真正落到磁盘。
const STORE_PASSWORD = 'my-ai-client-dev';

// 浏览器开发/手动测试 fallback：用 localStorage 暂存配对信息。
// ⚠️ 仅 dev 用，不在生产构建里走——打包为 Tauri 桌面端时 isTauri() 始终为 true。
const BROWSER_STORE_KEY = 'my-ai-dev-pair-config';

export type SecureConfig = {
  clientKey: string;
  gatewayUrl: string;
  pairKey: string | null;
  clientName: string | null;
};

async function getClient() {
  const stronghold = await Stronghold.load(STORE_PATH, STORE_PASSWORD);
  return stronghold.createClient(RECORD_NAME);
}

// ===== Tauri (Stronghold) 路径 =====
async function saveToTauri(cfg: SecureConfig): Promise<void> {
  const client = await getClient();
  const store = client.getStore();
  const bytes = new TextEncoder().encode(JSON.stringify(cfg));
  // stronghold Store.insert 要求 number[]；用 Array.from 展开 Uint8Array。
  await store.insert(CONFIG_KEY, Array.from(bytes));
}

async function loadFromTauri(): Promise<SecureConfig | null> {
  const client = await getClient();
  const store = client.getStore();
  const bytes = await store.get(CONFIG_KEY);
  if (!bytes) {
    return null;
  }
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as SecureConfig;
}

async function clearFromTauri(): Promise<void> {
  const client = await getClient();
  const store = client.getStore();
  await store.remove(CONFIG_KEY);
}

// ===== 浏览器 (localStorage) 路径：dev-only fallback =====
// 用全局 localStorage 模拟 secure store；只在 isTauri() === false 时走。
// 注：localStorage 是同步且跨 origin 共享的，仅用于本地手动测试流程。
function saveToBrowser(cfg: SecureConfig): void {
  localStorage.setItem(BROWSER_STORE_KEY, JSON.stringify(cfg));
}

function loadFromBrowser(): SecureConfig | null {
  const raw = localStorage.getItem(BROWSER_STORE_KEY);
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as SecureConfig;
}

function clearFromBrowser(): void {
  localStorage.removeItem(BROWSER_STORE_KEY);
}

// ===== 公共 API =====
export async function saveSecureConfig(cfg: SecureConfig): Promise<void> {
  if (!isTauri()) {
    saveToBrowser(cfg);
    return;
  }
  await saveToTauri(cfg);
}

export async function loadSecureConfig(): Promise<SecureConfig | null> {
  if (!isTauri()) {
    return loadFromBrowser();
  }
  return loadFromTauri();
}

export async function clearSecureConfig(): Promise<void> {
  if (!isTauri()) {
    clearFromBrowser();
    return;
  }
  await clearFromTauri();
}
