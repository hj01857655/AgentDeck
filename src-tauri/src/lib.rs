mod channels;

use channels::{Channel, ChannelPool, ChannelProtocol};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State};
use tauri_plugin_store::StoreExt;
use toml_edit::{value, DocumentMut};

const STORE_PATH: &str = "channels.json";
const SETTINGS_STORE_PATH: &str = "console-settings.json";
const CODEX_RUNTIME_PROVIDER_ID: &str = "custom";
const CLAUDE_SETTINGS_FILE: &str = "settings.json";
const CLAUDE_MANAGED_ENV_KEYS_FILE: &str = "agentdeck_managed_env_keys.json";
const SESSION_FILE_LIMIT_PER_PROVIDER: usize = 160;
const SESSION_META_PARSE_MAX_LINES: usize = 1200;
const SESSION_META_PARSE_MAX_BYTES: usize = 2 * 1024 * 1024;
const SESSION_MESSAGES_LIMIT: usize = 500;
const SESSION_MESSAGE_MAX_CHARS: usize = 12_000;

pub struct AppState {
    pub pool: Arc<ChannelPool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionMeta {
    pub provider_id: String,
    pub session_id: String,
    pub title: String,
    pub model: Option<String>,
    pub project_dir: Option<String>,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
    pub message_count: usize,
    pub source_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionMessage {
    pub role: String,
    pub content: String,
    pub ts: Option<i64>,
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

#[derive(Debug, Serialize)]
pub struct ClientInstallation {
    pub client_id: String,
    pub name: String,
    pub command: Option<String>,
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub source: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConfigStatus {
    pub exists: bool,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClaudePluginStatus {
    pub config: ConfigStatus,
    pub applied: bool,
    pub onboarding_skipped: bool,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillsShSkill {
    pub key: String,
    pub name: String,
    pub directory: String,
    pub repo_owner: String,
    pub repo_name: String,
    pub repo_branch: String,
    pub installs: u64,
    pub readme_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillsShSearchResult {
    pub skills: Vec<SkillsShSkill>,
    pub total_count: usize,
    pub query: String,
}

#[derive(Debug, Clone, Deserialize)]
struct SkillsShApiResponse {
    pub query: String,
    pub skills: Vec<SkillsShApiSkill>,
    pub count: usize,
}

#[derive(Debug, Clone, Deserialize)]
struct SkillsShApiSkill {
    pub id: String,
    #[serde(rename = "skillId")]
    pub skill_id: String,
    pub name: String,
    pub installs: u64,
    pub source: String,
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
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

fn value_as_object_mut(value: &mut Value) -> Result<&mut serde_json::Map<String, Value>, String> {
    if !value.is_object() {
        *value = serde_json::json!({});
    }
    value
        .as_object_mut()
        .ok_or_else(|| "JSON root is not an object".to_string())
}

fn merge_mcp_server(
    map: &mut std::collections::BTreeMap<String, ManagedMcpServer>,
    server: ManagedMcpServer,
) {
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
                "claude".into(),
                "Claude 用户 Skills".into(),
                claude_home.join("skills"),
            ),
            (
                "claude-commands".into(),
                "Claude 旧 Commands（兼容）".into(),
                claude_home.join("commands"),
            ),
        ]),
        "mcp" => Ok(vec![
            (
                "codex".into(),
                "Codex MCP 配置".into(),
                codex_home.join("config.toml"),
            ),
            (
                "claude-user".into(),
                "Claude 用户 / 本地 MCP 状态".into(),
                home_dir.join(".claude.json"),
            ),
            (
                "claude-settings".into(),
                "Claude 用户 Settings".into(),
                claude_home.join("settings.json"),
            ),
        ]),
        "plugin" => Ok(vec![
            (
                "codex".into(),
                "Codex Plugins".into(),
                codex_home.join("plugins"),
            ),
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
        ]),
        _ => Err(format!("Unsupported extension kind '{}'", kind)),
    }
}

fn client_runtime_locations(client_id: &str) -> Result<Vec<(String, String, PathBuf)>, String> {
    let home = user_home_dir()?;
    match client_id {
        "claude-code" => {
            let claude_home = resolve_claude_home()?;
            Ok(vec![
                (
                    "claude-code".into(),
                    "Claude Code 配置目录".into(),
                    claude_home.clone(),
                ),
                (
                    "claude-code".into(),
                    "Claude Code 用户状态".into(),
                    home.join(".claude.json"),
                ),
                (
                    "claude-code".into(),
                    "Claude Code 会话".into(),
                    claude_home.join("projects"),
                ),
                (
                    "claude-code".into(),
                    "Claude Code Skills".into(),
                    claude_home.join("skills"),
                ),
                (
                    "claude-code".into(),
                    "Claude Code Commands".into(),
                    claude_home.join("commands"),
                ),
            ])
        }
        "codex" => {
            let codex_home = resolve_codex_home()?;
            let agents_home = resolve_agents_home()?;
            Ok(vec![
                ("codex".into(), "Codex 配置目录".into(), codex_home.clone()),
                (
                    "codex".into(),
                    "Codex 配置文件".into(),
                    codex_home.join("config.toml"),
                ),
                (
                    "codex".into(),
                    "Codex 认证文件".into(),
                    codex_home.join("auth.json"),
                ),
                (
                    "codex".into(),
                    "Codex active 会话（未归档）".into(),
                    codex_home.join("sessions"),
                ),
                (
                    "codex".into(),
                    "Codex archived 会话（已归档）".into(),
                    codex_home.join("archived_sessions"),
                ),
                (
                    "codex".into(),
                    "Codex Skills（主目录）".into(),
                    agents_home.join("skills"),
                ),
                (
                    "codex".into(),
                    "Codex Plugins".into(),
                    codex_home.join("plugins"),
                ),
            ])
        }
        "claude-desktop" => Ok(claude_desktop_runtime_paths()?),
        "antigravity" => {
            let dir = home.join(".gemini");
            Ok(vec![
                (
                    "antigravity".into(),
                    "Antigravity CLI 配置目录".into(),
                    dir.clone(),
                ),
                (
                    "antigravity".into(),
                    "Antigravity CLI 环境变量".into(),
                    dir.join(".env"),
                ),
                (
                    "antigravity".into(),
                    "Antigravity CLI Settings".into(),
                    dir.join("settings.json"),
                ),
                (
                    "antigravity".into(),
                    "Antigravity CLI 临时会话".into(),
                    dir.join("tmp"),
                ),
                (
                    "antigravity".into(),
                    "Antigravity CLI OAuth".into(),
                    dir.join("oauth_creds.json"),
                ),
            ])
        }
        "opencode" => {
            let config_dir = home.join(".config").join("opencode");
            let data_dir = std::env::var_os("XDG_DATA_HOME")
                .map(PathBuf::from)
                .filter(|value| !value.as_os_str().is_empty())
                .unwrap_or_else(|| home.join(".local").join("share"))
                .join("opencode");
            let db_path = std::env::var_os("OPENCODE_DB")
                .map(PathBuf::from)
                .filter(|value| !value.as_os_str().is_empty())
                .unwrap_or_else(|| data_dir.join("opencode.db"));
            Ok(vec![
                (
                    "opencode".into(),
                    "OpenCode 配置目录".into(),
                    config_dir.clone(),
                ),
                (
                    "opencode".into(),
                    "OpenCode 配置文件".into(),
                    config_dir.join("opencode.jsonc"),
                ),
                (
                    "opencode".into(),
                    "OpenCode 环境变量".into(),
                    config_dir.join(".env"),
                ),
                ("opencode".into(), "OpenCode 数据目录".into(), data_dir),
                ("opencode".into(), "OpenCode 数据库".into(), db_path),
            ])
        }
        "openclaw" => {
            let dir = home.join(".openclaw");
            Ok(vec![
                ("openclaw".into(), "OpenClaw 配置目录".into(), dir.clone()),
                (
                    "openclaw".into(),
                    "OpenClaw 配置文件".into(),
                    dir.join("openclaw.json"),
                ),
                (
                    "openclaw".into(),
                    "OpenClaw Agents".into(),
                    dir.join("agents"),
                ),
                (
                    "openclaw".into(),
                    "OpenClaw Workspace".into(),
                    dir.join("workspace"),
                ),
                (
                    "openclaw".into(),
                    "OpenClaw Memory".into(),
                    dir.join("workspace").join("memory"),
                ),
            ])
        }
        "hermes" => {
            let dir = resolve_hermes_home(&home);
            Ok(vec![
                ("hermes".into(), "Hermes Agent 配置目录".into(), dir.clone()),
                (
                    "hermes".into(),
                    "Hermes Agent 配置文件".into(),
                    dir.join("config.yaml"),
                ),
                (
                    "hermes".into(),
                    "Hermes Agent 会话".into(),
                    dir.join("sessions"),
                ),
                (
                    "hermes".into(),
                    "Hermes Agent 数据库".into(),
                    dir.join("state.db"),
                ),
                (
                    "hermes".into(),
                    "Hermes Agent Memories".into(),
                    dir.join("memories"),
                ),
            ])
        }
        _ => Err(format!("Unsupported client id '{}'", client_id)),
    }
}

fn client_command(client_id: &str) -> Option<(&'static str, &'static str)> {
    match client_id {
        "claude-code" => Some(("Claude Code CLI", "claude")),
        "codex" => Some(("Codex CLI", "codex")),
        "antigravity" => Some(("Antigravity CLI", "antigravity")),
        "opencode" => Some(("OpenCode CLI", "opencode")),
        "openclaw" => Some(("OpenClaw CLI", "openclaw")),
        "hermes" => Some(("Hermes Agent CLI", "hermes")),
        _ => None,
    }
}

fn known_desktop_install_paths(client_id: &str) -> Vec<(String, PathBuf)> {
    let Ok(home) = user_home_dir() else {
        return Vec::new();
    };

    match client_id {
        "claude-desktop" => {
            let mut paths = Vec::new();
            #[cfg(target_os = "windows")]
            {
                if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
                    paths.push((
                        "Claude Desktop".into(),
                        local.join("AnthropicClaude").join("Claude.exe"),
                    ));
                    paths.push((
                        "Claude Desktop".into(),
                        local.join("Programs").join("Claude").join("Claude.exe"),
                    ));
                }
                paths.push((
                    "Claude Desktop".into(),
                    home.join("AppData")
                        .join("Local")
                        .join("AnthropicClaude")
                        .join("Claude.exe"),
                ));
            }
            #[cfg(target_os = "macos")]
            {
                paths.push((
                    "Claude Desktop".into(),
                    PathBuf::from("/Applications/Claude.app"),
                ));
                paths.push((
                    "Claude Desktop".into(),
                    home.join("Applications").join("Claude.app"),
                ));
            }
            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            {
                paths.push((
                    "Claude Desktop".into(),
                    home.join(".local")
                        .join("share")
                        .join("applications")
                        .join("claude.desktop"),
                ));
            }
            paths
        }
        _ => Vec::new(),
    }
}

fn command_paths(command: &str) -> Vec<PathBuf> {
    let output = if cfg!(windows) {
        std::process::Command::new("where").arg(command).output()
    } else {
        std::process::Command::new("sh")
            .args(["-lc", &format!("command -v {}", command)])
            .output()
    };

    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    let mut paths = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let path = PathBuf::from(line);
        if !paths.iter().any(|existing| existing == &path) {
            paths.push(path);
        }
    }
    paths
}

#[cfg(target_os = "windows")]
fn is_windows_executable_candidate(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("exe" | "cmd" | "bat" | "ps1")
    )
}

#[cfg(not(target_os = "windows"))]
fn is_windows_executable_candidate(_path: &Path) -> bool {
    true
}

fn first_output_line(raw: &[u8]) -> Option<String> {
    String::from_utf8_lossy(raw)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.chars().take(140).collect())
}

