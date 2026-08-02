use std::sync::LazyLock;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use serde::{Deserialize, Serialize};

static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    // Generous timeout: local Ollama models can take several minutes to cold-load.
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .expect("Failed to build HTTP client")
});

fn backup_to_dir(dir: &std::path::Path, json_data: &str, stamp: &str, keep: usize) -> Result<String, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let filename = format!("lifetrack-backup-{}.json", stamp);
    let path = dir.join(&filename);
    std::fs::write(&path, json_data).map_err(|e| e.to_string())?;

    // Keep only the N most recent backups
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "json"))
        .collect();
    entries.sort_by_key(|e| {
        e.metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
    });
    while entries.len() > keep {
        if let Some(old) = entries.first() {
            let _ = std::fs::remove_file(old.path());
            entries.remove(0);
        }
    }
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn auto_backup(app: tauri::AppHandle, json_data: String) -> Result<String, String> {
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();

    // Primary: AppData (roaming)
    let appdata_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("backups");
    let _ = backup_to_dir(&appdata_dir, &json_data, &stamp, 10);

    // Secondary: Documents (survives AppData wipe)
    let docs_dir = app
        .path()
        .document_dir()
        .map_err(|e| e.to_string())?
        .join("LifeTrack-Backups");
    let doc_path = backup_to_dir(&docs_dir, &json_data, &stamp, 20);

    // Tertiary: Desktop (easy to find, hard to accidentally delete)
    if let Ok(desktop) = app.path().desktop_dir() {
        let desktop_dir = desktop.join("LifeTrack-Backups");
        let _ = backup_to_dir(&desktop_dir, &json_data, &stamp, 10);
    }

    // Quaternary: Dropbox (cloud-synced, survives disk failure)
    if let Ok(home) = app.path().home_dir() {
        let dropbox = home.join("Dropbox").join("Apps").join("LifeTrack");
        if dropbox.exists() || home.join("Dropbox").exists() {
            let _ = backup_to_dir(&dropbox, &json_data, &stamp, 30);
        }

        // Quinary: OneDrive (cloud-synced, auto-detected)
        if let Ok(entries) = std::fs::read_dir(&home) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with("OneDrive") && entry.path().is_dir() {
                    let onedrive = entry.path().join("Apps").join("LifeTrack");
                    let _ = backup_to_dir(&onedrive, &json_data, &stamp, 30);
                    break;
                }
            }
        }
    }

    // Return the Documents path as primary result (most reliable)
    doc_path
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

fn find_newest_in_dir(dir: &std::path::Path) -> Option<String> {
    if !dir.exists() {
        return None;
    }
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .ok()?
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
            return Some(content);
        }
    }
    None
}

#[tauri::command]
fn find_latest_backup(app: tauri::AppHandle) -> Result<Option<String>, String> {
    // Priority-ordered list of ALL directories where backups may exist.
    // Mirrors doFileBackup() in store.ts AND auto_backup() above.
    let mut locations: Vec<std::path::PathBuf> = Vec::new();

    // 1. AppData — rolling timestamped backups written by auto_backup()
    if let Ok(d) = app.path().app_data_dir() {
        locations.push(d.join("backups"));
        // Also check the single-file persistent backup from doFileBackup()
        locations.push(d.join("LifeTrack"));
    }

    // 2. Documents — both timestamped and single-file backups
    if let Ok(d) = app.path().document_dir() {
        locations.push(d.join("LifeTrack-Backups"));
    }

    // 3. Desktop — easy to find manually
    if let Ok(d) = app.path().desktop_dir() {
        locations.push(d.join("LifeTrack-Backups"));
    }

    // 4. Dropbox (cloud-synced, survives disk failure)
    // 5. OneDrive (cloud-synced, auto-detected)
    // 6. Google Drive (cloud-synced, common paths)
    if let Ok(home) = app.path().home_dir() {
        // Dropbox
        let dropbox = home.join("Dropbox").join("Apps").join("LifeTrack");
        if home.join("Dropbox").exists() {
            locations.push(dropbox);
        }

        // OneDrive — try all common variants
        if let Ok(entries) = std::fs::read_dir(&home) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with("OneDrive") && entry.path().is_dir() {
                    locations.push(entry.path().join("Apps").join("LifeTrack"));
                }
            }
        }

        // Google Drive — try common paths
        for gd in &[
            home.join("Google Drive"),
            home.join("GoogleDrive"),
            home.join("Google Drive").join("My Drive"),
        ] {
            if gd.exists() {
                locations.push(gd.join("Apps").join("LifeTrack"));
            }
        }
    }

    // Search all locations, return first match (priority order is preserved)
    for dir in &locations {
        if let Some(content) = find_newest_in_dir(dir) {
            return Ok(Some(content));
        }
    }

    Ok(None)
}

