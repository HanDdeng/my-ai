// 客户端加密 store：封装 tauri-plugin-stronghold。
// 数据：clientKey、gatewayUrl、pairKey（可选）、clientName（可选）
// 存到 OS keychain（macOS Keychain / Windows DPAPI / Linux Secret Service）。
// 浏览器测试用 mock 替代（dev / test 环境无原生 plugin）。
import { Stronghold } from '@tauri-apps/plugin-stronghold';

const STORE_PATH = 'pair-config.dat';
const RECORD_NAME = 'pair-config';
const CONFIG_KEY = 'v1';
// v3 里程碑：真正的 password 由 OS keychain 派生（Task 5.6 接入）。
// 此处先用占位常量保证类型 / 流程跑通；CI 测试全靠 mock，不会真正落到磁盘。
const STORE_PASSWORD = 'my-ai-client-dev';

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

export async function saveSecureConfig(cfg: SecureConfig): Promise<void> {
  const client = await getClient();
  const store = client.getStore();
  const bytes = new TextEncoder().encode(JSON.stringify(cfg));
  // stronghold Store.insert 要求 number[]；用 Array.from 展开 Uint8Array。
  await store.insert(CONFIG_KEY, Array.from(bytes));
}

export async function loadSecureConfig(): Promise<SecureConfig | null> {
  const client = await getClient();
  const store = client.getStore();
  const bytes = await store.get(CONFIG_KEY);
  if (!bytes) {
    return null;
  }
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as SecureConfig;
}

export async function clearSecureConfig(): Promise<void> {
  const client = await getClient();
  const store = client.getStore();
  await store.remove(CONFIG_KEY);
}