fn probe_command_version(path: &Path) -> (Option<String>, Option<String>) {
    match std::process::Command::new(path).arg("--version").output() {
        Ok(output) if output.status.success() => {
            let version =
                first_output_line(&output.stdout).or_else(|| first_output_line(&output.stderr));
            (version, None)
        }
        Ok(output) => {
            let error = first_output_line(&output.stderr)
                .or_else(|| first_output_line(&output.stdout))
                .unwrap_or_else(|| format!("--version exited with {}", output.status));
            (None, Some(error))
        }
        Err(err) => (None, Some(err.to_string())),
    }
}

#[tauri::command]
fn detect_client_installations(client_id: String) -> Vec<ClientInstallation> {
    if let Some((name, command)) = client_command(client_id.as_str()) {
        let mut paths = command_paths(command);
        if cfg!(windows) {
            let runnable: Vec<PathBuf> = paths
                .iter()
                .filter(|path| is_windows_executable_candidate(path))
                .cloned()
                .collect();
            if !runnable.is_empty() {
                paths = runnable;
            }
        }
        if paths.is_empty() {
            return vec![ClientInstallation {
                client_id,
                name: name.into(),
                command: Some(command.into()),
                installed: false,
                version: None,
                path: None,
                source: "PATH".into(),
                error: Some("未在 PATH 中找到可执行文件".into()),
            }];
        }

        return paths
            .into_iter()
            .map(|path| {
                let (version, error) = probe_command_version(&path);
                ClientInstallation {
                    client_id: client_id.clone(),
                    name: name.into(),
                    command: Some(command.into()),
                    installed: true,
                    version,
                    path: Some(path.display().to_string()),
                    source: "PATH".into(),
                    error,
                }
            })
            .collect();
    }

    let paths = known_desktop_install_paths(client_id.as_str());
    if paths.is_empty() {
        return vec![ClientInstallation {
            client_id,
            name: "未知 App".into(),
            command: None,
            installed: false,
            version: None,
            path: None,
            source: "known-path".into(),
            error: Some("暂未配置安装检测规则".into()),
        }];
    }

    paths
        .into_iter()
        .map(|(name, path)| {
            let installed = path.exists();
            ClientInstallation {
                client_id: client_id.clone(),
                name,
                command: None,
                installed,
                version: None,
                path: Some(path.display().to_string()),
                source: "known-path".into(),
                error: if installed {
                    None
                } else {
                    Some("未找到该路径".into())
                },
            }
        })
        .collect()
}

fn claude_desktop_runtime_paths() -> Result<Vec<(String, String, PathBuf)>, String> {
    let home = user_home_dir()?;
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .filter(|value| !value.as_os_str().is_empty())
        .unwrap_or_else(|| home.join("AppData").join("Local"));
    #[cfg(target_os = "macos")]
    let base = home.join("Library").join("Application Support");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let base = home.join(".config");

    let normal = base.join("Claude");
    let threep = base.join("Claude-3p");
    Ok(vec![
        (
            "claude-desktop".into(),
            "Claude Desktop 配置目录".into(),
            normal.clone(),
        ),
        (
            "claude-desktop".into(),
            "Claude Desktop MCP 配置".into(),
            normal.join("claude_desktop_config.json"),
        ),
        (
            "claude-desktop".into(),
            "Claude Desktop 3P 配置目录".into(),
            threep.clone(),
        ),
        (
            "claude-desktop".into(),
            "Claude Desktop 3P MCP 配置".into(),
            threep.join("claude_desktop_config.json"),
        ),
        (
            "claude-desktop".into(),
            "Claude Desktop 3P 配置库".into(),
            threep.join("config-library"),
        ),
    ])
}

fn resolve_hermes_home(home: &Path) -> PathBuf {
    if let Some(raw) = std::env::var_os("HERMES_HOME") {
        let value = raw.to_string_lossy().trim().to_string();
        if !value.is_empty() {
            return PathBuf::from(value);
        }
    }

    #[cfg(target_os = "windows")]
    {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .filter(|value| !value.as_os_str().is_empty())
            .unwrap_or_else(|| home.join("AppData").join("Local"))
            .join("hermes")
    }
    #[cfg(not(target_os = "windows"))]
    {
        home.join(".hermes")
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

#[tauri::command]
fn list_client_runtime_locations(client_id: String) -> Result<Vec<ExtensionLocation>, String> {
    client_runtime_locations(&client_id)?
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
    let content = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("Serialize {}: {}", path.display(), e))?;
    write_string_with_backup(&path, &format!("{}\n", content))
}

fn read_codex_doc() -> Result<DocumentMut, String> {
    let path = codex_config_path()?;
    let text = fs::read_to_string(&path).unwrap_or_default();
    if text.trim().is_empty() {
        Ok(DocumentMut::new())
    } else {
        text.parse::<DocumentMut>()
            .map_err(|e| format!("Parse {}: {}", path.display(), e))
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
            let target_key = if key == "headers" {
                "http_headers"
            } else {
                key
            };
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
        let target_key = if key == "http_headers" {
            "headers"
        } else {
            key
        };
        let value = match item.as_value() {
            Some(v) if v.is_str() => v.as_str().map(|s| Value::String(s.to_string())),
            Some(v) if v.is_bool() => v.as_bool().map(Value::Bool),
            Some(v) if v.is_integer() => v.as_integer().map(|i| serde_json::json!(i)),
            Some(v) if v.is_float() => v.as_float().map(|f| serde_json::json!(f)),
            Some(v) if v.is_array() => v.as_array().map(|arr| {
                Value::Array(
                    arr.iter()
                        .filter_map(|i| i.as_str().map(|s| Value::String(s.to_string())))
                        .collect(),
                )
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
            if spec
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .is_empty()
            {
                return Err("stdio MCP 必须填写 command".into());
            }
        }
        "http" | "sse" => {
            if spec
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .is_empty()
            {
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
        merge_mcp_server(
            &mut merged,
            ManagedMcpServer {
                id: id.clone(),
                name: id,
                description: "来自 Claude 配置".into(),
                server: spec,
                apps: ToolTargetApps {
                    claude: true,
                    codex: false,
                },
                updated_at: now_millis(),
            },
        );
    }
    for (id, spec) in read_codex_mcp_map()? {
        merge_mcp_server(
            &mut merged,
            ManagedMcpServer {
                id: id.clone(),
                name: id,
                description: "来自 Codex 配置".into(),
                server: spec,
                apps: ToolTargetApps {
                    claude: false,
                    codex: true,
                },
                updated_at: now_millis(),
            },
        );
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
    if server.apps.claude {
        claude.insert(id.clone(), server.server.clone());
    } else {
        claude.remove(&id);
    }
    let p = write_claude_mcp_map(&claude)?;
    files.push(claude_state_path()?.display().to_string());
    if let Some(b) = p {
        files.push(b.display().to_string());
    }
    let mut codex = read_codex_mcp_map()?;
    if server.apps.codex {
        codex.insert(id.clone(), server.server.clone());
    } else {
        codex.remove(&id);
    }
    let p = write_codex_mcp_map(&codex)?;
    files.push(codex_config_path()?.display().to_string());
    if let Some(b) = p {
        files.push(b.display().to_string());
    }
    Ok(files)
}

#[tauri::command]
fn delete_mcp_server(id: String) -> Result<Vec<String>, String> {
    let id = sanitize_id(&id);
    let mut files = Vec::new();
    let mut claude = read_claude_mcp_map()?;
    claude.remove(&id);
    if let Some(b) = write_claude_mcp_map(&claude)? {
        files.push(b.display().to_string());
    }
    files.push(claude_state_path()?.display().to_string());
    let mut codex = read_codex_mcp_map()?;
    codex.remove(&id);
    if let Some(b) = write_codex_mcp_map(&codex)? {
        files.push(b.display().to_string());
    }
    files.push(codex_config_path()?.display().to_string());
    Ok(files)
}

#[tauri::command]
fn toggle_mcp_app(
    id: String,
    app: String,
    enabled: bool,
    server: ManagedMcpServer,
) -> Result<Vec<String>, String> {
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
    map.entry(skill.directory.to_lowercase())
        .and_modify(|existing| {
            existing.apps.claude |= skill.apps.claude;
            existing.apps.codex |= skill.apps.codex;
            if existing.description.is_empty() {
                existing.description = skill.description.clone();
            }
            if existing.path.is_empty() {
                existing.path = skill.path.clone();
            }
        })
        .or_insert(skill);
}

fn scan_skill_source(
    dir: &Path,
    source: &str,
    apps: ToolTargetApps,
    out: &mut std::collections::BTreeMap<String, ManagedSkill>,
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let directory = entry.file_name().to_string_lossy().to_string();
        if directory.starts_with('.') {
            continue;
        }
        let manifest = path.join("SKILL.md");
        if !manifest.is_file() {
            continue;
        }
        let (name, description) = parse_skill_md(&manifest, &directory);
        merge_skill(
            out,
            ManagedSkill {
                id: directory.clone(),
                name,
                description,
                directory: directory.clone(),
                path: path.display().to_string(),
                source: source.into(),
                apps: apps.clone(),
                managed: true,
                updated_at: now_millis(),
            },
        );
    }
}

#[tauri::command]
fn list_managed_skills() -> Result<Vec<ManagedSkill>, String> {
    let mut out = std::collections::BTreeMap::new();
    scan_skill_source(
        &skill_dir_for_app("codex")?,
        "Codex 用户主目录",
        ToolTargetApps {
            claude: false,
            codex: true,
        },
        &mut out,
    );
    scan_skill_source(
        &skill_dir_for_app("codex-legacy")?,
        "Codex 兼容旧目录",
        ToolTargetApps {
            claude: false,
            codex: true,
        },
        &mut out,
    );
    scan_skill_source(
        &skill_dir_for_app("claude")?,
        "Claude 用户目录",
        ToolTargetApps {
            claude: true,
            codex: false,
        },
        &mut out,
    );
    Ok(out.into_values().collect())
}

fn copy_tree_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("Create {}: {}", dst.display(), e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("Read {}: {}", src.display(), e))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_tree_recursive(&src_path, &dst_path)?;
        } else if src_path.is_file() {
            fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("Copy {}: {}", src_path.display(), e))?;
        }
    }
    Ok(())
}

fn copy_skill_dir(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.join("SKILL.md").is_file() {
        return Err(format!("Skill 源目录缺少 SKILL.md: {}", src.display()));
    }
    copy_tree_recursive(src, dst)
}

#[tauri::command]
fn toggle_skill_app(
    skill: ManagedSkill,
    app: String,
    enabled: bool,
) -> Result<SkillToggleResult, String> {
    let target_dir = skill_dir_for_app(&app)?.join(&skill.directory);
    let mut files = Vec::new();
    let mut backups = Vec::new();
    if enabled {
        let source = PathBuf::from(&skill.path);
        if target_dir.exists() {
            let backup = target_dir.with_extension(format!("bak-agentdeck-{}", now_millis()));
            fs::rename(&target_dir, &backup)
                .map_err(|e| format!("Backup {}: {}", target_dir.display(), e))?;
            backups.push(backup.display().to_string());
        }
        copy_skill_dir(&source, &target_dir)?;
        files.push(target_dir.display().to_string());
    } else if target_dir.exists() {
        let backup = target_dir.with_extension(format!("bak-agentdeck-{}", now_millis()));
        fs::rename(&target_dir, &backup)
            .map_err(|e| format!("Backup {}: {}", target_dir.display(), e))?;
        backups.push(backup.display().to_string());
    }
    let mut next = skill;
    match app.as_str() {
        "claude" => next.apps.claude = enabled,
        "codex" => next.apps.codex = enabled,
        _ => return Err(format!("不支持的目标: {}", app)),
    }
    next.updated_at = now_millis();
    Ok(SkillToggleResult {
        skill: next,
        files,
        backups,
    })
}

#[tauri::command]
fn import_skill_from_path(
    source_path: String,
    apps: ToolTargetApps,
) -> Result<SkillToggleResult, String> {
    let source = PathBuf::from(source_path.trim().trim_matches('"'));
    if !source.join("SKILL.md").is_file() {
        return Err(format!("导入目录必须包含 SKILL.md: {}", source.display()));
    }
    let directory = source
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.to_string())
        .ok_or_else(|| format!("无法识别 Skill 目录名: {}", source.display()))?;
    let (name, description) = parse_skill_md(&source.join("SKILL.md"), &directory);
    let mut result = SkillToggleResult {
        skill: ManagedSkill {
            id: directory.clone(),
            name,
            description,
            directory,
            path: source.display().to_string(),
            source: "手动导入".into(),
            apps: ToolTargetApps {
                claude: false,
                codex: false,
            },
            managed: true,
            updated_at: now_millis(),
        },
        files: Vec::new(),
        backups: Vec::new(),
    };
    if apps.claude {
        let applied = toggle_skill_app(result.skill.clone(), "claude".into(), true)?;
        result.skill = applied.skill;
        result.files.extend(applied.files);
        result.backups.extend(applied.backups);
    }
    if apps.codex {
        let applied = toggle_skill_app(result.skill.clone(), "codex".into(), true)?;
        result.skill = applied.skill;
        result.files.extend(applied.files);
        result.backups.extend(applied.backups);
    }
    Ok(result)
}