// --- AI integration: local Ollama + cloud (OpenRouter) ---

const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

#[derive(Serialize)]
struct OllamaRequest {
    model: String,
    prompt: String,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<String>,
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

#[derive(Deserialize)]
struct OllamaModelEntry {
    name: String,
    #[serde(default)]
    remote_host: Option<String>,
    #[serde(default)]
    capabilities: Vec<String>,
}

#[derive(Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModelEntry>,
}

// --- OpenRouter (cloud) request/response shapes ---

#[derive(Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct OpenRouterRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<OpenRouterResponseFormat>,
}

#[derive(Serialize)]
struct OpenRouterResponseFormat {
    #[serde(rename = "type")]
    format_type: String,
}

#[derive(Deserialize)]
struct OpenRouterResponse {
    choices: Vec<OpenRouterChoice>,
}

#[derive(Deserialize)]
struct OpenRouterChoice {
    message: OpenRouterMessage,
}

#[derive(Deserialize)]
struct OpenRouterMessage {
    content: String,
}

/// How the caller wants the AI to behave (temperature, token cap, JSON).
struct AiCall {
    system_prompt: String,
    user_prompt: String,
    temperature: f32,
    max_tokens: u32,
    json: bool,
}

/// Call a local Ollama endpoint. `model` must already be resolved.
async fn call_ollama(model: String, call: &AiCall, json_format: bool) -> Result<String, String> {
    let body = OllamaRequest {
        model,
        prompt: format!("{}\n\n{}", call.system_prompt, call.user_prompt),
        stream: false,
        format: if json_format {
            Some("json".to_string())
        } else {
            None
        },
        options: Some(OllamaOptions {
            temperature: call.temperature,
            num_predict: call.max_tokens,
        }),
    };

    let resp = HTTP_CLIENT
        .post("http://localhost:11434/api/generate")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama connection failed: {}. Is Ollama running?", e))?;

    let status = resp.status();
    if !status.is_success() {
        let err_body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "Ollama returned HTTP {}: {}. Try a local model with `ollama pull gemma3:4b`.",
            status, err_body
        ));
    }

    let ollama_resp: OllamaResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    Ok(ollama_resp.response.trim().to_string())
}

/// Call OpenRouter's cloud chat-completions API.
async fn call_openrouter(model: String, api_key: String, call: &AiCall, json_format: bool) -> Result<String, String> {
    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: call.system_prompt.clone(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: call.user_prompt.clone(),
        },
    ];

    let body = OpenRouterRequest {
        model,
        messages,
        temperature: call.temperature,
        max_tokens: call.max_tokens,
        response_format: if json_format {
            Some(OpenRouterResponseFormat {
                format_type: "json_object".to_string(),
            })
        } else {
            None
        },
    };

    let resp = HTTP_CLIENT
        .post(OPENROUTER_URL)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenRouter connection failed: {}. Check your network or API key.", e))?;

    let status = resp.status();
    if !status.is_success() {
        let err_body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "OpenRouter returned HTTP {}: {}. Check your API key in Settings → AI.",
            status, err_body
        ));
    }

    let openrouter_resp: OpenRouterResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse OpenRouter response: {}", e))?;

    openrouter_resp
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content.trim().to_string())
        .ok_or_else(|| "OpenRouter returned no choices.".to_string())
}

