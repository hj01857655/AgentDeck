mod channels;

use channels::{Channel, ChannelPool, ChannelProtocol};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tauri_plugin_store::StoreExt;
use toml_edit::{value, DocumentMut};

const STORE_PATH: &str = "channels.json";
const SETTINGS_STORE_PATH: &str = "console-settings.json";
const CODEX_RUNTIME_PROVIDER_ID: &str = "ai_gateway_endpoint";
const CLAUDE_SETTINGS_FILE: &str = "settings.json";
const CLAUDE_MANAGED_ENV_KEYS_FILE: &str = "ai_gateway_managed_env_keys.json";

pub struct AppState {
    pub pool: Arc<ChannelPool>,
}

#[derive(Debug, Serialize)]
pub struct ExtensionEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
}

#[derive(Debug, Serialize)]
pub struct ExtensionLocation {
    pub target: String,
    pub label: String,
    pub path: String,
    pub exists: bool,
    pub is_file: bool,
    pub entries: Vec<ExtensionEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolTargetApps {
    pub claude: bool,
    pub codex: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedMcpServer {
    pub id: String,
    pub name: String,
    pub description: String,
    pub server: Value,
    pub apps: ToolTargetApps,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedSkill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub directory: String,
    pub path: String,
    pub source: String,
    pub apps: ToolTargetApps,
    pub managed: bool,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillToggleResult {
    pub skill: ManagedSkill,
    pub files: Vec<String>,
    pub backups: Vec<String>,
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

fn sanitize_id(raw: &str) -> String {
    raw.trim()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' { ch } else { '_' })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

fn value_as_object_mut(value: &mut Value) -> Result<&mut serde_json::Map<String, Value>, String> {
    if !value.is_object() {
        *value = serde_json::json!({});
    }
    value.as_object_mut().ok_or_else(|| "JSON root is not an object".to_string())
}

fn merge_mcp_server(map: &mut std::collections::BTreeMap<String, ManagedMcpServer>, server: ManagedMcpServer) {
    map.entry(server.id.clone())
        .and_modify(|existing| {
            existing.apps.claude |= server.apps.claude;
            existing.apps.codex |= server.apps.codex;
            if existing.server.is_null() || existing.server == serde_json::json!({}) {
                existing.server = server.server.clone();
            }
            if existing.description.trim().is_empty() {
                existing.description = server.description.clone();
            }
        })
        .or_insert(server);
}

fn resolve_agents_home() -> Result<PathBuf, String> {
    if let Some(raw) = std::env::var_os("AGENTS_HOME") {
        let value = raw.to_string_lossy().trim().trim_matches('"').to_string();
        if !value.is_empty() {
            return Ok(PathBuf::from(value));
        }
    }

    Ok(user_home_dir()?.join(".agents"))
}

fn extension_locations_for_kind(kind: &str) -> Result<Vec<(String, String, PathBuf)>, String> {
    let codex_home = resolve_codex_home()?;
    let agents_home = resolve_agents_home()?;
    let claude_home = resolve_claude_home()?;
    let home_dir = user_home_dir()?;
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    match kind {
        "skills" => Ok(vec![
            (
                "codex".into(),
                "Codex 用户 Skills（主目录）".into(),
                agents_home.join("skills"),
            ),
            (
                "codex-legacy".into(),
                "Codex 兼容旧 Skills".into(),
                codex_home.join("skills"),
            ),
            (
                "codex-system".into(),
                "Codex 系统 Skills 缓存".into(),
                codex_home.join("skills").join(".system"),
            ),
            (
                "codex-project".into(),
                "Codex 项目 Skills".into(),
                cwd.join(".agents").join("skills"),
            ),
            (
                "claude".into(),
                "Claude 用户 Skills".into(),
                claude_home.join("skills"),
            ),
            (
                "claude-project".into(),
                "Claude 项目 Skills".into(),
                cwd.join(".claude").join("skills"),
            ),
            (
                "claude-commands".into(),
                "Claude 旧 Commands（兼容）".into(),
                claude_home.join("commands"),
            ),
            (
                "claude-project-commands".into(),
                "Claude 项目旧 Commands（兼容）".into(),
                cwd.join(".claude").join("commands"),
            ),
        ]),
        "mcp" => Ok(vec![
            ("codex".into(), "Codex MCP 配置".into(), codex_home.join("config.toml")),
            (
                "claude-user".into(),
                "Claude 用户 / 本地 MCP 状态".into(),
                home_dir.join(".claude.json"),
            ),
            (
                "claude-project".into(),
                "Claude 项目 MCP 配置".into(),
                cwd.join(".mcp.json"),
            ),
            (
                "claude-settings".into(),
                "Claude 用户 Settings".into(),
                claude_home.join("settings.json"),
            ),
        ]),
        "plugin" => Ok(vec![
            ("codex".into(), "Codex Plugins".into(), codex_home.join("plugins")),
            (
                "codex-cache".into(),
                "Codex Plugin 缓存".into(),
                codex_home.join("plugins").join("cache"),
            ),
            (
                "claude-user".into(),
                "Claude 用户 Plugin Settings".into(),
                claude_home.join("settings.json"),
            ),
            (
                "claude-project".into(),
                "Claude 项目 Plugin Settings".into(),
                cwd.join(".claude").join("settings.json"),
            ),
            (
                "claude-local".into(),
                "Claude 本地 Plugin Settings".into(),
                cwd.join(".claude").join("settings.local.json"),
            ),
        ]),
        _ => Err(format!("Unsupported extension kind '{}'", kind)),
    }
}

fn read_extension_entries(path: &Path) -> Vec<ExtensionEntry> {
    if path.is_file() {
        return vec![ExtensionEntry {
            name: path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("config")
                .to_string(),
            path: path.display().to_string(),
            kind: "file".into(),
        }];
    }

    let Ok(entries) = fs::read_dir(path) else {
        return Vec::new();
    };

    let mut result = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                return None;
            }
            Some(ExtensionEntry {
                name,
                path: entry.path().display().to_string(),
                kind: if file_type.is_dir() {
                    "dir".into()
                } else if file_type.is_file() {
                    "file".into()
                } else {
                    "other".into()
                },
            })
        })
        .collect::<Vec<_>>();

    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    result
}

#[tauri::command]
fn list_extension_locations(kind: String) -> Result<Vec<ExtensionLocation>, String> {
    extension_locations_for_kind(&kind)?
        .into_iter()
        .map(|(target, label, path)| {
            let exists = path.exists();
            let is_file = path.is_file();
            let entries = if exists {
                read_extension_entries(&path)
            } else {
                Vec::new()
            };
            Ok(ExtensionLocation {
                target,
                label,
                path: path.display().to_string(),
                exists,
                is_file,
                entries,
            })
        })
        .collect()
}


// -------- MCP / Skills real management --------

fn claude_state_path() -> Result<PathBuf, String> {
    Ok(user_home_dir()?.join(".claude.json"))
}

fn codex_config_path() -> Result<PathBuf, String> {
    Ok(resolve_codex_home()?.join("config.toml"))
}

fn read_claude_mcp_map() -> Result<serde_json::Map<String, Value>, String> {
    let path = claude_state_path()?;
    let value = read_json_object(&path)?;
    Ok(value
        .get("mcpServers")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default())
}

fn write_claude_mcp_map(map: &serde_json::Map<String, Value>) -> Result<Option<PathBuf>, String> {
    let path = claude_state_path()?;
    let mut root = read_json_object(&path)?;
    let obj = value_as_object_mut(&mut root)?;
    if map.is_empty() {
        obj.remove("mcpServers");
    } else {
        obj.insert("mcpServers".into(), Value::Object(map.clone()));
    }
    let content = serde_json::to_string_pretty(&root).map_err(|e| format!("Serialize {}: {}", path.display(), e))?;
    write_string_with_backup(&path, &format!("{}\n", content))
}

fn read_codex_doc() -> Result<DocumentMut, String> {
    let path = codex_config_path()?;
    let text = fs::read_to_string(&path).unwrap_or_default();
    if text.trim().is_empty() {
        Ok(DocumentMut::new())
    } else {
        text.parse::<DocumentMut>().map_err(|e| format!("Parse {}: {}", path.display(), e))
    }
}

fn json_value_to_toml_item(value: &Value) -> Option<toml_edit::Item> {
    match value {
        Value::String(s) => Some(toml_edit::value(s.as_str())),
        Value::Bool(b) => Some(toml_edit::value(*b)),
        Value::Number(n) if n.is_i64() => n.as_i64().map(toml_edit::value),
        Value::Number(n) if n.is_f64() => n.as_f64().map(toml_edit::value),
        Value::Array(arr) => {
            let mut out = toml_edit::Array::default();
            for item in arr {
                if let Some(s) = item.as_str() {
                    out.push(s);
                } else if let Some(i) = item.as_i64() {
                    out.push(i);
                } else if let Some(b) = item.as_bool() {
                    out.push(b);
                }
            }
            Some(toml_edit::Item::Value(toml_edit::Value::Array(out)))
        }
        Value::Object(obj) => {
            let mut tbl = toml_edit::InlineTable::new();
            for (k, v) in obj {
                if let Some(s) = v.as_str() {
                    tbl.insert(k, s.into());
                }
            }
            Some(toml_edit::Item::Value(toml_edit::Value::InlineTable(tbl)))
        }
        _ => None,
    }
}

fn mcp_json_to_toml_table(spec: &Value) -> toml_edit::Table {
    let mut table = toml_edit::Table::new();
    if let Some(obj) = spec.as_object() {
        for (key, val) in obj {
            let target_key = if key == "headers" { "http_headers" } else { key };
            if let Some(item) = json_value_to_toml_item(val) {
                table[target_key] = item;
            }
        }
    }
    if !table.contains_key("type") {
        table["type"] = value("stdio");
    }
    table
}

fn codex_toml_table_to_mcp_json(table: &toml_edit::Table) -> Value {
    let mut obj = serde_json::Map::new();
    for (key, item) in table.iter() {
        let target_key = if key == "http_headers" { "headers" } else { key };
        let value = match item.as_value() {
            Some(v) if v.is_str() => v.as_str().map(|s| Value::String(s.to_string())),
            Some(v) if v.is_bool() => v.as_bool().map(Value::Bool),
            Some(v) if v.is_integer() => v.as_integer().map(|i| serde_json::json!(i)),
            Some(v) if v.is_float() => v.as_float().map(|f| serde_json::json!(f)),
            Some(v) if v.is_array() => v.as_array().map(|arr| {
                Value::Array(arr.iter().filter_map(|i| i.as_str().map(|s| Value::String(s.to_string()))).collect())
            }),
            Some(v) if v.is_inline_table() => v.as_inline_table().map(|t| {
                let mut m = serde_json::Map::new();
                for (k, v) in t.iter() {
                    if let Some(s) = v.as_str() {
                        m.insert(k.to_string(), Value::String(s.to_string()));
                    }
                }
                Value::Object(m)
            }),
            _ => None,
        };
        if let Some(value) = value {
            obj.insert(target_key.to_string(), value);
        }
    }
    Value::Object(obj)
}

fn read_codex_mcp_map() -> Result<serde_json::Map<String, Value>, String> {
    let doc = read_codex_doc()?;
    let mut out = serde_json::Map::new();
    if let Some(table) = doc.get("mcp_servers").and_then(|i| i.as_table()) {
        for (id, item) in table.iter() {
            if let Some(server) = item.as_table() {
                out.insert(id.to_string(), codex_toml_table_to_mcp_json(server));
            }
        }
    }
    Ok(out)
}

fn write_codex_mcp_map(map: &serde_json::Map<String, Value>) -> Result<Option<PathBuf>, String> {
    let path = codex_config_path()?;
    let mut doc = read_codex_doc()?;
    if let Some(mcp) = doc.get_mut("mcp").and_then(|i| i.as_table_mut()) {
        mcp.remove("servers");
    }
    if map.is_empty() {
        doc.as_table_mut().remove("mcp_servers");
    } else {
        let mut servers = toml_edit::Table::new();
        let mut ids = map.keys().cloned().collect::<Vec<_>>();
        ids.sort();
        for id in ids {
            if let Some(spec) = map.get(&id) {
                servers[&id] = toml_edit::Item::Table(mcp_json_to_toml_table(spec));
            }
        }
        doc["mcp_servers"] = toml_edit::Item::Table(servers);
    }
    write_string_with_backup(&path, &doc.to_string())
}

fn validate_mcp_spec(spec: &Value) -> Result<(), String> {
    let typ = spec.get("type").and_then(|v| v.as_str()).unwrap_or("stdio");
    match typ {
        "stdio" => {
            if spec.get("command").and_then(|v| v.as_str()).unwrap_or("").trim().is_empty() {
                return Err("stdio MCP 必须填写 command".into());
            }
        }
        "http" | "sse" => {
            if spec.get("url").and_then(|v| v.as_str()).unwrap_or("").trim().is_empty() {
                return Err("HTTP/SSE MCP 必须填写 url".into());
            }
        }
        _ => return Err(format!("不支持的 MCP 类型: {}", typ)),
    }
    Ok(())
}

#[tauri::command]
fn list_mcp_servers() -> Result<Vec<ManagedMcpServer>, String> {
    let mut merged = std::collections::BTreeMap::new();
    for (id, spec) in read_claude_mcp_map()? {
        merge_mcp_server(&mut merged, ManagedMcpServer { id: id.clone(), name: id, description: "来自 Claude 配置".into(), server: spec, apps: ToolTargetApps { claude: true, codex: false }, updated_at: now_millis() });
    }
    for (id, spec) in read_codex_mcp_map()? {
        merge_mcp_server(&mut merged, ManagedMcpServer { id: id.clone(), name: id, description: "来自 Codex 配置".into(), server: spec, apps: ToolTargetApps { claude: false, codex: true }, updated_at: now_millis() });
    }
    Ok(merged.into_values().collect())
}

#[tauri::command]
fn upsert_mcp_server(server: ManagedMcpServer) -> Result<Vec<String>, String> {
    let id = sanitize_id(&server.id);
    if id.is_empty() {
        return Err("MCP 服务 ID 必填".into());
    }
    validate_mcp_spec(&server.server)?;
    let mut files = Vec::new();
    let mut claude = read_claude_mcp_map()?;
    if server.apps.claude { claude.insert(id.clone(), server.server.clone()); } else { claude.remove(&id); }
    let p = write_claude_mcp_map(&claude)?; files.push(claude_state_path()?.display().to_string()); if let Some(b) = p { files.push(b.display().to_string()); }
    let mut codex = read_codex_mcp_map()?;
    if server.apps.codex { codex.insert(id.clone(), server.server.clone()); } else { codex.remove(&id); }
    let p = write_codex_mcp_map(&codex)?; files.push(codex_config_path()?.display().to_string()); if let Some(b) = p { files.push(b.display().to_string()); }
    Ok(files)
}

#[tauri::command]
fn delete_mcp_server(id: String) -> Result<Vec<String>, String> {
    let id = sanitize_id(&id);
    let mut files = Vec::new();
    let mut claude = read_claude_mcp_map()?; claude.remove(&id);
    if let Some(b) = write_claude_mcp_map(&claude)? { files.push(b.display().to_string()); }
    files.push(claude_state_path()?.display().to_string());
    let mut codex = read_codex_mcp_map()?; codex.remove(&id);
    if let Some(b) = write_codex_mcp_map(&codex)? { files.push(b.display().to_string()); }
    files.push(codex_config_path()?.display().to_string());
    Ok(files)
}

#[tauri::command]
fn toggle_mcp_app(id: String, app: String, enabled: bool, server: ManagedMcpServer) -> Result<Vec<String>, String> {
    let mut next = server;
    next.id = id;
    match app.as_str() {
        "claude" => next.apps.claude = enabled,
        "codex" => next.apps.codex = enabled,
        _ => return Err(format!("不支持的目标: {}", app)),
    }
    upsert_mcp_server(next)
}

fn skill_dir_for_app(app: &str) -> Result<PathBuf, String> {
    match app {
        "claude" => Ok(resolve_claude_home()?.join("skills")),
        "codex" => Ok(resolve_agents_home()?.join("skills")),
        "codex-legacy" => Ok(resolve_codex_home()?.join("skills")),
        _ => Err(format!("Unsupported skill target {}", app)),
    }
}

fn parse_skill_md(path: &Path, fallback: &str) -> (String, String) {
    let text = fs::read_to_string(path).unwrap_or_default();
    let mut name = fallback.to_string();
    let mut description = String::new();
    for line in text.lines().take(40) {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("name:") {
            name = v.trim().trim_matches('"').to_string();
        } else if let Some(v) = line.strip_prefix("description:") {
            description = v.trim().trim_matches('"').to_string();
        }
    }
    (name, description)
}

fn merge_skill(map: &mut std::collections::BTreeMap<String, ManagedSkill>, skill: ManagedSkill) {
    map.entry(skill.directory.to_lowercase()).and_modify(|existing| {
        existing.apps.claude |= skill.apps.claude;
        existing.apps.codex |= skill.apps.codex;
        if existing.description.is_empty() { existing.description = skill.description.clone(); }
        if existing.path.is_empty() { existing.path = skill.path.clone(); }
    }).or_insert(skill);
}

fn scan_skill_source(dir: &Path, source: &str, apps: ToolTargetApps, out: &mut std::collections::BTreeMap<String, ManagedSkill>) {
    let Ok(entries) = fs::read_dir(dir) else { return; };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() { continue; }
        let directory = entry.file_name().to_string_lossy().to_string();
        if directory.starts_with('.') { continue; }
        let manifest = path.join("SKILL.md");
        if !manifest.is_file() { continue; }
        let (name, description) = parse_skill_md(&manifest, &directory);
        merge_skill(out, ManagedSkill { id: directory.clone(), name, description, directory: directory.clone(), path: path.display().to_string(), source: source.into(), apps: apps.clone(), managed: true, updated_at: now_millis() });
    }
}

#[tauri::command]
fn list_managed_skills() -> Result<Vec<ManagedSkill>, String> {
    let mut out = std::collections::BTreeMap::new();
    scan_skill_source(&skill_dir_for_app("codex")?, "Codex 用户主目录", ToolTargetApps { claude: false, codex: true }, &mut out);
    scan_skill_source(&skill_dir_for_app("codex-legacy")?, "Codex 兼容旧目录", ToolTargetApps { claude: false, codex: true }, &mut out);
    scan_skill_source(&skill_dir_for_app("claude")?, "Claude 用户目录", ToolTargetApps { claude: true, codex: false }, &mut out);
    Ok(out.into_values().collect())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.join("SKILL.md").is_file() {
        return Err(format!("Skill 源目录缺少 SKILL.md: {}", src.display()));
    }
    fs::create_dir_all(dst).map_err(|e| format!("Create {}: {}", dst.display(), e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("Read {}: {}", src.display(), e))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else if src_path.is_file() {
            fs::copy(&src_path, &dst_path).map_err(|e| format!("Copy {}: {}", src_path.display(), e))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn toggle_skill_app(skill: ManagedSkill, app: String, enabled: bool) -> Result<SkillToggleResult, String> {
    let target_dir = skill_dir_for_app(&app)?.join(&skill.directory);
    let mut files = Vec::new();
    let mut backups = Vec::new();
    if enabled {
        let source = PathBuf::from(&skill.path);
        if target_dir.exists() {
            let backup = target_dir.with_extension(format!("bak-ai-gateway-{}", now_millis()));
            fs::rename(&target_dir, &backup).map_err(|e| format!("Backup {}: {}", target_dir.display(), e))?;
            backups.push(backup.display().to_string());
        }
        copy_dir_recursive(&source, &target_dir)?;
        files.push(target_dir.display().to_string());
    } else if target_dir.exists() {
        let backup = target_dir.with_extension(format!("bak-ai-gateway-{}", now_millis()));
        fs::rename(&target_dir, &backup).map_err(|e| format!("Backup {}: {}", target_dir.display(), e))?;
        backups.push(backup.display().to_string());
    }
    let mut next = skill;
    match app.as_str() {
        "claude" => next.apps.claude = enabled,
        "codex" => next.apps.codex = enabled,
        _ => return Err(format!("不支持的目标: {}", app)),
    }
    next.updated_at = now_millis();
    Ok(SkillToggleResult { skill: next, files, backups })
}

// -------- Persistence helpers --------

fn save_channels(app: &tauri::AppHandle, pool: &ChannelPool) {
    let channels = pool.list();
    if let Ok(store) = app.store(STORE_PATH) {
        store.set("channels", serde_json::json!(channels));
        let _ = store.save();
    }
}

fn load_channels(app: &tauri::AppHandle, pool: &ChannelPool) {
    if let Ok(store) = app.store(STORE_PATH) {
        if let Some(val) = store.get("channels") {
            if let Ok(channels) = serde_json::from_value::<Vec<Channel>>(val.clone()) {
                for ch in channels {
                    pool.add(ch);
                }
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsoleSettings {
    pub active_provider: String,
    pub selected_channel_id: Option<String>,
    pub default_protocol: String,
}

impl Default for ConsoleSettings {
    fn default() -> Self {
        Self {
            active_provider: "all".into(),
            selected_channel_id: None,
            default_protocol: "openai-chat-completions".into(),
        }
    }
}

fn protocol_from_str(protocol: &str) -> Result<ChannelProtocol, String> {
    match protocol {
        "openai-chat-completions" => Ok(ChannelProtocol::OpenAIChatCompletions),
        "openai-responses" => Ok(ChannelProtocol::OpenAIResponses),
        "anthropic-messages" => Ok(ChannelProtocol::AnthropicMessages),
        "openai-compatible-chat-completions" => {
            Ok(ChannelProtocol::OpenAICompatibleChatCompletions)
        }
        _ => Err(format!("Unsupported channel protocol '{}'", protocol)),
    }
}

fn is_provider_scope(value: &str) -> bool {
    value == "all" || protocol_from_str(value).is_ok()
}

fn normalize_console_settings(mut settings: ConsoleSettings) -> ConsoleSettings {
    if !is_provider_scope(&settings.active_provider) {
        settings.active_provider = "all".into();
    }
    if protocol_from_str(&settings.default_protocol).is_err() {
        settings.default_protocol = "openai-chat-completions".into();
    }
    if settings
        .selected_channel_id
        .as_ref()
        .is_some_and(|id| id.trim().is_empty())
    {
        settings.selected_channel_id = None;
    }
    settings
}

fn normalized_base_url(channel: &Channel) -> String {
    channel.base_url.trim_end_matches('/').to_string()
}

fn model_list_url(channel: &Channel) -> String {
    format!("{}/v1/models", normalized_base_url(channel))
}

fn chat_url(channel: &Channel) -> String {
    match channel.protocol {
        ChannelProtocol::AnthropicMessages => {
            format!("{}/v1/messages", normalized_base_url(channel))
        }
        ChannelProtocol::OpenAIResponses => {
            format!("{}/v1/responses", normalized_base_url(channel))
        }
        ChannelProtocol::OpenAIChatCompletions
        | ChannelProtocol::OpenAICompatibleChatCompletions => {
            format!("{}/v1/chat/completions", normalized_base_url(channel))
        }
    }
}

fn auth_headers(channel: &Channel) -> Vec<(String, String)> {
    match channel.protocol {
        ChannelProtocol::AnthropicMessages => vec![
            ("x-api-key".to_string(), channel.api_key.clone()),
            ("anthropic-version".to_string(), "2023-06-01".to_string()),
        ],
        ChannelProtocol::OpenAIChatCompletions
        | ChannelProtocol::OpenAIResponses
        | ChannelProtocol::OpenAICompatibleChatCompletions => {
            vec![(
                "Authorization".to_string(),
                format!("Bearer {}", channel.api_key),
            )]
        }
    }
}

fn apply_auth_headers(
    mut builder: reqwest::RequestBuilder,
    channel: &Channel,
) -> reqwest::RequestBuilder {
    for (name, value) in auth_headers(channel) {
        builder = builder.header(name, value);
    }
    builder
}

fn chat_body(channel: &Channel, req: &ChatRequest, stream: bool) -> Value {
    match channel.protocol {
        ChannelProtocol::AnthropicMessages => serde_json::json!({
            "model": req.model,
            "messages": req.messages,
            "max_tokens": req.max_tokens.unwrap_or(1024),
            "temperature": req.temperature.unwrap_or(0.7),
            "stream": stream,
        }),
        ChannelProtocol::OpenAIResponses => serde_json::json!({
            "model": req.model,
            "input": req.messages,
            "max_output_tokens": req.max_tokens.unwrap_or(1024),
            "temperature": req.temperature.unwrap_or(0.7),
            "stream": stream,
        }),
        ChannelProtocol::OpenAIChatCompletions
        | ChannelProtocol::OpenAICompatibleChatCompletions => serde_json::json!({
            "model": req.model,
            "messages": req.messages,
            "max_tokens": req.max_tokens.unwrap_or(1024),
            "temperature": req.temperature.unwrap_or(0.7),
            "stream": stream,
        }),
    }
}

fn extract_openai_responses_text(body: &Value) -> String {
    if let Some(text) = body["output_text"].as_str() {
        return text.to_string();
    }

    body["output"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .flat_map(|item| item["content"].as_array().cloned().unwrap_or_default())
                .filter_map(|content| {
                    content["text"]
                        .as_str()
                        .or_else(|| content["summary"].as_str())
                        .map(String::from)
                })
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
}

fn normalize_chat_response(channel: &Channel, body: Value) -> Value {
    match channel.protocol {
        ChannelProtocol::AnthropicMessages => {
            let content = body["content"]
                .as_array()
                .map(|parts| {
                    parts
                        .iter()
                        .filter_map(|part| part["text"].as_str())
                        .collect::<Vec<_>>()
                        .join("")
                })
                .unwrap_or_default();

            if content.is_empty() {
                body
            } else {
                serde_json::json!({
                    "id": body.get("id").cloned().unwrap_or(Value::Null),
                    "model": body.get("model").cloned().unwrap_or(Value::Null),
                    "provider": "anthropic",
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": content,
                        }
                    }],
                    "raw": body,
                })
            }
        }
        ChannelProtocol::OpenAIResponses => {
            let content = extract_openai_responses_text(&body);

            if content.is_empty() {
                body
            } else {
                serde_json::json!({
                    "id": body.get("id").cloned().unwrap_or(Value::Null),
                    "model": body.get("model").cloned().unwrap_or(Value::Null),
                    "provider": "openai-responses",
                    "choices": [{
                        "message": {
                            "role": "assistant",
                            "content": content,
                        }
                    }],
                    "raw": body,
                })
            }
        }
        ChannelProtocol::OpenAIChatCompletions
        | ChannelProtocol::OpenAICompatibleChatCompletions => body,
    }
}

fn normalize_stream_delta(channel: &Channel, parsed: Value) -> Option<Value> {
    match channel.protocol {
        ChannelProtocol::AnthropicMessages => {
            let text = parsed["delta"]["text"].as_str()?;
            Some(serde_json::json!({
                "provider": "anthropic",
                "choices": [{
                    "delta": {
                        "content": text,
                    }
                }],
                "raw": parsed,
            }))
        }
        ChannelProtocol::OpenAIResponses => {
            let event_type = parsed["type"].as_str().unwrap_or_default();
            let text = match event_type {
                "response.output_text.delta" | "response.refusal.delta" => {
                    parsed["delta"].as_str()?
                }
                _ => return None,
            };

            Some(serde_json::json!({
                "provider": "openai-responses",
                "choices": [{
                    "delta": {
                        "content": text,
                    }
                }],
                "raw": parsed,
            }))
        }
        ChannelProtocol::OpenAIChatCompletions
        | ChannelProtocol::OpenAICompatibleChatCompletions => Some(parsed),
    }
}

fn should_fallback_status(status: u16) -> bool {
    status == 408 || status == 429 || status >= 500
}

fn parse_upstream_body(text: &str) -> Value {
    serde_json::from_str::<Value>(text).unwrap_or_else(|_| {
        serde_json::json!({
            "raw": text,
        })
    })
}

fn user_home_dir() -> Result<PathBuf, String> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| "Unable to resolve user home directory".to_string())
}

fn resolve_codex_home() -> Result<PathBuf, String> {
    if let Some(raw) = std::env::var_os("CODEX_HOME") {
        let value = raw.to_string_lossy().trim().trim_matches('"').to_string();
        if !value.is_empty() {
            return Ok(PathBuf::from(value));
        }
    }

    Ok(user_home_dir()?.join(".codex"))
}

fn resolve_claude_home() -> Result<PathBuf, String> {
    if let Some(raw) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        let value = raw.to_string_lossy().trim().trim_matches('"').to_string();
        if !value.is_empty() {
            return Ok(PathBuf::from(value));
        }
    }

    Ok(user_home_dir()?.join(".claude"))
}

fn backup_existing_file(path: &Path) -> Result<Option<PathBuf>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let backup = path.with_extension(format!(
        "{}bak-ai-gateway",
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| format!("{}.", ext))
            .unwrap_or_default()
    ));
    fs::copy(path, &backup).map_err(|e| format!("Failed to backup {}: {}", path.display(), e))?;
    Ok(Some(backup))
}

fn write_string_with_backup(path: &Path, content: &str) -> Result<Option<PathBuf>, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    }

    let backup = backup_existing_file(path)?;
    let tmp = path.with_extension(format!(
        "{}tmp-ai-gateway",
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| format!("{}.", ext))
            .unwrap_or_default()
    ));
    fs::write(&tmp, content).map_err(|e| format!("Failed to write {}: {}", tmp.display(), e))?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|e| format!("Failed to replace {}: {}", path.display(), e))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("Failed to move {}: {}", tmp.display(), e))?;
    Ok(backup)
}

