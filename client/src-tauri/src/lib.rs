// 桌面与移动端共享的运行入口：构建 Tauri App、注册插件、加载前端。
// 当前仅注册了 http 插件，后续在这里挂更多插件（fs、shell、notification 等）。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Stronghold 2.3+ 要求 Builder::new 显式传入一个 password → key 的派生函数。
    // 这里用 SHA-256 把任意长度的 password 压成 32 字节 key。
    // 占位：TS 侧当前用的是常量密码（见 secure-store.ts 的 STORE_PASSWORD），
    // 真正的 password 由 OS keychain 派生（Task 5.6 接入），届时把 closure 换成正经 KDF 即可。
    use sha2::{Digest, Sha256};
    let password_hash = |password: &str| {
        let digest = Sha256::digest(password.as_bytes());
        digest.to_vec()
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_stronghold::Builder::new(password_hash).build())
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
