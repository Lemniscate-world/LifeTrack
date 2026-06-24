use tauri::Manager;

#[tauri::command]
fn auto_backup(app: tauri::AppHandle, json_data: String) -> Result<String, String> {
    let backup_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("backups");
    std::fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;

    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let filename = format!("lifetrack-backup-{}.json", stamp);
    let path = backup_dir.join(&filename);
    std::fs::write(&path, &json_data).map_err(|e| e.to_string())?;

    // Keep only the 10 most recent backups
    let mut entries: Vec<_> = std::fs::read_dir(&backup_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "json"))
        .collect();
    entries.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::SystemTime::UNIX_EPOCH));
    while entries.len() > 10 {
        if let Some(old) = entries.first() {
            let _ = std::fs::remove_file(old.path());
            entries.remove(0);
        }
    }

    Ok(path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![auto_backup])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
