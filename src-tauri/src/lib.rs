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
            _ => "deepseek/deepseek-v4-flash".to_string(),
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
         Rules: 1-2 top_priorities, 1-3 trends, 1-3 risks. Be warm, direct, non-judgmental, specific.\n\
         Anti-fabrication (STRICT):\n\
         - Only reference figures, percentages, dates or habits that literally appear in the report. Never invent a completion rate, a streak, a date, a mood count or a habit that is not written there.\n\
         - Prefer the computed sections (DATA COVERAGE, CORRELATIONS, TRENDS, URGES & MOOD ANALYSIS, LEVER VALIDATION & RELAPSE). Treat a number marked \"n.s.\" or \"not significant\" as a possible-but-unconfirmed signal, never as a fact.\n\
         - If a section says the data is insufficient (e.g. \"need ≥10 logged days\"), say so plainly and recommend exactly what to log, instead of guessing a trend or correlation.";

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

/// Journal: one of four AI personas reflects on the user's free-form writing.
/// Personas: 'coach' (action), 'sage' (perspective), 'psychologist' (emotion),
/// 'strategist' (planning). `summary_json` is optional context about the
/// user's tracked life; the persona is asked to reply in the user's language.
#[tauri::command]
async fn journal_analyze(
    content: String,
    personality: String,
    summary_json: String,
    model: Option<String>,
    provider: Option<String>,
    api_key: Option<String>,
) -> Result<String, String> {
    let (system_prompt, temperature) = match personality.as_str() {
        "sage" => (
            "You are a wise, calm sage. The user shared a private journal entry. Respond with timeless perspective and gentle detachment.\n\
             Reflect the deeper pattern beneath what they wrote, offer a reframe, and end with one quiet question to sit with.\n\
             Reply in the same language the user wrote in. Keep it under 220 words. Warm, unhurried, non-judgmental.",
            0.7,
        ),
        "psychologist" => (
            "You are a warm, non-judgmental psychologist (not a replacement for a real therapist). The user shared a private journal entry.\n\
             Name the emotions present, gently explore what might be underneath them, and normalize what they're feeling.\n\
             Do not diagnose. If you see signs of serious distress, encourage speaking to a professional.\n\
             Reply in the same language the user wrote in. Keep it under 220 words. Compassionate and precise.",
            0.7,
        ),
        "strategist" => (
            "You are a sharp strategic planner. The user shared a private journal entry.\n\
             Extract the underlying goals and obstacles, evaluate options, and give a concrete, prioritized plan.\n\
             Be direct and pragmatic: what to keep, what to cut, what to do next, in order.\n\
             Reply in the same language the user wrote in. Keep it under 220 words.",
            0.5,
        ),
        // Robert Greene persona: power/mastery perspective. Grounded in the
        // actual ideas of Greene's books (The 48 Laws of Power, Mastery,
        // The Daily Laws) — never invent quotes or laws. Cite by name only
        // when confident, otherwise speak in his general strategic register.
        "robert-greene" => (
            "You are Robert Greene, author of The 48 Laws of Power, Mastery, The Art of Seduction, and The Daily Laws.\n\
             You think in terms of deep strategy: long-term mastery, self-knowledge, human nature, and power dynamics.\n\
             The user shared a private journal entry. Respond with lucid, strategic insight drawn from Greene's actual ideas:\n\
             - the value of patience and the long game,\n\
             - building mastery through deliberate, sustained practice,\n\
             - knowing your own dark sides, laziness and tendencies (from 'The Laws of Human Nature'),\n\
             - emotional self-control and reading situations coldly.\n\
             Do NOT invent quotes, laws, or page references. If you reference a specific idea, name it only if you are certain it exists in his work (e.g. the 48 Laws, the path to mastery, the apprentice phase).\n\
             Be direct, unsentimental, and precise. Reply in the same language the user wrote in. Keep it under 220 words.",
            0.6,
        ),
        // Andrew Huberman persona: neuroscience-based protocols. Grounded in
        // evidence-based practices popularized by the Huberman Lab podcast
        // (NSDR, exposure to morning sunlight, exercise/physical movement,
        // sleep hygiene, dopamine, deliberate cold exposure). Never invent
        // studies or doses.
        "huberman" => (
            "You are Dr. Andrew Huberman, a neuroscientist at Stanford who shares practical, science-informed protocols on the Huberman Lab podcast.\n\
             The user shared a private journal entry. Respond by translating their experience into neuroscience-grounded, actionable protocols:\n\
             - identify which systems are involved (dopamine, cortisol, sleep-wake cycle, stress/autonomic nervous system),\n\
             - offer concrete, evidence-informed tools (morning sunlight exposure, NSDR/mental reset, deliberate cold, breathwork like physiological sigh, exercise timing, sleep hygiene, dopamine management),\n\
             - keep it practical: ONE clear protocol they can do today.\n\
             Do NOT invent research studies, specific dosages, or named papers. Phrase uncertainty honestly ('evidence suggests', 'protocols popularized on Huberman Lab').\n\
             Reply in the same language the user wrote in. Keep it under 220 words.",
            0.5,
        ),
        _ => (
            "You are a kind, deeply insightful life coach. The user shared a private journal entry.\n\
             Reflect back what matters most, name one strength you see, and give ONE concrete next action for today.\n\
             Be warm, direct, and action-oriented without being preachy.\n\
             Reply in the same language the user wrote in. Keep it under 220 words.",
            0.6,
        ),
    };

    let context = if summary_json.trim().is_empty() {
        String::new()
    } else {
        format!("\n\nOptional context about their tracked life (use it only if relevant):\n{}", summary_json)
    };

    let user_prompt = format!(
        "JOURNAL ENTRY (the user's own words):\n\"{}\"{}\n\nNow reflect on this entry.",
        content, context
    );

    let call = AiCall {
        system_prompt: system_prompt.to_string(),
        user_prompt,
        temperature,
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

/// Psychoanalysis assistant: an AI that spots negative thinking / self-sabotage
/// patterns in the user's data and helps "destroy" them through Socratic Q&A.
/// Uses the configured provider (cloud / local / auto). Grounded in established
/// psychology (Beck's cognitive distortions, psychoanalytic defenses).
#[tauri::command]
async fn psychoanalysis_ask(
    question: String,
    summary_json: String,
    model: Option<String>,
    provider: Option<String>,
    api_key: Option<String>,
    frame: Option<String>,
) -> Result<String, String> {
    let frame = frame.unwrap_or_default();
    let (frame_name, frame_guide) = psycho_frame(&frame);
    let system_prompt = format!(
        "You are a warm, rigorous psychoanalysis-informed guide (not a medical professional).\n\
         The user's LifeTrack data (habits, notes, moods, urges, experiments) is below. Your job is to help the user DESTROY negative patterns.\n\
         FRAME THE CONVERSATION IN THIS THEORETICAL FRAME ONLY — use its real vocabulary and method: {frame_name}.\n\
         {frame_guide}\n\
         In your answer:\n\
         - Name the specific mechanism/pattern at play, in the vocabulary of the chosen frame.\n\
         - Quote the user's OWN words as evidence (from the data below) so they see it concretely.\n\
         - Give ONE practical counter-technique faithful to that frame to weaken or dissolve it.\n\
         - Be compassionate but direct. Never diagnose, never prescribe, never invent a symptom. If there is serious distress, encourage a professional.\n\
         Anti-fabrication (STRICT): base everything on the data given. Never invent a note, date, percentage, urge, habit or mood. Quote only the user's own existing words. Mark any \"n.s.\" or insufficient section as tentative.\n\
         Reply in the same language the user wrote in. Keep it under 250 words."
    );

    let user_prompt = format!(
        "USER QUESTION: {}\n\nDATA (on-device, anonymous):\n{}",
        question, summary_json
    );

    let call = AiCall {
        system_prompt,
        user_prompt,
        temperature: 0.6,
        max_tokens: 800,
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

/// Returns (label, guide) for a chosen theoretical frame. `auto` balances the
/// data-present signals; unknown frames default to a balanced cognitive+analytic.
fn psycho_frame(frame: &str) -> (&'static str, &'static str) {
    match frame {
        "jungian" => (
            "Jungian analytical psychology",
            "Work with Jung's concepts: persona, shadow, anima/animus, complexes, individuation. Name the shadow being projected or the complex being triggered; suggest concrete integration (dialoguing with the shadow part, dream-image questions), never diagnose a mental illness.",
        ),
        "act" => (
            "Acceptance & Commitment Therapy (ACT)",
            "Use ACT's third-wave concepts: experiential avoidance, cognitive fusion, defusion, values, committed action. Frame the issue as avoidance/fusion, the ex with 'I notice I'm having the thought that…' and a tiny values-aligned action.",
        ),
        "lac" | "lacanian" => (
            "Lacanian psychoanalysis",
            "Honourably but rigorously use Lacan's mapping of the unconscious as language: the Symbolic/Imaginary/Real, the Name-of-the-Father, desire as the desire of the Other, the symptom-as-signifier, jouissance and the phallus as signifier. Help the user name the symptom as a signifier they can reroute — a careful, non-clinical reframe, not a diagnosis.",
        ),
        "schema" => (
            "Schema therapy (Jeffrey Young)",
            "Work with Young's early maladaptive schemas: abandonment/instability, failure, defectiveness/shame, unrelenting standards, emotional deprivation. Name the schema being triggered as an early core belief, then propose a healthy-adult coping alternative and a concrete re-parenting/mode rework — never diagnose a mental illness.",
        ),
        "attachment" => (
            "Attachment theory (Bowlby, Ainsworth)",
            "Work with attachment styles and the working model of relationships: protest behaviors, hypervigilance, deactivating strategies, the secure / anxious / avoidant styles. Reflect that the fears about closeness are an older survival model, then propose a concrete 'secure repair' (naming the need, direct request, safe vulnerability).",
        ),
        "ta" | "transactional" => (
            "Transactional analysis (Eric Berne)",
            "Use Berne's model: ego states (Parent / Adult / Child), the dramatic triangle (rescuer / victim / persecutor), strokes, script and the games ('Yes, but…'). Help the user locate the ego state and script driving the behavior, then move them to an Adult state with a concrete re-decision, never prescribe or diagnose.",
        ),
        _ => (
            "cognitive (Beck/Burns, CBT) + evidence-based defenses",
            "Use Aaron Beck's cognitive distortions (catastrophizing, all-or-nothing, overgeneralization, personalization, mental filter, mind-reading, should-statements), David Burns' Feeling Good techniques, classical defense mechanisms (avoidance, rationalization, projection, denial, intellectualization), and impostor syndrome (Clance & Imes).",
        ),
    }
}

/// AI summary of the user's achievements (notes tagged with a category).
/// Builds a warm narrative that celebrates progress. Uses the configured
/// provider (cloud / local / auto).
///
/// When `before_after_json` is provided, it contains a structured comparison of
/// two equal-length periods (see DeepCompare in src/summary.ts) and the model
/// produces a before/after psychological narrative instead.
#[tauri::command]
async fn summarize_achievements(
    summary_json: String,
    model: Option<String>,
    provider: Option<String>,
    api_key: Option<String>,
    before_after_json: Option<String>,
) -> Result<String, String> {
    if let Some(ba) = before_after_json.filter(|s| !s.trim().is_empty()) {
        let system_prompt = "You are a warm, observant life coach reading two consecutive periods of a person's life-tracking data.\n\
             The input lists metrics (XP, life-score, check-ins, goals met, wins/achievements, challenges, % of urges surfed, active days) for a \"before\" period and an \"after\" period of equal length, plus the direction of change for each.\n\
             Write a short, heartfelt before/after narrative (90-160 words) that:\n\
             - Names which areas measurably improved (concrete numbers) and what they suggest about this person.\n\
             - Acknowledges any area that slipped without making the person feel bad, as part of the ebb and flow of self-work.\n\
             - Ends with one encouraging sentence about the momentum they are building.\n\
             Do NOT invent numbers that are not in the data. Do NOT use markdown headers; plain paragraphs only.";

        let call = AiCall {
            system_prompt: system_prompt.to_string(),
            user_prompt: ba,
            temperature: 0.7,
            max_tokens: 500,
            json: false,
        };

        return complete_ai(
            provider.as_deref().unwrap_or("auto"),
            api_key.as_deref().unwrap_or(""),
            model,
            &call,
        )
        .await;
    }

    let system_prompt = "You are a warm, celebratory life coach reading a person's LifeTrack achievements (notes tagged by category).\n\
         The data below lists their achievements grouped by category (Physical, Financial, Social, Structural, Spiritual, Emotional, Energy, Psychological).\n\
         Write a short, heartfelt narrative summary (100-180 words) in the same language as the achievement texts:\n\
         - Celebrate the areas where they have the most wins.\n\
         - Name 2-3 concrete achievements and what they suggest about this person.\n\
         - End with one encouraging sentence about the momentum they have built.\n\
         Do NOT invent achievements that are not in the data. Do NOT use markdown headers; plain paragraphs only.";

    let call = AiCall {
        system_prompt: system_prompt.to_string(),
        user_prompt: summary_json,
        temperature: 0.7,
        max_tokens: 500,
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

/// Fetch a remote URL (RSS/Atom feeds, articles…) server-side so the webview
/// never faces CORS. Used by the permanent auto-ingest loop.
#[tauri::command]
async fn fetch_url(url: String) -> Result<String, String> {
    const FETCH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let resp = client
        .get(&url)
        .header("User-Agent", "LifeTrack/0.6 (automated knowledge harvester)")
        .header("Accept", "application/rss+xml, application/atom+xml, application/xml, text/xml, */*")
        .send()
        .await
        .map_err(|e| format!("Fetch failed for {url}: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {status} for {url}"));
    }

    resp.text().await.map_err(|e| format!("Read failed for {url}: {e}"))
}

/// AI-assisted extraction: turns a raw source into structured protocols via the
/// configured provider (DeepSeek V4 Flash by default). Strict JSON, science-honest.
#[tauri::command]
async fn extract_protocols_ai(
    raw: String,
    model: Option<String>,
    provider: Option<String>,
    api_key: Option<String>,
) -> Result<String, String> {
    let system_prompt = "You are a meticulous, science-honest behavior & biohacking researcher. \
        Extract actionable protocols from the input text. Reply ONLY valid JSON matching exactly this schema: \
        {\"summary\":\"...\",\"top_priorities\":[{\"title\":\"...\",\"why\":\"evidence note: named study / expert or explicit hedge\",\"detail\":\"the claim\",\"action\":\"exact protocol\"}]}. \
        Be honest: clearly distinguish established/peer-reviewed evidence from anecdote or opinion. Never invent sources or references.";
    let user_prompt = format!("Input text to mine:\n\n{raw}");
    let call = AiCall {
        system_prompt: system_prompt.to_string(),
        user_prompt,
        temperature: 0.3,
        max_tokens: 900,
        json: true,
    };
    complete_ai(
        provider.as_deref().unwrap_or("auto"),
        api_key.as_deref().unwrap_or(""),
        model,
        &call,
    )
    .await
}

/// Add/remove LifeTrack from Windows "run at logon" so the permanent ingestion
/// loop starts automatically with no manual step. Per-user (HKCU), no admin.
#[tauri::command]
fn set_autostart(enabled: bool) -> Result<String, String> {
    let run_key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

    if !enabled {
        let _ = std::process::Command::new("reg")
            .args(["delete", run_key, "/v", "LifeTrack", "/f"])
            .output();
        return Ok("autostart-disabled".to_string());
    }

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let command = format!("\"{}\"", exe.to_string_lossy());

    let out = std::process::Command::new("reg")
        .args(["add", run_key, "/v", "LifeTrack", "/t", "REG_SZ", "/d", &command, "/f"])
        .output()
        .map_err(|e| format!("reg failed: {e}"))?;

    if !out.status.success() {
        return Err(format!(
            "reg exited non-zero: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok("autostart-enabled".to_string())
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
            ask_coach,
            journal_analyze,
            psychoanalysis_ask,
            summarize_achievements,
            fetch_url,
            extract_protocols_ai,
            set_autostart
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
