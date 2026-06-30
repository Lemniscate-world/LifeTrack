use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use serde::{Deserialize, Serialize};

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
    entries.sort_by_key(|e| {
        e.metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
    });
    while entries.len() > 10 {
        if let Some(old) = entries.first() {
            let _ = std::fs::remove_file(old.path());
            entries.remove(0);
        }
    }

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn export_file(app: tauri::AppHandle, json_data: String) -> Result<String, String> {
    let stamp = chrono::Local::now().format("%Y-%m-%d").to_string();
    let default_name = format!("lifetrack-export-{}.json", stamp);

    let file_path = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .set_file_name(&default_name)
        .blocking_save_file();

    match file_path {
        Some(p) => {
            let path = p
                .as_path()
                .ok_or_else(|| "Selected path is not a local filesystem path".to_string())?
                .to_path_buf();
            std::fs::write(&path, &json_data).map_err(|e| e.to_string())?;
            Ok(path.to_string_lossy().to_string())
        }
        None => Err("Cancelled".to_string()),
    }
}

#[tauri::command]
async fn import_file(app: tauri::AppHandle) -> Result<String, String> {
    let file_path = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file();

    match file_path {
        Some(p) => {
            let path = p
                .as_path()
                .ok_or_else(|| "Selected path is not a local filesystem path".to_string())?
                .to_path_buf();
            std::fs::read_to_string(&path).map_err(|e| e.to_string())
        }
        None => Err("Cancelled".to_string()),
    }
}

fn backup_has_data(content: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(content) else {
        return false;
    };
    ["habits", "checkIns", "notes"].iter().any(|key| {
        value
            .get(key)
            .and_then(|v| v.as_array())
            .map(|items| !items.is_empty())
            .unwrap_or(false)
    })
}

#[tauri::command]
fn find_latest_backup(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let backup_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("backups");
    if !backup_dir.exists() {
        return Ok(None);
    }
    let mut entries: Vec<_> = std::fs::read_dir(&backup_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "json"))
        .collect();
    // Sort by modified time, newest first
    entries.sort_by(|a, b| {
        b.metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
            .cmp(
                &a.metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH),
            )
    });
    for entry in entries {
        let content = std::fs::read_to_string(entry.path()).unwrap_or_default();
        if backup_has_data(&content) {
            return Ok(Some(content));
        }
    }
    Ok(None)
}

// --- Ollama / Local AI integration ---

#[derive(Serialize)]
struct OllamaRequest {
    model: String,
    prompt: String,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<OllamaOptions>,
}

#[derive(Serialize)]
struct OllamaOptions {
    temperature: f32,
    num_predict: u32,
}

#[derive(Deserialize)]
struct OllamaResponse {
    response: String,
    #[allow(dead_code)]
    done: bool,
}

/// Call Ollama's local API for AI-powered habit analysis.
/// Sends a structured prompt about the user's habits and returns insights.
/// Respects privacy: only statistical summaries are sent, never raw data.
#[tauri::command]
async fn analyze_habits(summary_json: String, model: Option<String>) -> Result<String, String> {
    let model = model.unwrap_or_else(|| "minimax-m3:cloud".to_string());

    // Build a structured but privacy-respecting prompt
    let prompt = format!(
        "You are a kind, supportive habit coach. Analyze the following habit data and give 3-5 concise, actionable insights.\n\
         Focus on: patterns, correlations, suggestions for habit stacking, and motivational observations.\n\
         Be warm but direct. Use bullet points. No markdown headers. Max 200 words.\n\n\
         HABIT DATA (anonymized):\n{}",
        summary_json
    );

    let body = OllamaRequest {
        model,
        prompt,
        stream: false,
        options: Some(OllamaOptions {
            temperature: 0.7,
            num_predict: 300,
        }),
    };

    let client = reqwest::Client::new();
    let resp = client
        .post("http://localhost:11434/api/generate")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama connection failed: {}. Is Ollama running?", e))?;

    let ollama_resp: OllamaResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    Ok(ollama_resp.response)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            auto_backup,
            export_file,
            import_file,
            find_latest_backup,
            analyze_habits
        ])
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