fn url_encode_component(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            b' ' => out.push_str("%20"),
            other => out.push_str(&format!("%{:02X}", other)),
        }
    }
    out
}

#[tauri::command]
async fn search_skills_sh(
    query: String,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<SkillsShSearchResult, String> {
    let query = query.trim().to_string();
    if query.is_empty() {
        return Ok(SkillsShSearchResult {
            skills: Vec::new(),
            total_count: 0,
            query,
        });
    }
    let client = reqwest::Client::new();
    let limit = limit.unwrap_or(20).clamp(1, 50);
    let offset = offset.unwrap_or(0);
    let url = format!(
        "https://skills.sh/api/search?q={}&limit={}&offset={}",
        url_encode_component(&query),
        limit,
        offset
    );
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("搜索 skills.sh 失败: {}", e))?
        .error_for_status()
        .map_err(|e| format!("搜索 skills.sh 返回错误: {}", e))?
        .json::<SkillsShApiResponse>()
        .await
        .map_err(|e| format!("解析 skills.sh 响应失败: {}", e))?;

    let skills = resp
        .skills
        .into_iter()
        .filter_map(|skill| {
            let (owner, repo) = skill.source.split_once('/')?;
            if owner.contains('.') || repo.contains('.') {
                return None;
            }
            Some(SkillsShSkill {
                key: skill.id,
                name: skill.name,
                directory: skill.skill_id,
                repo_owner: owner.to_string(),
                repo_name: repo.to_string(),
                repo_branch: "main".into(),
                installs: skill.installs,
                readme_url: Some(format!("https://github.com/{}/{}", owner, repo)),
            })
        })
        .collect();

    Ok(SkillsShSearchResult {
        skills,
        total_count: resp.count,
        query: resp.query,
    })
}

fn skill_cache_root() -> Result<PathBuf, String> {
    Ok(user_home_dir()?.join(".agentdeck").join("skill-cache"))
}

fn remove_dir_if_exists(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_dir_all(path).map_err(|e| format!("Remove {}: {}", path.display(), e))?;
    }
    Ok(())
}

fn find_skill_source_dir(repo_dir: &Path, directory: &str) -> Option<PathBuf> {
    let directory = directory.trim().trim_matches('/');
    let candidates = [
        repo_dir.join(directory),
        repo_dir.join("skills").join(directory),
        repo_dir.join(".agents").join("skills").join(directory),
        repo_dir.join(".codex").join("skills").join(directory),
        repo_dir.to_path_buf(),
    ];
    candidates
        .into_iter()
        .find(|path| path.join("SKILL.md").is_file())
}

#[tauri::command]
async fn install_skill_from_git(
    repo_owner: String,
    repo_name: String,
    repo_branch: Option<String>,
    directory: String,
    apps: ToolTargetApps,
) -> Result<SkillToggleResult, String> {
    let owner = sanitize_id(&repo_owner);
    let repo = sanitize_id(&repo_name);
    let branch = repo_branch.unwrap_or_else(|| "main".into());
    if owner.is_empty() || repo.is_empty() || directory.trim().is_empty() {
        return Err("Git Skill 缺少 owner/repo/directory".into());
    }
    let clone_url = format!("https://github.com/{}/{}.git", owner, repo);
    let cache_dir =
        skill_cache_root()?.join(format!("{}-{}-{}", owner, repo, sanitize_id(&directory)));
    let branch_for_clone = branch.clone();
    let cache_for_clone = cache_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        remove_dir_if_exists(&cache_for_clone)?;
        if let Some(parent) = cache_for_clone.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Create {}: {}", parent.display(), e))?;
        }
        let output = std::process::Command::new("git")
            .args([
                "clone",
                "--depth",
                "1",
                "--branch",
                branch_for_clone.as_str(),
                clone_url.as_str(),
            ])
            .arg(&cache_for_clone)
            .output()
            .map_err(|e| format!("启动 git clone 失败: {}", e))?;
        if !output.status.success() {
            return Err(format!(
                "git clone 失败: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("等待 git clone 失败: {}", e))??;

    let source = find_skill_source_dir(&cache_dir, &directory).ok_or_else(|| {
        format!(
            "仓库中未找到包含 SKILL.md 的目录: {} 或 skills/{}",
            directory, directory
        )
    })?;
    import_skill_from_path(source.display().to_string(), apps)
}

// -------- Claude Plugin real management --------

fn claude_plugin_config_path() -> Result<PathBuf, String> {
    Ok(resolve_claude_home()?.join("config.json"))
}

fn read_claude_plugin_value() -> Result<Value, String> {
    read_json_object(&claude_plugin_config_path()?)
}

fn is_claude_plugin_config_applied_value(value: &Value) -> bool {
    value
        .get("primaryApiKey")
        .and_then(|v| v.as_str())
        .map(|v| v == "any")
        .unwrap_or(false)
}

fn write_claude_plugin_value(value: &Value) -> Result<Option<PathBuf>, String> {
    let path = claude_plugin_config_path()?;
    let content = serde_json::to_string_pretty(value)
        .map_err(|e| format!("Serialize {}: {}", path.display(), e))?;
    write_string_with_backup(&path, &format!("{}\n", content))
}

#[tauri::command]
fn get_claude_plugin_status() -> Result<ClaudePluginStatus, String> {
    let path = claude_plugin_config_path()?;
    let value = read_claude_plugin_value()?;
    let onboarding = read_json_object(&claude_state_path()?)?
        .get("hasCompletedOnboarding")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    Ok(ClaudePluginStatus {
        config: ConfigStatus {
            exists: path.exists(),
            path: path.display().to_string(),
        },
        applied: is_claude_plugin_config_applied_value(&value),
        onboarding_skipped: onboarding,
    })
}

#[tauri::command]
fn read_claude_plugin_config() -> Result<Option<String>, String> {
    let path = claude_plugin_config_path()?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Read {}: {}", path.display(), e))
}

#[tauri::command]
fn apply_claude_plugin_config(official: bool) -> Result<bool, String> {
    let mut value = read_claude_plugin_value()?;
    let obj = value_as_object_mut(&mut value)?;
    let changed = if official {
        obj.remove("primaryApiKey").is_some()
    } else if obj.get("primaryApiKey").and_then(|v| v.as_str()) != Some("any") {
        obj.insert("primaryApiKey".into(), Value::String("any".into()));
        true
    } else {
        false
    };
    if changed || (!official && !claude_plugin_config_path()?.exists()) {
        write_claude_plugin_value(&value)?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
fn is_claude_plugin_applied() -> Result<bool, String> {
    Ok(is_claude_plugin_config_applied_value(
        &read_claude_plugin_value()?,
    ))
}

#[tauri::command]
fn apply_claude_onboarding_skip() -> Result<bool, String> {
    let path = claude_state_path()?;
    let mut value = read_json_object(&path)?;
    let obj = value_as_object_mut(&mut value)?;
    if obj
        .get("hasCompletedOnboarding")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        return Ok(false);
    }
    obj.insert("hasCompletedOnboarding".into(), Value::Bool(true));
    let content = serde_json::to_string_pretty(&value)
        .map_err(|e| format!("Serialize {}: {}", path.display(), e))?;
    write_string_with_backup(&path, &format!("{}\n", content))?;
    Ok(true)
}

#[tauri::command]
fn clear_claude_onboarding_skip() -> Result<bool, String> {
    let path = claude_state_path()?;
    if !path.exists() {
        return Ok(false);
    }
    let mut value = read_json_object(&path)?;
    let obj = value_as_object_mut(&mut value)?;
    if obj.remove("hasCompletedOnboarding").is_none() {
        return Ok(false);
    }
    let content = serde_json::to_string_pretty(&value)
        .map_err(|e| format!("Serialize {}: {}", path.display(), e))?;
    write_string_with_backup(&path, &format!("{}\n", content))?;
    Ok(true)
}

#[tauri::command]
fn import_mcp_from_apps() -> Result<usize, String> {
    // AgentDeck currently uses live Claude/Codex config as the MCP source of truth.
    // Import means actively reading both app configs and returning the real merged count,
    // instead of the old UI-only refresh placeholder.
    Ok(list_mcp_servers()?.len())
}

// -------- Persistence helpers --------

fn agentdeck_config_dir() -> Result<PathBuf, String> {
    Ok(user_home_dir()?.join(".agentdeck"))
}

fn provider_db_path() -> Result<PathBuf, String> {
    Ok(agentdeck_config_dir()?.join("agentdeck.db"))
}

fn protocol_to_str(protocol: &ChannelProtocol) -> &'static str {
    match protocol {
        ChannelProtocol::OpenAIChatCompletions => "openai-chat-completions",
        ChannelProtocol::OpenAIResponses => "openai-responses",
        ChannelProtocol::AnthropicMessages => "anthropic-messages",
    }
}

fn open_provider_db() -> Result<Connection, String> {
    let path = provider_db_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create AgentDeck config directory {}: {}",
                parent.display(),
                e
            )
        })?;
    }
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open provider database {}: {}", path.display(), e))?;
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS provider_configs (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            service_provider TEXT NOT NULL DEFAULT 'custom',
            base_url TEXT NOT NULL,
            api_key TEXT NOT NULL,
            models_json TEXT NOT NULL DEFAULT '[]',
            protocol TEXT NOT NULL,
            weight INTEGER NOT NULL DEFAULT 1,
            enabled INTEGER NOT NULL DEFAULT 1,
            healthy INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_provider_configs_protocol ON provider_configs(protocol);
        CREATE INDEX IF NOT EXISTS idx_provider_configs_service_provider ON provider_configs(service_provider);
        "#,
    )
    .map_err(|e| format!("Failed to initialize provider database schema: {}", e))?;
    Ok(conn)
}