fn codex_base_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        trimmed.to_string()
    } else {
        format!("{}/v1", trimmed)
    }
}

#[derive(Debug, Serialize)]
pub struct ToolSyncResult {
    pub target: String,
    pub files: Vec<String>,
    pub backups: Vec<String>,
}

fn apply_channel_to_codex(channel: &Channel) -> Result<ToolSyncResult, String> {
    if channel.protocol != ChannelProtocol::OpenAIResponses {
        return Err(
            "Codex uses the OpenAI Responses wire API. Select an OpenAI Responses endpoint."
                .to_string(),
        );
    }

    let codex_home = resolve_codex_home()?;
    let auth_path = codex_home.join("auth.json");
    let config_path = codex_home.join("config.toml");
    let mut backups = Vec::new();

    let auth = serde_json::json!({
        "auth_mode": "apikey",
        "OPENAI_API_KEY": channel.api_key,
    });
    let auth_content =
        serde_json::to_string_pretty(&auth).map_err(|e| format!("Serialize auth.json: {}", e))?;
    if let Some(path) = write_string_with_backup(&auth_path, &auth_content)? {
        backups.push(path.display().to_string());
    }

    let existing = fs::read_to_string(&config_path).unwrap_or_default();
    let mut doc = if existing.trim().is_empty() {
        DocumentMut::new()
    } else {
        existing
            .parse::<DocumentMut>()
            .map_err(|e| format!("Parse config.toml: {}", e))?
    };

    let _ = doc.remove("openai_base_url");
    doc["model_provider"] = value(CODEX_RUNTIME_PROVIDER_ID);
    if doc.get("model_providers").is_none() {
        doc["model_providers"] = toml_edit::table();
    }
    let providers = doc["model_providers"]
        .as_table_mut()
        .ok_or_else(|| "config.toml model_providers is not a table".to_string())?;
    providers[CODEX_RUNTIME_PROVIDER_ID] = toml_edit::table();
    let provider = providers[CODEX_RUNTIME_PROVIDER_ID]
        .as_table_mut()
        .ok_or_else(|| "config.toml target provider is not a table".to_string())?;
    provider["name"] = value(format!("AI Gateway - {}", channel.name));
    provider["base_url"] = value(codex_base_url(&channel.base_url));
    provider["wire_api"] = value("responses");
    provider["requires_openai_auth"] = value(true);
    provider["experimental_bearer_token"] = value(channel.api_key.clone());
    provider["supports_websockets"] = value(false);

    if let Some(path) = write_string_with_backup(&config_path, &doc.to_string())? {
        backups.push(path.display().to_string());
    }

    Ok(ToolSyncResult {
        target: "codex".into(),
        files: vec![
            auth_path.display().to_string(),
            config_path.display().to_string(),
        ],
        backups,
    })
}