/// Auto-select a local (non-cloud) chat-capable model from Ollama.
async fn pick_local_model() -> Result<String, String> {
    let resp = HTTP_CLIENT
        .get("http://localhost:11434/api/tags")
        .send()
        .await
        .map_err(|e| format!("Ollama connection failed: {}. Is Ollama running?", e))?;
    let tags: OllamaTagsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama model list: {}", e))?;

    // Preference order: small local models that load quickly and reliably.
    const PREFERRED: &[&str] = &[
        "gemma3:4b",
        "gemma3:1b-it-qat",
        "llama3.2:3b",
        "qwen3.5:2b",
        "ministral-3:3b",
        "qwen2.5-coder:3b",
    ];

    let local_models: Vec<String> = tags
        .models
        .into_iter()
        .filter(|m| m.remote_host.is_none())
        .filter(|m| m.capabilities.iter().any(|c| c == "completion"))
        .map(|m| m.name)
        .collect();

    for preferred in PREFERRED {
        if let Some(name) = local_models.iter().find(|n| n == &preferred) {
            return Ok(name.clone());
        }
    }

    if let Some(first) = local_models.first() {
        return Ok(first.clone());
    }

    Err("No local Ollama model found. Pull one with `ollama pull gemma3:4b`.".to_string())
}

/// Resolve the provider + model to use, then dispatch to cloud or local.
/// `provider` is one of 'auto' | 'openrouter' | 'ollama'. In 'auto' mode we
/// use the cloud when an API key is configured and reachable, otherwise local.
async fn complete_ai(
    provider: &str,
    api_key: &str,
    model: Option<String>,
    call: &AiCall,
) -> Result<String, String> {
    let want_cloud = match provider {
        "openrouter" => true,
        "ollama" => false,
        _ => !api_key.trim().is_empty(),
    };

    if want_cloud {
        let key = api_key.trim();
        if key.is_empty() {
            return Err("OpenRouter is selected but no API key is set. Add it in Settings → AI.".to_string());
        }
        let cloud_model = match model.as_deref() {
            Some(m) if !m.trim().is_empty() => m.trim().to_string(),
            _ => "openai/gpt-4o-mini".to_string(),
        };
        match call_openrouter(cloud_model, key.to_string(), call, call.json).await {
            Ok(text) => return Ok(text),
            Err(e) if provider == "auto" => {
                // Cloud unreachable → fall back to local Ollama.
                let local_model = pick_local_model().await?;
                return call_ollama(local_model, call, call.json).await;
            }
            Err(e) => return Err(e),
        }
    }

    let local_model = match model.as_deref() {
        Some(m) if !m.trim().is_empty() && !m.starts_with("openai/") && !m.contains('/') => m.trim().to_string(),
        _ => pick_local_model().await?,
    };
    call_ollama(local_model, call, call.json).await
}