fn read_channels_from_db() -> Result<Vec<Channel>, String> {
    let conn = open_provider_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, service_provider, base_url, api_key, models_json, protocol, weight, enabled, healthy
             FROM provider_configs
             ORDER BY updated_at DESC, created_at DESC, name ASC, id ASC",
        )
        .map_err(|e| format!("Failed to prepare provider query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            let models_json: String = row.get(5)?;
            let protocol: String = row.get(6)?;
            let models = serde_json::from_str::<Vec<String>>(&models_json).unwrap_or_default();
            let protocol =
                protocol_from_str(&protocol).unwrap_or(ChannelProtocol::OpenAIChatCompletions);
            Ok(Channel {
                id: row.get(0)?,
                name: row.get(1)?,
                service_provider: row.get(2)?,
                base_url: row.get(3)?,
                api_key: row.get(4)?,
                models,
                protocol,
                weight: row.get::<_, i64>(7)?.max(1) as u32,
                enabled: row.get::<_, i64>(8)? != 0,
                healthy: row.get::<_, i64>(9)? != 0,
            })
        })
        .map_err(|e| format!("Failed to read provider rows: {}", e))?;

    let mut channels = Vec::new();
    for row in rows {
        channels.push(row.map_err(|e| format!("Failed to decode provider row: {}", e))?);
    }
    Ok(channels)
}

fn write_channels_to_db(channels: &[Channel]) -> Result<(), String> {
    let mut conn = open_provider_db()?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin provider database transaction: {}", e))?;
    tx.execute("DELETE FROM provider_configs", [])
        .map_err(|e| format!("Failed to clear provider database: {}", e))?;
    let now = now_millis();
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO provider_configs (
                    id, name, service_provider, base_url, api_key, models_json, protocol,
                    weight, enabled, healthy, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            )
            .map_err(|e| format!("Failed to prepare provider upsert: {}", e))?;
        for channel in channels {
            let id = if channel.id.trim().is_empty() {
                uuid::Uuid::new_v4().to_string()
            } else {
                channel.id.clone()
            };
            let models_json = serde_json::to_string(&channel.models)
                .map_err(|e| format!("Failed to serialize provider models: {}", e))?;
            stmt.execute(params![
                id,
                channel.name,
                if channel.service_provider.trim().is_empty() {
                    "custom"
                } else {
                    channel.service_provider.as_str()
                },
                channel.base_url,
                channel.api_key,
                models_json,
                protocol_to_str(&channel.protocol),
                channel.weight.max(1) as i64,
                if channel.enabled { 1 } else { 0 },
                if channel.healthy { 1 } else { 0 },
                now,
                now,
            ])
            .map_err(|e| format!("Failed to write provider '{}': {}", channel.name, e))?;
        }
    }
    tx.commit()
        .map_err(|e| format!("Failed to commit provider database transaction: {}", e))
}

fn read_legacy_store_channels(app: &tauri::AppHandle) -> Vec<Channel> {
    app.store(STORE_PATH)
        .ok()
        .and_then(|store| store.get("channels"))
        .and_then(|val| serde_json::from_value::<Vec<Channel>>(val.clone()).ok())
        .unwrap_or_default()
}

fn save_channels(app: &tauri::AppHandle, pool: &ChannelPool) {
    let channels = pool.list();
    if let Err(err) = write_channels_to_db(&channels) {
        log::error!("Failed to persist provider configs to database: {}", err);
    }
    let _ = app;
}

fn load_channels(app: &tauri::AppHandle, pool: &ChannelPool) {
    match read_channels_from_db() {
        Ok(channels) if !channels.is_empty() => {
            pool.replace_all(channels);
        }
        Ok(_) => {
            let mut legacy = read_legacy_store_channels(app);
            for channel in &mut legacy {
                if channel.id.trim().is_empty() {
                    channel.id = uuid::Uuid::new_v4().to_string();
                }
            }
            if !legacy.is_empty() {
                if let Err(err) = write_channels_to_db(&legacy) {
                    log::error!(
                        "Failed to migrate legacy provider configs into database: {}",
                        err
                    );
                }
            }
            pool.replace_all(legacy);
        }
        Err(err) => {
            log::error!("Failed to load provider configs from database: {}", err);
            pool.replace_all(read_legacy_store_channels(app));
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsoleSettings {
    pub active_provider: String,
    pub selected_channel_id: Option<String>,
    pub default_protocol: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisibleClients {
    #[serde(rename = "claude-code")]
    pub claude_code: bool,
    pub codex: bool,
    #[serde(rename = "claude-desktop")]
    pub claude_desktop: bool,
    pub antigravity: bool,
    pub opencode: bool,
    pub openclaw: bool,
    pub hermes: bool,
}

impl Default for VisibleClients {
    fn default() -> Self {
        Self {
            claude_code: true,
            codex: true,
            claude_desktop: false,
            antigravity: false,
            opencode: false,
            openclaw: false,
            hermes: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub active_client: String,
    pub visible_clients: VisibleClients,
    #[serde(default)]
    pub launch_on_startup: bool,
    #[serde(default = "default_minimize_to_tray_on_close")]
    pub minimize_to_tray_on_close: bool,
    #[serde(default)]
    pub skip_claude_onboarding: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            active_client: "claude-code".into(),
            visible_clients: VisibleClients::default(),
            launch_on_startup: false,
            minimize_to_tray_on_close: true,
            skip_claude_onboarding: false,
        }
    }
}

fn default_minimize_to_tray_on_close() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManualPluginItem {
    pub id: String,
    pub name: String,
    pub description: String,
    pub path: String,
    pub apps: ToolTargetApps,
    pub updated_at: i64,
    pub manual: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelListCacheEntry {
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub cached_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolUiState {
    #[serde(default)]
    pub plugin_switches: std::collections::BTreeMap<String, ToolTargetApps>,
    #[serde(default)]
    pub manual_plugins: Vec<ManualPluginItem>,
    #[serde(default)]
    pub applied_tool_channel_ids: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub model_list_cache: std::collections::BTreeMap<String, ModelListCacheEntry>,
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

fn is_valid_client_id(value: &str) -> bool {
    matches!(
        value,
        "claude-code"
            | "codex"
            | "claude-desktop"
            | "antigravity"
            | "opencode"
            | "openclaw"
            | "hermes"
    )
}

fn visible_client_ids(visible: &VisibleClients) -> Vec<&'static str> {
    let mut ids = Vec::new();
    if visible.claude_code {
        ids.push("claude-code");
    }
    if visible.codex {
        ids.push("codex");
    }
    if visible.claude_desktop {
        ids.push("claude-desktop");
    }
    if visible.antigravity {
        ids.push("antigravity");
    }
    if visible.opencode {
        ids.push("opencode");
    }
    if visible.openclaw {
        ids.push("openclaw");
    }
    if visible.hermes {
        ids.push("hermes");
    }
    ids
}

fn normalize_app_settings(mut settings: AppSettings) -> AppSettings {
    if visible_client_ids(&settings.visible_clients).is_empty() {
        settings.visible_clients = VisibleClients::default();
    }

    // AppSwitcher visibility only controls which buttons are shown in the header.
    // It must not constrain page-level App selectors or the currently active app.
    if !is_valid_client_id(&settings.active_client) {
        settings.active_client = "claude-code".to_string();
    }

    settings
}

fn app_settings_path() -> Result<PathBuf, String> {
    Ok(user_home_dir()?.join(".agentdeck").join("settings.json"))
}

#[cfg(target_os = "macos")]
fn macos_app_bundle_path(exe_path: &Path) -> Option<PathBuf> {
    let path = exe_path.to_string_lossy();
    path.find(".app/Contents/MacOS/")
        .map(|pos| PathBuf::from(&path[..pos + 4]))
}

fn auto_launch_instance() -> Result<auto_launch::AutoLaunch, String> {
    let exe_path = std::env::current_exe().map_err(|e| format!("无法获取应用路径: {}", e))?;
    #[cfg(target_os = "macos")]
    let app_path = macos_app_bundle_path(&exe_path).unwrap_or(exe_path);
    #[cfg(not(target_os = "macos"))]
    let app_path = exe_path;

    auto_launch::AutoLaunchBuilder::new()
        .set_app_name("AgentDeck")
        .set_app_path(&app_path.to_string_lossy())
        .build()
        .map_err(|e| format!("创建开机自启配置失败: {}", e))
}

fn set_auto_launch_enabled(enabled: bool) -> Result<(), String> {
    let auto_launch = auto_launch_instance()?;
    if enabled {
        auto_launch
            .enable()
            .map_err(|e| format!("启用开机自启失败: {}", e))
    } else {
        auto_launch
            .disable()
            .map_err(|e| format!("关闭开机自启失败: {}", e))
    }
}

fn is_auto_launch_enabled() -> Result<bool, String> {
    auto_launch_instance()?
        .is_enabled()
        .map_err(|e| format!("读取开机自启状态失败: {}", e))
}

fn tool_ui_state_path() -> Result<PathBuf, String> {
    Ok(user_home_dir()?.join(".agentdeck").join("tool-state.json"))
}

fn normalize_tool_ui_state(mut state: ToolUiState) -> ToolUiState {
    state.manual_plugins.retain(|item| {
        !item.id.trim().is_empty() || !item.path.trim().is_empty() || !item.name.trim().is_empty()
    });
    for item in &mut state.manual_plugins {
        if item.id.trim().is_empty() {
            let fallback = if !item.path.trim().is_empty() {
                item.path.as_str()
            } else {
                item.name.as_str()
            };
            item.id = format!("manual:{}", sanitize_id(fallback));
        }
        if item.updated_at <= 0 {
            item.updated_at = now_millis();
        }
        item.manual = true;
    }
    state.model_list_cache.retain(|key, entry| {
        !key.trim().is_empty() && entry.models.iter().any(|model| !model.trim().is_empty())
    });
    for entry in state.model_list_cache.values_mut() {
        let mut seen = std::collections::BTreeSet::new();
        entry.models = entry
            .models
            .iter()
            .map(|model| model.trim().to_string())
            .filter(|model| !model.is_empty() && seen.insert(model.clone()))
            .collect();
        if entry.cached_at <= 0 {
            entry.cached_at = now_millis();
        }
    }
    state
}

fn read_tool_ui_state_file() -> ToolUiState {
    let Ok(path) = tool_ui_state_path() else {
        return ToolUiState::default();
    };
    let Ok(content) = fs::read_to_string(&path) else {
        return ToolUiState::default();
    };
    serde_json::from_str::<ToolUiState>(&content)
        .map(normalize_tool_ui_state)
        .unwrap_or_default()
}

fn write_tool_ui_state_file(state: &ToolUiState) -> Result<(), String> {
    let state = normalize_tool_ui_state(state.clone());
    let path = tool_ui_state_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create settings directory {}: {}",
                parent.display(),
                e
            )
        })?;
    }
    let content = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("Failed to serialize tool UI state: {}", e))?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write tool UI state {}: {}", path.display(), e))
}

fn read_app_settings_file() -> AppSettings {
    let Ok(path) = app_settings_path() else {
        return AppSettings::default();
    };
    let Ok(content) = fs::read_to_string(&path) else {
        return AppSettings::default();
    };
    serde_json::from_str::<AppSettings>(&content)
        .map(normalize_app_settings)
        .unwrap_or_default()
}

fn claude_onboarding_skipped() -> bool {
    claude_state_path()
        .ok()
        .and_then(|path| read_json_object(&path).ok())
        .and_then(|value| {
            value
                .get("hasCompletedOnboarding")
                .and_then(|v| v.as_bool())
        })
        .unwrap_or(false)
}

fn read_app_settings_with_runtime_status() -> AppSettings {
    let mut settings = read_app_settings_file();
    if let Ok(enabled) = is_auto_launch_enabled() {
        settings.launch_on_startup = enabled;
    }
    settings.skip_claude_onboarding = claude_onboarding_skipped();
    settings
}

fn write_app_settings_file(settings: &AppSettings) -> Result<(), String> {
    let settings = normalize_app_settings(settings.clone());
    let path = app_settings_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create settings directory {}: {}",
                parent.display(),
                e
            )
        })?;
    }
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize app settings: {}", e))?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write app settings {}: {}", path.display(), e))
}