fn read_json_object(path: &Path) -> Result<Value, String> {
    let content = match fs::read_to_string(path) {
        Ok(content) if !content.trim().is_empty() => content,
        _ => return Ok(serde_json::json!({})),
    };
    serde_json::from_str::<Value>(&content).map_err(|e| format!("Parse {}: {}", path.display(), e))
}

fn apply_channel_to_claude(channel: &Channel) -> Result<ToolSyncResult, String> {
    if channel.protocol != ChannelProtocol::AnthropicMessages {
        return Err("Claude Code expects an Anthropic Messages endpoint.".to_string());
    }

    let claude_home = resolve_claude_home()?;
    let settings_path = claude_home.join(CLAUDE_SETTINGS_FILE);
    let managed_keys_path = claude_home.join(CLAUDE_MANAGED_ENV_KEYS_FILE);
    let mut backups = Vec::new();

    let previous_keys = read_json_object(&managed_keys_path)?
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| value.as_str().map(String::from))
        .collect::<Vec<_>>();

    let mut settings = read_json_object(&settings_path)?;
    if !settings.is_object() {
        settings = serde_json::json!({});
    }
    let object = settings
        .as_object_mut()
        .ok_or_else(|| "settings.json root is not an object".to_string())?;
    let env = object
        .entry("env".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !env.is_object() {
        *env = serde_json::json!({});
    }
    let env_object = env
        .as_object_mut()
        .ok_or_else(|| "settings.json env is not an object".to_string())?;

    for key in previous_keys {
        env_object.remove(&key);
    }

    let managed_keys = vec![
        "ANTHROPIC_API_KEY".to_string(),
        "ANTHROPIC_BASE_URL".to_string(),
    ];
    env_object.insert(
        "ANTHROPIC_API_KEY".into(),
        Value::String(channel.api_key.clone()),
    );
    env_object.insert(
        "ANTHROPIC_BASE_URL".into(),
        Value::String(normalized_base_url(channel)),
    );

    let settings_content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Serialize settings.json: {}", e))?;
    if let Some(path) = write_string_with_backup(&settings_path, &settings_content)? {
        backups.push(path.display().to_string());
    }

    let keys_content = serde_json::to_string_pretty(&managed_keys)
        .map_err(|e| format!("Serialize managed env keys: {}", e))?;
    if let Some(path) = write_string_with_backup(&managed_keys_path, &keys_content)? {
        backups.push(path.display().to_string());
    }

    Ok(ToolSyncResult {
        target: "claude".into(),
        files: vec![
            settings_path.display().to_string(),
            managed_keys_path.display().to_string(),
        ],
        backups,
    })
}

