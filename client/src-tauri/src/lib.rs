// 桌面与移动端共享的运行入口：构建 Tauri App、注册插件、加载前端。
// 当前仅注册了 http 插件，后续在这里挂更多插件（fs、shell、notification 等）。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