fn normalized_base_url(channel: &Channel) -> String {
    channel.base_url.trim_end_matches('/').to_string()
}

fn strip_known_api_endpoint_suffix(base: &str) -> String {
    let mut value = base.trim().trim_end_matches('/').to_string();
    let known_suffixes = ["/chat/completions", "/responses", "/messages", "/models"];

    loop {
        let lower = value.to_ascii_lowercase();
        let Some(suffix) = known_suffixes
            .iter()
            .find(|suffix| lower.ends_with(**suffix))
        else {
            break;
        };
        let next_len = value.len().saturating_sub(suffix.len());
        value.truncate(next_len);
        value = value.trim_end_matches('/').to_string();
    }

    value
}

fn segment_is_api_version(segment: &str) -> bool {
    let segment = segment.to_ascii_lowercase();
    let Some(rest) = segment.strip_prefix('v') else {
        return false;
    };

    let digits_len = rest.chars().take_while(|ch| ch.is_ascii_digit()).count();
    if digits_len == 0 {
        return false;
    }

    let tail = &rest[digits_len..];
    tail.is_empty() || tail == "beta" || tail == "alpha"
}

fn base_url_has_version_segment(base: &str) -> bool {
    let without_query = base
        .split(['?', '#'])
        .next()
        .unwrap_or(base)
        .trim_end_matches('/');
    let after_scheme = without_query
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(without_query);
    let Some((_, path)) = after_scheme.split_once('/') else {
        return false;
    };

    path.split('/').any(segment_is_api_version)
}

fn api_base_url(channel: &Channel) -> String {
    strip_known_api_endpoint_suffix(&normalized_base_url(channel))
}

fn api_url(channel: &Channel, endpoint: &str) -> String {
    let base = api_base_url(channel);
    let endpoint = endpoint.trim_start_matches('/');
    if base_url_has_version_segment(&base) {
        format!("{}/{}", base, endpoint)
    } else {
        format!("{}/v1/{}", base, endpoint)
    }
}

fn model_list_url(channel: &Channel) -> String {
    api_url(channel, "models")
}

fn chat_url(channel: &Channel) -> String {
    match channel.protocol {
        ChannelProtocol::AnthropicMessages => api_url(channel, "messages"),
        ChannelProtocol::OpenAIResponses => api_url(channel, "responses"),
        ChannelProtocol::OpenAIChatCompletions => api_url(channel, "chat/completions"),
    }
}

fn auth_headers(channel: &Channel) -> Vec<(String, String)> {
    match channel.protocol {
        ChannelProtocol::AnthropicMessages => vec![
            ("x-api-key".to_string(), channel.api_key.clone()),
            ("anthropic-version".to_string(), "2023-06-01".to_string()),
        ],
        ChannelProtocol::OpenAIChatCompletions | ChannelProtocol::OpenAIResponses => {
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
        ChannelProtocol::OpenAIChatCompletions => serde_json::json!({
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
        ChannelProtocol::OpenAIChatCompletions => body,
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
        ChannelProtocol::OpenAIChatCompletions => Some(parsed),
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
        "{}bak-agentdeck",
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
        "{}tmp-agentdeck",
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
    provider["name"] = value(format!("AgentDeck - {}", channel.name));
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
    if let Ok(channels) = read_channels_from_db() {
        state.pool.replace_all(channels);
    }
    state.pool.list()
}

#[derive(Debug, Deserialize)]
pub struct AddChannelRequest {
    pub name: String,
    pub service_provider: Option<String>,
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
        service_provider: req.service_provider.unwrap_or_else(|| "custom".into()),
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
        ch.service_provider = req.service_provider.unwrap_or_else(|| "custom".into());
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
fn get_app_settings() -> AppSettings {
    read_app_settings_with_runtime_status()
}

#[tauri::command]
fn save_app_settings(settings: AppSettings) -> Result<AppSettings, String> {
    let previous = read_app_settings_file();
    let settings = normalize_app_settings(settings);

    if settings.launch_on_startup != previous.launch_on_startup {
        set_auto_launch_enabled(settings.launch_on_startup)?;
    }
    if settings.skip_claude_onboarding != previous.skip_claude_onboarding {
        if settings.skip_claude_onboarding {
            apply_claude_onboarding_skip()?;
        } else {
            clear_claude_onboarding_skip()?;
        }
    }

    write_app_settings_file(&settings)?;
    Ok(read_app_settings_with_runtime_status())
}

#[tauri::command]
fn get_auto_launch_status() -> Result<bool, String> {
    is_auto_launch_enabled()
}

#[tauri::command]
fn set_auto_launch(enabled: bool) -> Result<bool, String> {
    set_auto_launch_enabled(enabled)?;
    is_auto_launch_enabled()
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(target_os = "windows")]
        {
            let _ = window.set_skip_taskbar(false);
        }
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn install_tray(app: &tauri::App) -> Result<(), tauri::Error> {
    let show = MenuItemBuilder::with_id("show_main", "显示 AgentDeck").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&show)
        .separator()
        .item(&quit)
        .build()?;

    let mut builder = TrayIconBuilder::with_id("agentdeck")
        .tooltip("AgentDeck")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show_main" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

#[tauri::command]
fn get_tool_ui_state() -> ToolUiState {
    read_tool_ui_state_file()
}

#[tauri::command]
fn save_tool_ui_state(state: ToolUiState) -> Result<ToolUiState, String> {
    let state = normalize_tool_ui_state(state);
    write_tool_ui_state_file(&state)?;
    Ok(state)
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
        service_provider: "custom".into(),
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
        service_provider: "custom".into(),
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

// -------- Session Management --------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionProvider {
    Codex,
    Claude,
    Antigravity,
    OpenCode,
    OpenClaw,
    Hermes,
}

impl SessionProvider {
    fn id(self) -> &'static str {
        match self {
            SessionProvider::Codex => "codex",
            SessionProvider::Claude => "claude",
            SessionProvider::Antigravity => "antigravity",
            SessionProvider::OpenCode => "opencode",
            SessionProvider::OpenClaw => "openclaw",
            SessionProvider::Hermes => "hermes",
        }
    }

    fn from_id(value: &str) -> Result<Self, String> {
        match value {
            "codex" => Ok(SessionProvider::Codex),
            "claude" => Ok(SessionProvider::Claude),
            "antigravity" | "gemini" => Ok(SessionProvider::Antigravity),
            "opencode" => Ok(SessionProvider::OpenCode),
            "openclaw" => Ok(SessionProvider::OpenClaw),
            "hermes" => Ok(SessionProvider::Hermes),
            other => Err(format!("Unsupported session provider: {other}")),
        }
    }

    fn all() -> Vec<Self> {
        vec![
            SessionProvider::Codex,
            SessionProvider::Claude,
            SessionProvider::Antigravity,
            SessionProvider::OpenCode,
            SessionProvider::OpenClaw,
            SessionProvider::Hermes,
        ]
    }

    fn roots(self) -> Result<Vec<PathBuf>, String> {
        match self {
            SessionProvider::Codex => Ok(vec![
                resolve_codex_home()?.join("sessions"),
                resolve_codex_home()?.join("archived_sessions"),
            ]),
            SessionProvider::Claude => Ok(vec![resolve_claude_home()?.join("projects")]),
            SessionProvider::Antigravity => Ok(vec![user_home_dir()?.join(".gemini").join("tmp")]),
            SessionProvider::OpenCode => Ok(vec![opencode_base_dir()?]),
            SessionProvider::OpenClaw => {
                Ok(vec![user_home_dir()?.join(".openclaw").join("agents")])
            }
            SessionProvider::Hermes => {
                Ok(vec![resolve_hermes_home(&user_home_dir()?).join("sessions")])
            }
        }
    }
}

fn list_sessions_impl(provider_id: Option<String>) -> Result<Vec<SessionMeta>, String> {
    let providers: Vec<SessionProvider> = match provider_id.as_deref() {
        Some("codex") => vec![SessionProvider::Codex],
        Some("claude") => vec![SessionProvider::Claude],
        Some("antigravity") | Some("gemini") => vec![SessionProvider::Antigravity],
        Some("opencode") => vec![SessionProvider::OpenCode],
        Some("openclaw") => vec![SessionProvider::OpenClaw],
        Some("hermes") => vec![SessionProvider::Hermes],
        Some("all") | None => SessionProvider::all(),
        Some(other) => return Err(format!("Unsupported session provider: {other}")),
    };

    let mut sessions = Vec::new();
    for provider in providers {
        match provider {
            SessionProvider::OpenCode => sessions.extend(scan_opencode_sessions()?),
            SessionProvider::Antigravity => sessions.extend(scan_antigravity_sessions()?),
            SessionProvider::OpenClaw => sessions.extend(scan_openclaw_sessions()?),
            SessionProvider::Codex | SessionProvider::Claude | SessionProvider::Hermes => {
                for root in provider.roots()? {
                    let mut files = Vec::new();
                    collect_jsonl_files_with_mtime(&root, &mut files);
                    files.sort_by(|a, b| b.1.cmp(&a.1));
                    for (path, _) in files.into_iter().take(SESSION_FILE_LIMIT_PER_PROVIDER) {
                        if let Some(session) = parse_session_meta(provider, &path) {
                            sessions.push(session);
                        }
                    }
                }
            }
        }
    }

    sessions.sort_by(|a, b| b.updated_at.unwrap_or(0).cmp(&a.updated_at.unwrap_or(0)));
    Ok(sessions)
}

#[tauri::command]
async fn list_sessions(provider_id: Option<String>) -> Result<Vec<SessionMeta>, String> {
    tauri::async_runtime::spawn_blocking(move || list_sessions_impl(provider_id))
        .await
        .map_err(|e| format!("Failed to scan sessions: {}", e))?
}

fn get_session_messages_impl(
    provider_id: String,
    source_path: String,
) -> Result<Vec<SessionMessage>, String> {
    let provider = SessionProvider::from_id(&provider_id)?;
    if provider == SessionProvider::OpenCode && source_path.starts_with("sqlite:") {
        return load_opencode_sqlite_messages(&source_path);
    }
    let source = validate_session_source_path(provider, Path::new(&source_path))?;
    if provider == SessionProvider::Antigravity {
        return load_antigravity_messages(&source);
    }
    load_session_messages(provider, &source)
}

#[tauri::command]
async fn get_session_messages(
    provider_id: String,
    source_path: String,
) -> Result<Vec<SessionMessage>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        get_session_messages_impl(provider_id, source_path)
    })
    .await
    .map_err(|e| format!("Failed to load session messages: {}", e))?
}

fn delete_session_impl(
    provider_id: String,
    session_id: String,
    source_path: String,
) -> Result<bool, String> {
    let provider = SessionProvider::from_id(&provider_id)?;
    if provider == SessionProvider::OpenCode && source_path.starts_with("sqlite:") {
        return delete_opencode_sqlite_session(&session_id, &source_path);
    }
    let source = validate_session_source_path(provider, Path::new(&source_path))?;
    let parsed = if provider == SessionProvider::Antigravity {
        parse_antigravity_session_file(&source)
    } else {
        parse_session_meta(provider, &source)
    }
    .ok_or_else(|| {
        format!(
            "Failed to parse session before delete: {}",
            source.display()
        )
    })?;
    if parsed.session_id != session_id {
        return Err(format!(
            "Session id mismatch: expected {}, found {}",
            session_id, parsed.session_id
        ));
    }

    if provider == SessionProvider::Claude {
        if let Some(stem) = source.file_stem() {
            let sidecar = source.parent().unwrap_or_else(|| Path::new("")).join(stem);
            remove_session_sidecar_if_exists(&sidecar).map_err(|e| {
                format!(
                    "Failed to delete Claude session sidecar {}: {}",
                    sidecar.display(),
                    e
                )
            })?;
        }
    }

    fs::remove_file(&source)
        .map_err(|e| format!("Failed to delete session file {}: {}", source.display(), e))?;
    Ok(true)
}

#[tauri::command]
async fn delete_session(
    provider_id: String,
    session_id: String,
    source_path: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        delete_session_impl(provider_id, session_id, source_path)
    })
    .await
    .map_err(|e| format!("Failed to delete session: {}", e))?
}