// -------- Channel CRUD --------

#[tauri::command]
fn list_channels(state: State<'_, AppState>) -> Vec<Channel> {
    state.pool.list()
}

#[derive(Debug, Deserialize)]
pub struct AddChannelRequest {
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub models: Vec<String>,
    pub protocol: String,
    pub weight: u32,
}

#[tauri::command]
fn add_channel(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    req: AddChannelRequest,
) -> Result<String, String> {
    let protocol = protocol_from_str(req.protocol.as_str())?;
    let channel = Channel {
        id: String::new(),
        name: req.name,
        base_url: req.base_url,
        api_key: req.api_key,
        models: req.models,
        protocol,
        weight: req.weight,
        enabled: true,
        healthy: true,
    };
    let id = state.pool.add(channel);
    save_channels(&app, &state.pool);
    Ok(id)
}

#[tauri::command]
fn delete_channel(app: tauri::AppHandle, state: State<'_, AppState>, id: String) -> bool {
    let ok = state.pool.delete(&id);
    if ok {
        save_channels(&app, &state.pool);
    }
    ok
}

#[tauri::command]
fn update_channel(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    req: AddChannelRequest,
) -> Result<bool, String> {
    let protocol = protocol_from_str(req.protocol.as_str())?;
    let ok = state.pool.update(&id, |ch| {
        ch.name = req.name;
        ch.base_url = req.base_url;
        ch.api_key = req.api_key;
        ch.models = req.models;
        ch.protocol = protocol;
        ch.weight = req.weight;
    });
    if ok {
        save_channels(&app, &state.pool);
    }
    Ok(ok)
}

