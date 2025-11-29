use tauri::Manager;

/// ログディレクトリのパスを取得
///
/// アプリケーションのログファイルが保存されているディレクトリのパスを返す。
///
/// # 戻り値
/// ログディレクトリの絶対パス、またはエラーメッセージ
#[tauri::command]
pub fn get_log_directory(app: tauri::AppHandle) -> Result<String, String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| e.to_string())?;
    
    Ok(log_dir.to_string_lossy().to_string())
}

/// ログディレクトリをFinderまたはエクスプローラーで開く
///
/// ログファイルが保存されているディレクトリをシステムのファイルマネージャーで開く。
///
/// # 戻り値
/// 成功時は`Ok(())`、失敗時はエラーメッセージ
#[tauri::command]
pub async fn open_log_directory(app: tauri::AppHandle) -> Result<(), String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| e.to_string())?;
    
    // ディレクトリが存在しない場合は作成
    if !log_dir.exists() {
        std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    }
    
    let path_str = log_dir.to_string_lossy().to_string();
    println!("Log directory: {}", path_str);

    // ディレクトリ内のログファイルを検索
    let mut target_path = path_str.clone();
    if let Ok(entries) = std::fs::read_dir(&log_dir) {
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                if let Some(extension) = path.extension() {
                    if extension == "log" {
                        target_path = path.to_string_lossy().to_string();
                        println!("Found log file: {}", target_path);
                        break;
                    }
                }
            }
        }
    }
    
    #[cfg(target_os = "macos")]
    {
        // ログファイルが見つかった場合は -R でそのファイルを表示
        // 見つからなかった場合はディレクトリ自体を -R で表示（親ディレクトリが開くはず）
        let output = std::process::Command::new("open")
            .arg("-R")
            .arg(&target_path)
            .output()
            .map_err(|e| format!("Failed to execute open command: {}", e))?;
            
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            println!("Open command failed: {}", stderr);
            return Err(format!("Open command failed: {}", stderr));
        }
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&target_path)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Linuxではディレクトリを開く
        std::process::Command::new("xdg-open")
            .arg(&path_str)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {}", e))?;
    }
    
    Ok(())
}