#[tauri::command]
async fn launch_session_terminal(command: String, cwd: Option<String>) -> Result<bool, String> {
    let command = command.trim().to_string();
    if command.is_empty() {
        return Err("恢复命令不能为空".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let cwd = cwd
            .map(|value| value.trim().trim_matches('"').to_string())
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);

        #[cfg(target_os = "windows")]
        {
            let mut args = vec!["/C".to_string(), "start".to_string(), "".to_string()];
            if let Some(dir) = cwd.as_ref().filter(|dir| dir.is_dir()) {
                args.push("/D".to_string());
                args.push(dir.display().to_string());
            }
            args.push("cmd".to_string());
            args.push("/K".to_string());
            args.push(command);
            std::process::Command::new("cmd")
                .args(args)
                .spawn()
                .map_err(|e| format!("Failed to launch terminal: {}", e))?;
            Ok(true)
        }

        #[cfg(target_os = "macos")]
        {
            let script = if let Some(dir) = cwd.as_ref().filter(|dir| dir.is_dir()) {
                format!(
                    "tell application \"Terminal\" to do script \"cd {} && {}\"",
                    dir.display().to_string().replace('"', "\\\""),
                    command.replace('"', "\\\"")
                )
            } else {
                format!(
                    "tell application \"Terminal\" to do script \"{}\"",
                    command.replace('"', "\\\"")
                )
            };
            std::process::Command::new("osascript")
                .arg("-e")
                .arg(script)
                .spawn()
                .map_err(|e| format!("Failed to launch terminal: {}", e))?;
            Ok(true)
        }

        #[cfg(all(unix, not(target_os = "macos")))]
        {
            let mut shell_cmd = std::process::Command::new("sh");
            shell_cmd.arg("-lc").arg(command);
            if let Some(dir) = cwd.as_ref().filter(|dir| dir.is_dir()) {
                shell_cmd.current_dir(dir);
            }
            shell_cmd
                .spawn()
                .map_err(|e| format!("Failed to launch terminal: {}", e))?;
            Ok(true)
        }
    })
    .await
    .map_err(|e| format!("Failed to join terminal task: {}", e))?
}

fn opencode_base_dir() -> Result<PathBuf, String> {
    if let Some(raw) = std::env::var_os("XDG_DATA_HOME") {
        if !raw.is_empty() {
            return Ok(PathBuf::from(raw).join("opencode"));
        }
    }
    Ok(user_home_dir()?
        .join(".local")
        .join("share")
        .join("opencode"))
}

fn opencode_db_path() -> Result<PathBuf, String> {
    Ok(std::env::var_os("OPENCODE_DB")
        .map(PathBuf::from)
        .filter(|value| !value.as_os_str().is_empty())
        .unwrap_or(opencode_base_dir()?.join("opencode.db")))
}

fn opencode_sqlite_source(db_path: &Path, session_id: &str) -> String {
    format!("sqlite:{}#{}", db_path.display(), session_id)
}

fn parse_opencode_sqlite_source(source: &str) -> Option<(PathBuf, String)> {
    let rest = source.strip_prefix("sqlite:")?;
    let sep = rest.rfind('#')?;
    let session_id = rest[sep + 1..].trim().to_string();
    if session_id.is_empty() {
        return None;
    }
    Some((PathBuf::from(&rest[..sep]), session_id))
}

fn scan_opencode_sessions() -> Result<Vec<SessionMeta>, String> {
    let db_path = opencode_db_path()?;
    if !db_path.exists() {
        return Ok(Vec::new());
    }
    let conn = Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| {
        format!(
            "Failed to open OpenCode database {}: {}",
            db_path.display(),
            e
        )
    })?;

    let mut stmt = conn
        .prepare("SELECT id, title, directory, time_created, time_updated FROM session ORDER BY time_updated DESC LIMIT ?1")
        .map_err(|e| format!("Failed to prepare OpenCode session query: {}", e))?;
    let rows = stmt
        .query_map([SESSION_FILE_LIMIT_PER_PROVIDER as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, Option<i64>>(4)?,
            ))
        })
        .map_err(|e| format!("Failed to query OpenCode sessions: {}", e))?;

    let mut sessions = Vec::new();
    for row in rows.flatten() {
        let (session_id, title, directory, created_at, updated_at) = row;
        let title = title
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                directory
                    .as_deref()
                    .and_then(path_basename)
                    .map(ToString::to_string)
            })
            .unwrap_or_else(|| session_id.clone());
        let message_count = conn
            .query_row(
                "SELECT COUNT(*) FROM message WHERE session_id = ?1",
                [session_id.as_str()],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
            .max(0) as usize;
        sessions.push(SessionMeta {
            provider_id: SessionProvider::OpenCode.id().to_string(),
            session_id: session_id.clone(),
            title: truncate_summary(&title, 90),
            model: None,
            project_dir: directory.filter(|value| !value.trim().is_empty()),
            created_at,
            updated_at: updated_at.or(created_at),
            message_count,
            source_path: opencode_sqlite_source(&db_path, &session_id),
        });
    }
    Ok(sessions)
}

fn load_opencode_sqlite_messages(source: &str) -> Result<Vec<SessionMessage>, String> {
    let (db_path, session_id) = parse_opencode_sqlite_source(source)
        .ok_or_else(|| format!("Invalid OpenCode SQLite source: {source}"))?;
    let expected = opencode_db_path()?
        .canonicalize()
        .map_err(|e| format!("Failed to resolve OpenCode database: {}", e))?;
    let db_path = db_path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve OpenCode source database: {}", e))?;
    if db_path != expected {
        return Err("OpenCode SQLite source is outside the configured database".into());
    }
    let conn = Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Failed to open OpenCode database: {}", e))?;

    let mut part_stmt = conn
        .prepare(
            "SELECT message_id, data FROM part WHERE session_id = ?1 ORDER BY time_created ASC",
        )
        .map_err(|e| format!("Failed to prepare OpenCode part query: {}", e))?;
    let part_rows = part_stmt
        .query_map([session_id.as_str()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("Failed to query OpenCode parts: {}", e))?;
    let mut parts: std::collections::BTreeMap<String, Vec<String>> =
        std::collections::BTreeMap::new();
    for row in part_rows.flatten() {
        parts.entry(row.0).or_default().push(row.1);
    }

    let mut msg_stmt = conn
        .prepare("SELECT id, time_created, data FROM message WHERE session_id = ?1 ORDER BY time_created ASC LIMIT ?2")
        .map_err(|e| format!("Failed to prepare OpenCode message query: {}", e))?;
    let msg_rows = msg_stmt
        .query_map(
            params![session_id.as_str(), SESSION_MESSAGES_LIMIT as i64],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .map_err(|e| format!("Failed to query OpenCode messages: {}", e))?;

    let mut messages = Vec::new();
    for row in msg_rows.flatten() {
        let (message_id, ts, data) = row;
        let value: Value = serde_json::from_str(&data).unwrap_or(Value::Null);
        let role = value
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let content = parts
            .get(&message_id)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|raw| serde_json::from_str::<Value>(raw).ok())
                    .map(|value| extract_json_text(&value))
                    .filter(|text| !text.trim().is_empty())
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default();
        if content.trim().is_empty() {
            continue;
        }
        messages.push(SessionMessage {
            role,
            content: truncate_summary(&content, SESSION_MESSAGE_MAX_CHARS),
            ts,
        });
    }
    Ok(messages)
}

fn delete_opencode_sqlite_session(session_id: &str, source: &str) -> Result<bool, String> {
    let (db_path, source_session_id) = parse_opencode_sqlite_source(source)
        .ok_or_else(|| format!("Invalid OpenCode SQLite source: {source}"))?;
    if source_session_id != session_id {
        return Err(format!(
            "OpenCode session id mismatch: expected {}, found {}",
            session_id, source_session_id
        ));
    }
    let expected = opencode_db_path()?
        .canonicalize()
        .map_err(|e| format!("Failed to resolve OpenCode database: {}", e))?;
    let db_path = db_path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve OpenCode source database: {}", e))?;
    if db_path != expected {
        return Err("OpenCode SQLite source is outside the configured database".into());
    }
    let mut conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open OpenCode database: {}", e))?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to begin OpenCode delete transaction: {}", e))?;
    tx.execute("DELETE FROM part WHERE session_id = ?1", [session_id])
        .map_err(|e| format!("Failed to delete OpenCode parts: {}", e))?;
    tx.execute("DELETE FROM message WHERE session_id = ?1", [session_id])
        .map_err(|e| format!("Failed to delete OpenCode messages: {}", e))?;
    let deleted = tx
        .execute("DELETE FROM session WHERE id = ?1", [session_id])
        .map_err(|e| format!("Failed to delete OpenCode session: {}", e))?;
    tx.commit()
        .map_err(|e| format!("Failed to commit OpenCode delete: {}", e))?;
    Ok(deleted > 0)
}