// -------- Console Settings --------

#[tauri::command]
fn get_console_settings(app: tauri::AppHandle) -> ConsoleSettings {
    if let Ok(store) = app.store(SETTINGS_STORE_PATH) {
        if let Some(val) = store.get("settings") {
            if let Ok(settings) = serde_json::from_value::<ConsoleSettings>(val.clone()) {
                return normalize_console_settings(settings);
            }
        }
    }

    ConsoleSettings::default()
}

#[tauri::command]
fn save_console_settings(app: tauri::AppHandle, settings: ConsoleSettings) -> Result<(), String> {
    let settings = normalize_console_settings(settings);
    let store = app.store(SETTINGS_STORE_PATH).map_err(|e| e.to_string())?;
    store.set("settings", serde_json::json!(settings));
    store.save().map_err(|e| e.to_string())
}

#[tauri::command]
fn apply_channel_to_tool(
    state: State<'_, AppState>,
    id: String,
    target: String,
) -> Result<ToolSyncResult, String> {
    let channel = state
        .pool
        .list()
        .into_iter()
        .find(|channel| channel.id == id)
        .ok_or_else(|| "未找到提供商配置".to_string())?;

    match target.as_str() {
        "codex" => apply_channel_to_codex(&channel),
        "claude" => apply_channel_to_claude(&channel),
        _ => Err(format!("Unsupported sync target '{}'", target)),
    }
}