/// Run AI-powered habit analysis through the configured provider
/// (OpenRouter cloud, or local Ollama, or 'auto' = cloud with Ollama fallback).
/// Sends a structured prompt about the user's habits and returns insights.
/// Respects privacy: only statistical summaries are sent, never raw data.
/// The model is asked to reply as strict JSON so the UI can render it as
/// structured cards (priorities / trends / risks / next step).
#[tauri::command]
async fn analyze_habits(
    summary_json: String,
    model: Option<String>,
    provider: Option<String>,
    api_key: Option<String>,
) -> Result<String, String> {
    // Build a structured but privacy-respecting prompt.
    // The report (summary_json) covers ALL tracked domains: habits, check-ins,
    // every note, moods, skills, capacities, experiments, urges, chaos, mantras.
    let system_prompt = "You are a kind, deeply insightful life coach and habit coach. The data below is the user's entire LifeTrack database (habits, all notes, moods, skills, capacities, experiments, urges, chaos pressure, mantras).\n\
         Your job is to help the user go further in life.\n\n\
         Analyze deeply and give 4-6 concrete, prioritized recommendations. Consider:\n\
         - Habit patterns: completion rates, streaks, gaps, and which habits are thriving or at risk.\n\
         - Cross-correlations: mood ↔ habits, capacity trends, chaos pressure in each life dimension.\n\
         - ALL notes the user wrote: extract recurring triggers, emotional states, obstacles, wins, and root causes.\n\
         - Urge-surfing data: which urges they resist or give in to, and what counter-measures could help.\n\
         - Experiments: whether hypotheses are being validated, and what to test next.\n\
         - Skills & capacities: where they're progressing and where to invest next.\n\
         - Their own mantras as signals of what they value.\n\n\
         Respond ONLY with strict JSON (no markdown, no code fences), with exactly this schema:\n\
         {{\n  \
           \"summary\": \"1-2 sentence warm overview of the user's state\",\n  \
           \"top_priorities\": [{{\"title\": \"short label\", \"why\": \"the evidence from their data\", \"action\": \"ONE concrete next action\"}}],\n  \
           \"trends\": [{{\"title\": \"short label\", \"detail\": \"what is working and should be kept or doubled down\"}}],\n  \
           \"risks\": [{{\"title\": \"short label\", \"detail\": \"what is sliding toward chaos\", \"action\": \"how to course-correct\"}}],\n  \
           \"next_step\": \"one small, specific action to take today\"\n\
         }}\n\
         Rules: 1-2 top_priorities, 1-3 trends, 1-3 risks. Be warm, direct, non-judgmental, specific.";

    let call = AiCall {
        system_prompt: system_prompt.to_string(),
        user_prompt: summary_json,
        temperature: 0.7,
        max_tokens: 1200,
        json: true,
    };

    let raw = complete_ai(
        provider.as_deref().unwrap_or("auto"),
        api_key.as_deref().unwrap_or(""),
        model,
        &call,
    )
    .await?;

    // Strip markdown code fences some models add even when asked not to.
    let stripped = raw
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string();
    if serde_json::from_str::<serde_json::Value>(&stripped).is_ok() {
        Ok(stripped)
    } else {
        Ok(raw)
    }
}

/// Conversational follow-up with the AI coach.
/// `summary_json` is the full data report; `last_analysis` is the most recent
/// structured analysis so the coach "remembers" what it already told the user.
/// Uses the configured provider (cloud / local / auto).
#[tauri::command]
async fn ask_coach(
    question: String,
    summary_json: String,
    last_analysis: String,
    model: Option<String>,
    provider: Option<String>,
    api_key: Option<String>,
) -> Result<String, String> {
    let system_prompt = format!(
        "You are the same kind, deeply insightful life coach from LifeTrack. You already analyzed the user's data and said:\n\
         <LAST_ANALYSIS>\n{}\n</LAST_ANALYSIS>\n\n\
         The user now asks a follow-up question. Answer it directly, using ONLY the context above and the data below.\n\
         Be warm, concrete and action-oriented. If the question asks for something not in the data, say so kindly.\n\
         Keep it under 200 words.",
        last_analysis
    );

    let user_prompt = format!(
        "USER QUESTION: {}\n\nDATA (on-device, anonymous):\n{}",
        question, summary_json
    );

    let call = AiCall {
        system_prompt,
        user_prompt,
        temperature: 0.6,
        max_tokens: 600,
        json: false,
    };

    complete_ai(
        provider.as_deref().unwrap_or("auto"),
        api_key.as_deref().unwrap_or(""),
        model,
        &call,
    )
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            auto_backup,
            export_file,
            import_file,
            find_latest_backup,
            analyze_habits,
            ask_coach
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