fn scan_antigravity_sessions() -> Result<Vec<SessionMeta>, String> {
    let root = user_home_dir()?.join(".gemini").join("tmp");
    let mut files = Vec::new();
    collect_json_files_with_mtime(&root, &mut files);
    files.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(files
        .into_iter()
        .take(SESSION_FILE_LIMIT_PER_PROVIDER)
        .filter_map(|(path, _)| parse_antigravity_session_file(&path))
        .collect())
}

fn parse_antigravity_session_file(path: &Path) -> Option<SessionMeta> {
    let content = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&content).ok()?;
    let session_id = value
        .get("sessionId")
        .or_else(|| value.get("id"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| {
            path.file_stem()
                .and_then(|v| v.to_str())
                .map(ToString::to_string)
        })?;
    let messages = value.get("messages").and_then(Value::as_array);
    let first_user = messages.and_then(|items| {
        items
            .iter()
            .find(|item| item.get("type").and_then(Value::as_str) == Some("user"))
            .and_then(|item| item.get("content"))
            .map(extract_json_text)
            .filter(|text| !text.trim().is_empty())
    });
    let title = first_user
        .or_else(|| {
            path.parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.file_name())
                .and_then(|name| name.to_str())
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| session_id.clone());
    Some(SessionMeta {
        provider_id: SessionProvider::Antigravity.id().to_string(),
        session_id,
        title: truncate_summary(&title, 90),
        model: value
            .get("model")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        project_dir: path
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.display().to_string()),
        created_at: value
            .get("startTime")
            .or_else(|| value.get("createdAt"))
            .and_then(parse_timestamp_millis)
            .or_else(|| file_created_millis(path)),
        updated_at: value
            .get("lastUpdated")
            .or_else(|| value.get("updatedAt"))
            .and_then(parse_timestamp_millis)
            .or_else(|| file_modified_millis(path)),
        message_count: messages.map(|items| items.len()).unwrap_or(0),
        source_path: path.to_string_lossy().to_string(),
    })
}

fn load_antigravity_messages(path: &Path) -> Result<Vec<SessionMessage>, String> {
    let content = fs::read_to_string(path).map_err(|e| {
        format!(
            "Failed to read Antigravity session {}: {}",
            path.display(),
            e
        )
    })?;
    let value: Value = serde_json::from_str(&content).map_err(|e| {
        format!(
            "Failed to parse Antigravity session {}: {}",
            path.display(),
            e
        )
    })?;
    let mut messages = Vec::new();
    if let Some(items) = value.get("messages").and_then(Value::as_array) {
        for item in items.iter().take(SESSION_MESSAGES_LIMIT) {
            let role = match item.get("type").and_then(Value::as_str) {
                Some("gemini") => "assistant",
                Some("user") => "user",
                Some("error") => "system",
                Some("info") => continue,
                Some(other) => other,
                None => continue,
            };
            let mut content = item
                .get("content")
                .map(extract_json_text)
                .unwrap_or_default();
            if let Some(calls) = item.get("toolCalls").and_then(Value::as_array) {
                for call in calls {
                    if let Some(name) = call.get("name").and_then(Value::as_str) {
                        if !content.is_empty() {
                            content.push('\n');
                        }
                        content.push_str(&format!("[Tool: {name}]"));
                    }
                }
            }
            if content.trim().is_empty() {
                continue;
            }
            messages.push(SessionMessage {
                role: role.to_string(),
                content: truncate_summary(&content, SESSION_MESSAGE_MAX_CHARS),
                ts: item.get("timestamp").and_then(parse_timestamp_millis),
            });
        }
    }
    Ok(messages)
}

fn scan_openclaw_sessions() -> Result<Vec<SessionMeta>, String> {
    let root = user_home_dir()?.join(".openclaw").join("agents");
    let mut files = Vec::new();
    collect_jsonl_files_with_mtime(&root, &mut files);
    files.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(files
        .into_iter()
        .take(SESSION_FILE_LIMIT_PER_PROVIDER)
        .filter(|(path, _)| {
            path.parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                == Some("sessions")
        })
        .filter_map(|(path, _)| parse_session_meta(SessionProvider::OpenClaw, &path))
        .collect())
}

fn collect_jsonl_files_with_mtime(root: &Path, files: &mut Vec<(PathBuf, i64)>) {
    if !root.exists() {
        return;
    }

    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files_with_mtime(&path, files);
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
            let modified = entry
                .metadata()
                .ok()
                .and_then(|meta| meta.modified().ok())
                .and_then(system_time_millis)
                .unwrap_or(0);
            files.push((path, modified));
        }
    }
}

fn collect_json_files_with_mtime(root: &Path, files: &mut Vec<(PathBuf, i64)>) {
    if !root.exists() {
        return;
    }

    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_json_files_with_mtime(&path, files);
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("json") {
            let modified = entry
                .metadata()
                .ok()
                .and_then(|meta| meta.modified().ok())
                .and_then(system_time_millis)
                .unwrap_or(0);
            files.push((path, modified));
        }
    }
}

fn validate_session_source_path(
    provider: SessionProvider,
    source_path: &Path,
) -> Result<PathBuf, String> {
    let source = source_path.canonicalize().map_err(|e| {
        format!(
            "Failed to resolve session source {}: {}",
            source_path.display(),
            e
        )
    })?;

    for root in provider.roots()? {
        if !root.exists() {
            continue;
        }
        let root = root
            .canonicalize()
            .map_err(|e| format!("Failed to resolve session root {}: {}", root.display(), e))?;
        if source.starts_with(&root) {
            return Ok(source);
        }
    }

    Err(format!(
        "Session source path is outside {} session roots: {}",
        provider.id(),
        source_path.display()
    ))
}

fn parse_session_meta(provider: SessionProvider, path: &Path) -> Option<SessionMeta> {
    if provider == SessionProvider::Claude
        && path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.starts_with("agent-"))
            .unwrap_or(false)
    {
        return None;
    }

    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);
    let mut session_id: Option<String> = None;
    let mut model: Option<String> = None;
    let mut project_dir: Option<String> = None;
    let mut first_user_message: Option<String> = None;
    let mut last_message: Option<String> = None;
    let mut message_count = 0usize;
    let mut bytes_seen = 0usize;

    for line in reader
        .lines()
        .map_while(Result::ok)
        .take(SESSION_META_PARSE_MAX_LINES)
    {
        bytes_seen += line.len();
        if bytes_seen > SESSION_META_PARSE_MAX_BYTES {
            break;
        }
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let value: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => continue,
        };

        match provider {
            SessionProvider::Codex => collect_codex_session_meta(
                &value,
                &mut session_id,
                &mut model,
                &mut project_dir,
                &mut first_user_message,
                &mut last_message,
                &mut message_count,
            ),
            SessionProvider::Claude => collect_claude_session_meta(
                &value,
                &mut session_id,
                &mut model,
                &mut project_dir,
                &mut first_user_message,
                &mut last_message,
                &mut message_count,
            ),
            SessionProvider::Hermes | SessionProvider::OpenClaw => {
                collect_generic_jsonl_session_meta(
                    &value,
                    &mut session_id,
                    &mut model,
                    &mut project_dir,
                    &mut first_user_message,
                    &mut last_message,
                    &mut message_count,
                )
            }
            SessionProvider::Antigravity | SessionProvider::OpenCode => {}
        }
    }

    let session_id = session_id.or_else(|| infer_session_id_from_filename(provider, path))?;
    let title = first_user_message
        .or_else(|| {
            project_dir
                .as_deref()
                .and_then(path_basename)
                .map(ToString::to_string)
        })
        .or_else(|| last_message.clone())
        .unwrap_or_else(|| session_id.clone());
    let updated_at = file_modified_millis(path);
    let created_at = file_created_millis(path).or(updated_at);

    Some(SessionMeta {
        provider_id: provider.id().to_string(),
        session_id,
        title: truncate_summary(&title, 90),
        model,
        project_dir,
        created_at,
        updated_at,
        message_count,
        source_path: path.to_string_lossy().to_string(),
    })
}