// -------- Channel State --------
#[tauri::command]
fn set_channel_enabled(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> bool {
    let ok = state.pool.update(&id, |ch| {
        ch.enabled = enabled;
    });
    if ok {
        save_channels(&app, &state.pool);
    }
    ok
}
// -------- Test --------

#[derive(Debug, Deserialize)]
pub struct TestChannelRequest {
    pub base_url: String,
    pub api_key: String,
    pub protocol: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TestResult {
    pub status: u16,
    pub body: String,
    pub models: Vec<String>,
    pub elapsed_ms: u64,
}

#[derive(Debug, Deserialize)]
pub struct ApiProbeRequest {
    pub base_url: String,
    pub api_key: String,
    pub protocol: Option<String>,
    pub model: String,
}

#[derive(Debug, Serialize)]
pub struct ApiProbeResult {
    pub status: u16,
    pub body: String,
    pub model: String,
    pub elapsed_ms: u64,
}

async fn run_model_list_probe(channel: Channel) -> Result<TestResult, String> {
    let start = std::time::Instant::now();
    let client = reqwest::Client::new();

    match apply_auth_headers(client.get(model_list_url(&channel)), &channel)
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            let models: Vec<String> = serde_json::from_str::<Value>(&body)
                .ok()
                .and_then(|v| v["data"].as_array().cloned())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m["id"].as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            Ok(TestResult {
                status,
                body: body[..body.len().min(2000)].to_string(),
                models,
                elapsed_ms: start.elapsed().as_millis() as u64,
            })
        }
        Err(e) => Err(format!("Connection error: {}", e)),
    }
}

async fn run_api_probe(channel: Channel, model: String) -> Result<ApiProbeResult, String> {
    if model.trim().is_empty() {
        return Err("Model is required for API probe".into());
    }

    let start = std::time::Instant::now();
    let client = reqwest::Client::new();
    let req = ChatRequest {
        model: model.trim().to_string(),
        messages: vec![Message {
            role: "user".into(),
            content: "ping".into(),
        }],
        max_tokens: Some(8),
        temperature: Some(0.0),
        stream: Some(false),
        channel_id: None,
    };
    let body = chat_body(&channel, &req, false);

    match apply_auth_headers(
        client
            .post(chat_url(&channel))
            .header("Content-Type", "application/json"),
        &channel,
    )
    .json(&body)
    .send()
    .await
    {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            Ok(ApiProbeResult {
                status,
                body: body[..body.len().min(2000)].to_string(),
                model: req.model,
                elapsed_ms: start.elapsed().as_millis() as u64,
            })
        }
        Err(e) => Err(format!("API probe error: {}", e)),
    }
}

#[tauri::command]
async fn test_channel(req: TestChannelRequest) -> Result<TestResult, String> {
    let channel = Channel {
        id: String::new(),
        name: "test".into(),
        base_url: req.base_url,
        api_key: req.api_key,
        models: Vec::new(),
        protocol: match req.protocol.as_deref() {
            Some(protocol) => protocol_from_str(protocol)?,
            None => ChannelProtocol::OpenAIChatCompletions,
        },
        weight: 1,
        enabled: true,
        healthy: true,
    };

    run_model_list_probe(channel).await
}

#[tauri::command]
async fn api_probe_channel(req: ApiProbeRequest) -> Result<ApiProbeResult, String> {
    let channel = Channel {
        id: String::new(),
        name: "test".into(),
        base_url: req.base_url,
        api_key: req.api_key,
        models: vec![req.model.clone()],
        protocol: match req.protocol.as_deref() {
            Some(protocol) => protocol_from_str(protocol)?,
            None => ChannelProtocol::OpenAIChatCompletions,
        },
        weight: 1,
        enabled: true,
        healthy: true,
    };

    run_api_probe(channel, req.model).await
}

#[tauri::command]
async fn probe_channel(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<TestResult, String> {
    let channel = state
        .pool
        .list()
        .into_iter()
        .find(|channel| channel.id == id)
        .ok_or_else(|| "Channel not found".to_string())?;

    match run_model_list_probe(channel.clone()).await {
        Ok(result) => {
            let healthy = result.status < 400;
            let discovered_models = result.models.clone();
            state.pool.update(&id, |ch| {
                ch.healthy = healthy;
                if !discovered_models.is_empty() {
                    ch.models = discovered_models;
                }
            });
            save_channels(&app, &state.pool);
            Ok(result)
        }
        Err(err) => {
            state.pool.update(&id, |ch| {
                ch.healthy = false;
            });
            save_channels(&app, &state.pool);
            Err(err)
        }
    }
}

// -------- Chat Forward (Non-streaming) --------

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<Message>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    pub stream: Option<bool>,
    pub channel_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct ChatResponse {
    pub status: u16,
    pub channel_name: String,
    pub body: Value,
    pub elapsed_ms: u64,
}

#[tauri::command]
async fn chat_forward(
    state: State<'_, AppState>,
    req: ChatRequest,
) -> Result<ChatResponse, String> {
    let pinned_channel = req.channel_id.is_some();
    let channels = if let Some(ref cid) = req.channel_id {
        state
            .pool
            .list()
            .into_iter()
            .filter(|c| c.id == *cid)
            .collect::<Vec<_>>()
    } else {
        state.pool.select_for_model(&req.model)
    };

    if channels.is_empty() {
        return Err(format!("No available channel for model '{}'", req.model));
    }

    let start = std::time::Instant::now();
    let client = reqwest::Client::new();
    let mut last_error: Option<String> = None;

    for (index, channel) in channels.iter().enumerate() {
        let body = chat_body(channel, &req, false);
        let has_fallback = !pinned_channel && index + 1 < channels.len();

        match apply_auth_headers(
            client
                .post(chat_url(channel))
                .header("Content-Type", "application/json"),
            channel,
        )
        .json(&body)
        .send()
        .await
        {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let text = resp.text().await.unwrap_or_default();
                let resp_body = parse_upstream_body(&text);

                if has_fallback && should_fallback_status(status) {
                    last_error = Some(format!("{} returned HTTP {}", channel.name, status));
                    continue;
                }

                return Ok(ChatResponse {
                    status,
                    channel_name: channel.name.clone(),
                    body: normalize_chat_response(channel, resp_body),
                    elapsed_ms: start.elapsed().as_millis() as u64,
                });
            }
            Err(e) if has_fallback => {
                last_error = Some(format!("{} failed: {}", channel.name, e));
                continue;
            }
            Err(e) => {
                return Err(format!(
                    "Failed to reach upstream via {}: {}",
                    channel.name, e
                ));
            }
        }
    }

    Err(last_error.unwrap_or_else(|| format!("No available channel for model '{}'", req.model)))
}

// -------- Chat Stream (SSE) --------

#[derive(Debug, Serialize, Clone)]
pub struct StreamEvent {
    pub event_type: String,
    pub data: Value,
}

#[tauri::command]
async fn chat_stream(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    req: ChatRequest,
) -> Result<(), String> {
    let pinned_channel = req.channel_id.is_some();
    let channels = if let Some(ref cid) = req.channel_id {
        state
            .pool
            .list()
            .into_iter()
            .filter(|c| c.id == *cid)
            .collect::<Vec<_>>()
    } else {
        state.pool.select_for_model(&req.model)
    };

    if channels.is_empty() {
        return Err(format!("No available channel for model '{}'", req.model));
    }

    let client = reqwest::Client::new();
    let mut last_error: Option<String> = None;

    for (index, channel) in channels.iter().enumerate() {
        let body = chat_body(channel, &req, true);
        let has_fallback = !pinned_channel && index + 1 < channels.len();

        let resp = match apply_auth_headers(
            client
                .post(chat_url(channel))
                .header("Content-Type", "application/json"),
            channel,
        )
        .json(&body)
        .send()
        .await
        {
            Ok(resp) => resp,
            Err(e) if has_fallback => {
                last_error = Some(format!("{} failed: {}", channel.name, e));
                continue;
            }
            Err(e) => {
                return Err(format!(
                    "Failed to reach upstream via {}: {}",
                    channel.name, e
                ))
            }
        };

        if resp.status().as_u16() >= 400 {
            let status = resp.status().as_u16();
            let err_body = resp.text().await.unwrap_or_default();

            if has_fallback && should_fallback_status(status) {
                last_error = Some(format!("{} returned HTTP {}", channel.name, status));
                continue;
            }

            let evt = StreamEvent {
                event_type: "error".into(),
                data: serde_json::json!({
                    "status": status,
                    "body": err_body,
                    "channel": channel.name,
                }),
            };
            let _ = app.emit("chat-stream-event", &evt);
            return Ok(());
        }

        use futures::StreamExt;
        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();
        let mut done_emitted = false;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
            let text = String::from_utf8_lossy(&chunk);
            buffer.push_str(&text);

            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].trim().to_string();
                buffer = buffer[pos + 1..].to_string();

                if line.is_empty() || line.starts_with(':') {
                    continue;
                }

                if let Some(data) = line.strip_prefix("data: ") {
                    if data == "[DONE]" {
                        let evt = StreamEvent {
                            event_type: "done".into(),
                            data: serde_json::json!({"channel": channel.name}),
                        };
                        let _ = app.emit("chat-stream-event", &evt);
                        done_emitted = true;
                    } else if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                        if let Some(data) = normalize_stream_delta(channel, parsed) {
                            let evt = StreamEvent {
                                event_type: "delta".into(),
                                data,
                            };
                            let _ = app.emit("chat-stream-event", &evt);
                        }
                    }
                }
            }
        }

        // Flush remaining
        let remaining = buffer.trim().to_string();
        if !remaining.is_empty() {
            if remaining == "data: [DONE]" {
                let evt = StreamEvent {
                    event_type: "done".into(),
                    data: serde_json::json!({"channel": channel.name}),
                };
                let _ = app.emit("chat-stream-event", &evt);
            }
        } else if !done_emitted {
            let evt = StreamEvent {
                event_type: "done".into(),
                data: serde_json::json!({"channel": channel.name}),
            };
            let _ = app.emit("chat-stream-event", &evt);
        }

        return Ok(());
    }

    Err(last_error.unwrap_or_else(|| format!("No available channel for model '{}'", req.model)))
}