#[allow(clippy::too_many_arguments)]
fn collect_generic_jsonl_session_meta(
    value: &Value,
    session_id: &mut Option<String>,
    model: &mut Option<String>,
    project_dir: &mut Option<String>,
    first_user_message: &mut Option<String>,
    last_message: &mut Option<String>,
    message_count: &mut usize,
) {
    let event_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if event_type == "session" || event_type == "init" {
        if session_id.is_none() {
            *session_id = value
                .get("id")
                .or_else(|| value.get("sessionId"))
                .and_then(Value::as_str)
                .map(ToString::to_string);
        }
        if project_dir.is_none() {
            *project_dir = value
                .get("cwd")
                .or_else(|| value.get("directory"))
                .and_then(Value::as_str)
                .map(ToString::to_string);
        }
        if model.is_none() {
            *model = value
                .get("model")
                .and_then(Value::as_str)
                .map(ToString::to_string);
        }
        if first_user_message.is_none() {
            if let Some(title) = value
                .get("title")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                *first_user_message = Some(title.to_string());
            }
        }
        return;
    }

    if let Some(message) = generic_jsonl_message_from_value(value) {
        *message_count += 1;
        if !message.content.trim().is_empty() {
            *last_message = Some(message.content.clone());
        }
        if first_user_message.is_none() && message.role == "user" {
            if let Some(title) = real_user_title_candidate(&message.content) {
                *first_user_message = Some(title);
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn collect_codex_session_meta(
    value: &Value,
    session_id: &mut Option<String>,
    model: &mut Option<String>,
    project_dir: &mut Option<String>,
    first_user_message: &mut Option<String>,
    last_message: &mut Option<String>,
    message_count: &mut usize,
) {
    if value.get("type").and_then(Value::as_str) == Some("session_meta") {
        if let Some(payload) = value.get("payload") {
            if session_id.is_none() {
                *session_id = payload
                    .get("id")
                    .and_then(Value::as_str)
                    .map(ToString::to_string);
            }
            if project_dir.is_none() {
                *project_dir = payload
                    .get("cwd")
                    .and_then(Value::as_str)
                    .map(ToString::to_string);
            }
            if model.is_none() {
                *model = payload
                    .get("model")
                    .or_else(|| payload.get("model_provider"))
                    .and_then(Value::as_str)
                    .map(ToString::to_string);
            }
        }
        return;
    }

    if value.get("type").and_then(Value::as_str) != Some("response_item") {
        return;
    }
    let Some(payload) = value.get("payload") else {
        return;
    };
    let payload_type = payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if payload_type != "message"
        && payload_type != "function_call"
        && payload_type != "function_call_output"
    {
        return;
    }

    if let Some(message) = codex_message_from_payload(payload) {
        *message_count += 1;
        if !message.content.trim().is_empty() {
            *last_message = Some(message.content.clone());
        }
        if first_user_message.is_none() && message.role == "user" {
            if let Some(title) = real_user_title_candidate(&message.content) {
                *first_user_message = Some(title);
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn collect_claude_session_meta(
    value: &Value,
    session_id: &mut Option<String>,
    model: &mut Option<String>,
    project_dir: &mut Option<String>,
    first_user_message: &mut Option<String>,
    last_message: &mut Option<String>,
    message_count: &mut usize,
) {
    if value.get("isMeta").and_then(Value::as_bool) == Some(true) {
        return;
    }
    if session_id.is_none() {
        *session_id = value
            .get("sessionId")
            .and_then(Value::as_str)
            .map(ToString::to_string);
    }
    if project_dir.is_none() {
        *project_dir = value
            .get("cwd")
            .and_then(Value::as_str)
            .map(ToString::to_string);
    }
    if model.is_none() {
        *model = value
            .get("model")
            .and_then(Value::as_str)
            .map(ToString::to_string);
    }

    if value.get("type").and_then(Value::as_str) == Some("custom-title") {
        if let Some(title) = value
            .get("customTitle")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            *first_user_message = Some(title.to_string());
        }
        return;
    }

    let Some(message) = value.get("message") else {
        return;
    };
    let role = message
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let content = message
        .get("content")
        .map(extract_json_text)
        .unwrap_or_default();
    if content.trim().is_empty() {
        return;
    }

    *message_count += 1;
    *last_message = Some(content.clone());
    if first_user_message.is_none() && role == "user" {
        if let Some(title) = real_user_title_candidate(&content) {
            *first_user_message = Some(title);
        }
    }
}

fn load_session_messages(
    provider: SessionProvider,
    path: &Path,
) -> Result<Vec<SessionMessage>, String> {
    let file = fs::File::open(path)
        .map_err(|e| format!("Failed to read session file {}: {}", path.display(), e))?;
    let reader = BufReader::new(file);
    let mut messages = Vec::new();

    for line in reader.lines().map_while(Result::ok) {
        let value: Value = match serde_json::from_str(line.trim()) {
            Ok(value) => value,
            Err(_) => continue,
        };

        let mut item = match provider {
            SessionProvider::Codex => codex_message_from_value(&value),
            SessionProvider::Claude => claude_message_from_value(&value),
            SessionProvider::Hermes | SessionProvider::OpenClaw => {
                generic_jsonl_message_from_value(&value)
            }
            SessionProvider::Antigravity | SessionProvider::OpenCode => None,
        };

        if let Some(item) = item.as_mut() {
            if item.content.trim().is_empty() {
                continue;
            }
            item.content = truncate_summary(&item.content, SESSION_MESSAGE_MAX_CHARS);
            messages.push(item.clone());
            if messages.len() >= SESSION_MESSAGES_LIMIT {
                break;
            }
        }
    }

    Ok(messages)
}

fn generic_jsonl_message_from_value(value: &Value) -> Option<SessionMessage> {
    let (role_value, content_value, ts_value) =
        if value.get("type").and_then(Value::as_str) == Some("message") {
            let message = value.get("message")?;
            (
                message.get("role"),
                message.get("content"),
                value.get("timestamp").or_else(|| message.get("ts")),
            )
        } else {
            (
                value.get("role"),
                value.get("content"),
                value.get("timestamp").or_else(|| value.get("ts")),
            )
        };

    let role = role_value.and_then(Value::as_str)?.to_string();
    let role = if role == "toolResult" {
        "tool".to_string()
    } else {
        role
    };
    let content = content_value.map(extract_json_text).unwrap_or_default();
    if content.trim().is_empty() {
        return None;
    }
    Some(SessionMessage {
        role,
        content,
        ts: ts_value.and_then(parse_timestamp_millis),
    })
}

fn codex_message_from_value(value: &Value) -> Option<SessionMessage> {
    if value.get("type").and_then(Value::as_str) != Some("response_item") {
        return None;
    }
    let payload = value.get("payload")?;
    let mut message = codex_message_from_payload(payload)?;
    message.ts = value.get("timestamp").and_then(parse_timestamp_millis);
    Some(message)
}

fn codex_message_from_payload(payload: &Value) -> Option<SessionMessage> {
    match payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
    {
        "message" => Some(SessionMessage {
            role: payload
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string(),
            content: payload
                .get("content")
                .map(extract_json_text)
                .unwrap_or_default(),
            ts: None,
        }),
        "function_call" => Some(SessionMessage {
            role: "assistant".into(),
            content: format!(
                "[Tool: {}]",
                payload
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
            ),
            ts: None,
        }),
        "function_call_output" => Some(SessionMessage {
            role: "tool".into(),
            content: payload
                .get("output")
                .map(extract_json_text)
                .unwrap_or_default(),
            ts: None,
        }),
        _ => None,
    }
}

fn claude_message_from_value(value: &Value) -> Option<SessionMessage> {
    if value.get("isMeta").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let message = value.get("message")?;
    let mut role = message
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    if role == "user" && content_is_all_tool_results(message.get("content")) {
        role = "tool".into();
    }

    Some(SessionMessage {
        role,
        content: message
            .get("content")
            .map(extract_json_text)
            .unwrap_or_default(),
        ts: value.get("timestamp").and_then(parse_timestamp_millis),
    })
}

fn content_is_all_tool_results(content: Option<&Value>) -> bool {
    matches!(content, Some(Value::Array(items)) if !items.is_empty() && items.iter().all(|item| item.get("type").and_then(Value::as_str) == Some("tool_result")))
}

fn extract_json_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        Value::Number(_) | Value::Bool(_) => value.to_string(),
        Value::Array(items) => items
            .iter()
            .map(extract_json_text)
            .filter(|text| !text.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(map) => {
            if let Some(text) = map
                .get("text")
                .or_else(|| map.get("output_text"))
                .or_else(|| map.get("content"))
                .and_then(Value::as_str)
            {
                return text.to_string();
            }

            match map.get("type").and_then(Value::as_str).unwrap_or_default() {
                "tool_use" | "function_call" => format!(
                    "[Tool: {}]",
                    map.get("name").and_then(Value::as_str).unwrap_or("unknown")
                ),
                "tool_result" => map
                    .get("content")
                    .map(extract_json_text)
                    .unwrap_or_else(|| "[Tool result]".into()),
                _ => String::new(),
            }
        }
    }
}

fn real_user_title_candidate(content: &str) -> Option<String> {
    let trimmed = content.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("# AGENTS.md")
        || trimmed.starts_with("<environment_context>")
        || trimmed.contains("<local-command-caveat>")
        || trimmed.starts_with("<command-name>")
    {
        return None;
    }

    Some(trimmed.to_string())
}

fn truncate_summary(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim().replace('\r', "");
    let mut chars = trimmed.chars();
    let short = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{short}...")
    } else {
        short
    }
}

fn path_basename(path: &str) -> Option<&str> {
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .filter(|value| !value.is_empty())
}

fn infer_session_id_from_filename(provider: SessionProvider, path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_string_lossy();
    if provider == SessionProvider::Claude {
        return Some(stem.to_string());
    }

    stem.split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '-')
        .find(|part| part.len() >= 32)
        .map(ToString::to_string)
        .or_else(|| Some(stem.to_string()))
}

fn parse_timestamp_millis(value: &Value) -> Option<i64> {
    if let Some(value) = value.as_i64() {
        return Some(if value < 10_000_000_000 {
            value * 1000
        } else {
            value
        });
    }
    let raw = value.as_str()?.trim();
    if let Ok(value) = raw.parse::<i64>() {
        return Some(if value < 10_000_000_000 {
            value * 1000
        } else {
            value
        });
    }
    chrono::DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

fn file_modified_millis(path: &Path) -> Option<i64> {
    fs::metadata(path)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(system_time_millis)
}

fn file_created_millis(path: &Path) -> Option<i64> {
    fs::metadata(path)
        .ok()
        .and_then(|meta| meta.created().ok())
        .and_then(system_time_millis)
}

fn system_time_millis(time: std::time::SystemTime) -> Option<i64> {
    time.duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as i64)
}

fn remove_session_sidecar_if_exists(path: &Path) -> std::io::Result<()> {
    match fs::metadata(path) {
        Ok(meta) if meta.is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
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
            get_app_settings,
            save_app_settings,
            get_auto_launch_status,
            set_auto_launch,
            get_tool_ui_state,
            save_tool_ui_state,
            apply_channel_to_tool,
            list_extension_locations,
            list_client_runtime_locations,
            detect_client_installations,
            list_mcp_servers,
            upsert_mcp_server,
            delete_mcp_server,
            toggle_mcp_app,
            import_mcp_from_apps,
            get_claude_plugin_status,
            read_claude_plugin_config,
            apply_claude_plugin_config,
            is_claude_plugin_applied,
            apply_claude_onboarding_skip,
            clear_claude_onboarding_skip,
            list_managed_skills,
            toggle_skill_app,
            import_skill_from_path,
            search_skills_sh,
            install_skill_from_git,
            set_channel_enabled,
            test_channel,
            api_probe_channel,
            probe_channel,
            chat_forward,
            chat_stream,
            list_sessions,
            get_session_messages,
            delete_session,
            launch_session_terminal,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let settings = read_app_settings_file();
                api.prevent_close();
                if settings.minimize_to_tray_on_close {
                    let _ = window.hide();
                    #[cfg(target_os = "windows")]
                    {
                        let _ = window.set_skip_taskbar(true);
                    }
                } else {
                    window.app_handle().exit(0);
                }
            }
        })
        .setup(|app| {
            load_channels(app.handle(), &app.state::<AppState>().pool);
            install_tray(app)?;

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
            service_provider: "custom".into(),
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
    fn base_url_with_version_prefix_does_not_duplicate_v1() {
        let mut channel = test_channel(ChannelProtocol::OpenAIChatCompletions);

        channel.base_url = "https://sub2api.lir.cc.cd/v1".into();
        assert_eq!(
            chat_url(&channel),
            "https://sub2api.lir.cc.cd/v1/chat/completions"
        );
        assert_eq!(
            model_list_url(&channel),
            "https://sub2api.lir.cc.cd/v1/models"
        );

        channel.base_url = "https://api.iamhc.cn/v1/".into();
        assert_eq!(
            chat_url(&channel),
            "https://api.iamhc.cn/v1/chat/completions"
        );
        assert_eq!(model_list_url(&channel), "https://api.iamhc.cn/v1/models");

        channel.base_url = "https://generativelanguage.googleapis.com/v1beta/openai".into();
        assert_eq!(
            chat_url(&channel),
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
        );

        channel.base_url = "https://api.x.ai/v1".into();
        assert_eq!(chat_url(&channel), "https://api.x.ai/v1/chat/completions");

        channel.base_url = "https://openrouter.ai/api/v1".into();
        assert_eq!(
            chat_url(&channel),
            "https://openrouter.ai/api/v1/chat/completions"
        );

        channel.base_url = "https://api.groq.com/openai/v1".into();
        assert_eq!(
            chat_url(&channel),
            "https://api.groq.com/openai/v1/chat/completions"
        );
    }

    #[test]
    fn full_endpoint_base_url_is_reduced_to_api_base_before_joining() {
        let mut channel = test_channel(ChannelProtocol::OpenAIChatCompletions);
        channel.base_url = "https://api.asxs.top/v1/chat/completions".into();

        assert_eq!(
            chat_url(&channel),
            "https://api.asxs.top/v1/chat/completions"
        );
        assert_eq!(model_list_url(&channel), "https://api.asxs.top/v1/models");
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

        let mut high = test_channel(ChannelProtocol::OpenAIChatCompletions);
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