// -------- App Entry --------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState {
        pool: Arc::new(ChannelPool::new()),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            list_channels,
            add_channel,
            delete_channel,
            update_channel,
            get_console_settings,
            save_console_settings,
            apply_channel_to_tool,
            list_extension_locations,
            list_mcp_servers,
            upsert_mcp_server,
            delete_mcp_server,
            toggle_mcp_app,
            list_managed_skills,
            toggle_skill_app,
            set_channel_enabled,
            test_channel,
            api_probe_channel,
            probe_channel,
            chat_forward,
            chat_stream,
        ])
        .setup(|app| {
            load_channels(app.handle(), &app.state::<AppState>().pool);

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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_channel(protocol: ChannelProtocol) -> Channel {
        Channel {
            id: "channel-id".into(),
            name: "test-channel".into(),
            base_url: "https://api.example.com".into(),
            api_key: "secret".into(),
            models: vec!["model-a".into()],
            protocol,
            weight: 1,
            enabled: true,
            healthy: true,
        }
    }

    fn chat_req(stream: Option<bool>) -> ChatRequest {
        ChatRequest {
            model: "model-a".into(),
            messages: vec![Message {
                role: "user".into(),
                content: "hello".into(),
            }],
            max_tokens: Some(128),
            temperature: Some(0.2),
            stream,
            channel_id: None,
        }
    }

    #[test]
    fn openai_channels_use_chat_completions_payload() {
        let channel = test_channel(ChannelProtocol::OpenAIChatCompletions);
        let req = chat_req(Some(false));

        assert_eq!(
            chat_url(&channel),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            model_list_url(&channel),
            "https://api.example.com/v1/models"
        );
        assert_eq!(
            auth_headers(&channel),
            vec![("Authorization".to_string(), "Bearer secret".to_string()),]
        );

        let body = chat_body(&channel, &req, false);
        assert_eq!(body["model"], "model-a");
        assert_eq!(body["stream"], false);
        assert!(body.get("messages").is_some());
    }

    #[test]
    fn openai_responses_channels_use_responses_payload() {
        let channel = test_channel(ChannelProtocol::OpenAIResponses);
        let req = chat_req(Some(true));

        assert_eq!(chat_url(&channel), "https://api.example.com/v1/responses");
        assert_eq!(
            model_list_url(&channel),
            "https://api.example.com/v1/models"
        );
        assert_eq!(
            auth_headers(&channel),
            vec![("Authorization".to_string(), "Bearer secret".to_string()),]
        );

        let body = chat_body(&channel, &req, true);
        assert_eq!(body["model"], "model-a");
        assert_eq!(body["stream"], true);
        assert_eq!(body["max_output_tokens"], 128);
        assert!(body.get("input").is_some());
        assert!(body.get("messages").is_none());
    }

    #[test]
    fn anthropic_channels_use_messages_payload_and_headers() {
        let channel = test_channel(ChannelProtocol::AnthropicMessages);
        let req = chat_req(Some(true));

        assert_eq!(chat_url(&channel), "https://api.example.com/v1/messages");
        assert_eq!(
            model_list_url(&channel),
            "https://api.example.com/v1/models"
        );
        assert_eq!(
            auth_headers(&channel),
            vec![
                ("x-api-key".to_string(), "secret".to_string()),
                ("anthropic-version".to_string(), "2023-06-01".to_string()),
            ]
        );

        let body = chat_body(&channel, &req, true);
        assert_eq!(body["model"], "model-a");
        assert_eq!(body["stream"], true);
        assert_eq!(body["max_tokens"], 128);
        assert!(body.get("messages").is_some());
    }

    #[test]
    fn openai_responses_are_normalized_to_chat_shape() {
        let channel = test_channel(ChannelProtocol::OpenAIResponses);
        let body = serde_json::json!({
            "id": "resp_123",
            "model": "model-a",
            "output_text": "hello from responses",
        });

        let normalized = normalize_chat_response(&channel, body);
        assert_eq!(normalized["provider"], "openai-responses");
        assert_eq!(
            normalized["choices"][0]["message"]["content"],
            "hello from responses"
        );
    }

    #[test]
    fn openai_responses_stream_delta_is_normalized() {
        let channel = test_channel(ChannelProtocol::OpenAIResponses);
        let parsed = serde_json::json!({
            "type": "response.output_text.delta",
            "delta": "token",
        });

        let normalized = normalize_stream_delta(&channel, parsed).expect("delta");
        assert_eq!(normalized["provider"], "openai-responses");
        assert_eq!(normalized["choices"][0]["delta"]["content"], "token");
    }

    #[test]
    fn weighted_select_orders_ready_channels_first() {
        let pool = ChannelPool::new();

        let mut low = test_channel(ChannelProtocol::OpenAIChatCompletions);
        low.id = "low".into();
        low.name = "low".into();
        low.weight = 1;
        low.models = vec!["shared".into()];
        pool.add(low);

        let mut high = test_channel(ChannelProtocol::OpenAICompatibleChatCompletions);
        high.id = "high".into();
        high.name = "high".into();
        high.weight = 10;
        high.models = vec!["shared".into()];
        pool.add(high);

        let mut disabled = test_channel(ChannelProtocol::AnthropicMessages);
        disabled.id = "disabled".into();
        disabled.name = "disabled".into();
        disabled.weight = 100;
        disabled.enabled = false;
        disabled.models = vec!["shared".into()];
        pool.add(disabled);

        let selected = pool.select_for_model("shared");
        assert_eq!(
            selected
                .iter()
                .map(|channel| channel.name.as_str())
                .collect::<Vec<_>>(),
            vec!["high", "low"]
        );
    }

    #[test]
    fn fallback_only_uses_transient_upstream_statuses() {
        assert!(should_fallback_status(408));
        assert!(should_fallback_status(429));
        assert!(should_fallback_status(500));
        assert!(!should_fallback_status(400));
        assert!(!should_fallback_status(401));
        assert!(!should_fallback_status(404));
    }

    #[test]
    fn console_settings_normalize_invalid_protocol_values() {
        let settings = normalize_console_settings(ConsoleSettings {
            active_provider: "openai".into(),
            selected_channel_id: Some("".into()),
            default_protocol: "custom".into(),
        });

        assert_eq!(settings.active_provider, "all");
        assert_eq!(settings.selected_channel_id, None);
        assert_eq!(settings.default_protocol, "openai-chat-completions");
    }
}

