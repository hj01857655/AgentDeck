import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface Channel {
  id: string;
  name: string;
  service_provider: string;
  base_url: string;
  api_key: string;
  models: string[];
  protocol: 'openai-chat-completions' | 'openai-responses' | 'anthropic-messages';
  weight: number;
  enabled: boolean;
  healthy: boolean;
}

export interface TestResult {
  status: number;
  body: string;
  models: string[];
  elapsed_ms: number;
}

export interface ApiProbeResult {
  status: number;
  body: string;
  model: string;
  elapsed_ms: number;
}

export interface Message {
  role: string;
  content: string;
}

export interface ChatResponse {
  status: number;
  channel_name: string;
  body: Record<string, unknown>;
  elapsed_ms: number;
}

export interface StreamEvent {
  event_type: 'delta' | 'done' | 'error';
  data: Record<string, unknown>;
}

export interface SessionMeta {
  provider_id: 'codex' | 'claude' | string;
  session_id: string;
  title: string;
  model?: string | null;
  project_dir?: string | null;
  created_at?: number | null;
  updated_at?: number | null;
  message_count: number;
  source_path: string;
}

export interface SessionMessage {
  role: string;
  content: string;
  ts?: number | null;
}

export interface AddChannelRequest {
  name: string;
  service_provider: string;
  base_url: string;
  api_key: string;
  models: string[];
  protocol: Channel['protocol'];
  weight: number;
}

export interface ConsoleSettings {
  active_provider: Channel['protocol'] | 'all';
  selected_channel_id: string | null;
  default_protocol: Channel['protocol'];
}

export type ClientId = 'claude-code' | 'codex' | 'claude-desktop' | 'antigravity' | 'opencode' | 'openclaw' | 'hermes';
export type VisibleClients = Record<ClientId, boolean>;

export interface AppSettings {
  active_client: ClientId;
  visible_clients: VisibleClients;
  launch_on_startup: boolean;
  minimize_to_tray_on_close: boolean;
  skip_claude_onboarding: boolean;
}

export type ToolSyncTarget = 'codex' | 'claude';

export interface ToolSyncResult {
  target: ToolSyncTarget;
  files: string[];
  backups: string[];
}


export interface ExtensionEntry {
  name: string;
  path: string;
  kind: 'dir' | 'file' | 'other' | string;
}

export interface ExtensionLocation {
  target: string;
  label: string;
  path: string;
  exists: boolean;
  is_file: boolean;
  entries: ExtensionEntry[];
}

export interface ClientInstallation {
  client_id: ClientId;
  name: string;
  command?: string | null;
  installed: boolean;
  version?: string | null;
  path?: string | null;
  source: string;
  error?: string | null;
}

export interface ConfigStatus {
  exists: boolean;
  path: string;
}

export interface ClaudePluginStatus {
  config: ConfigStatus;
  applied: boolean;
  onboarding_skipped: boolean;
}

export async function listExtensionLocations(kind: 'mcp' | 'skills' | 'plugin'): Promise<ExtensionLocation[]> {
  return invoke('list_extension_locations', { kind });
}

export async function listClientRuntimeLocations(clientId: ClientId): Promise<ExtensionLocation[]> {
  return invoke('list_client_runtime_locations', { clientId });
}

export async function detectClientInstallations(clientId: ClientId): Promise<ClientInstallation[]> {
  return invoke('detect_client_installations', { clientId });
}


export interface ToolTargetApps {
  claude: boolean;
  codex: boolean;
}

export interface ManagedMcpServer {
  id: string;
  name: string;
  description: string;
  server: Record<string, unknown>;
  apps: ToolTargetApps;
  updated_at: number;
}

export interface ManagedSkill {
  id: string;
  name: string;
  description: string;
  directory: string;
  path: string;
  source: string;
  apps: ToolTargetApps;
  managed: boolean;
  updated_at: number;
}

export interface SkillToggleResult {
  skill: ManagedSkill;
  files: string[];
  backups: string[];
}

export interface SkillsShSkill {
  key: string;
  name: string;
  directory: string;
  repo_owner: string;
  repo_name: string;
  repo_branch: string;
  installs: number;
  readme_url?: string | null;
}

export interface SkillsShSearchResult {
  skills: SkillsShSkill[];
  total_count: number;
  query: string;
}


export interface ManualPluginItem {
  id: string;
  name: string;
  description: string;
  path: string;
  apps: ToolTargetApps;
  updated_at: number;
  manual: boolean;
}

export interface ModelListCacheEntry {
  models: string[];
  cached_at: number;
}

export interface ToolUiState {
  plugin_switches: Record<string, ToolTargetApps>;
  manual_plugins: ManualPluginItem[];
  applied_tool_channel_ids: Partial<Record<ToolSyncTarget, string>>;
  model_list_cache: Record<string, ModelListCacheEntry>;
}

export async function listMcpServers(): Promise<ManagedMcpServer[]> {
  return invoke('list_mcp_servers');
}

export async function upsertMcpServer(server: ManagedMcpServer): Promise<string[]> {
  return invoke('upsert_mcp_server', { server });
}

export async function deleteMcpServer(id: string): Promise<string[]> {
  return invoke('delete_mcp_server', { id });
}

export async function toggleMcpApp(id: string, app: keyof ToolTargetApps, enabled: boolean, server: ManagedMcpServer): Promise<string[]> {
  return invoke('toggle_mcp_app', { id, app, enabled, server });
}

export async function importMcpFromApps(): Promise<number> {
  return invoke('import_mcp_from_apps');
}

export async function getClaudePluginStatus(): Promise<ClaudePluginStatus> {
  return invoke('get_claude_plugin_status');
}

export async function readClaudePluginConfig(): Promise<string | null> {
  return invoke('read_claude_plugin_config');
}

export async function applyClaudePluginConfig(official: boolean): Promise<boolean> {
  return invoke('apply_claude_plugin_config', { official });
}

export async function applyClaudeOnboardingSkip(): Promise<boolean> {
  return invoke('apply_claude_onboarding_skip');
}

export async function clearClaudeOnboardingSkip(): Promise<boolean> {
  return invoke('clear_claude_onboarding_skip');
}

export async function listManagedSkills(): Promise<ManagedSkill[]> {
  return invoke('list_managed_skills');
}

export async function toggleSkillApp(skill: ManagedSkill, app: keyof ToolTargetApps, enabled: boolean): Promise<SkillToggleResult> {
  return invoke('toggle_skill_app', { skill, app, enabled });
}

export async function importSkillFromPath(sourcePath: string, apps: ToolTargetApps): Promise<SkillToggleResult> {
  return invoke('import_skill_from_path', { sourcePath, apps });
}

export async function searchSkillsSh(query: string, limit = 20, offset = 0): Promise<SkillsShSearchResult> {
  return invoke('search_skills_sh', { query, limit, offset });
}

export async function installSkillFromGit(skill: SkillsShSkill, apps: ToolTargetApps): Promise<SkillToggleResult> {
  return invoke('install_skill_from_git', {
    repoOwner: skill.repo_owner,
    repoName: skill.repo_name,
    repoBranch: skill.repo_branch,
    directory: skill.directory,
    apps,
  });
}

export type SessionProviderId = 'codex' | 'claude' | 'antigravity' | 'opencode' | 'openclaw' | 'hermes';

export async function listSessions(providerId?: SessionProviderId | 'all'): Promise<SessionMeta[]> {
  return invoke('list_sessions', { providerId: providerId ?? 'all' });
}

export async function getSessionMessages(providerId: string, sourcePath: string): Promise<SessionMessage[]> {
  return invoke('get_session_messages', { providerId, sourcePath });
}

export async function deleteSession(providerId: string, sessionId: string, sourcePath: string): Promise<boolean> {
  return invoke('delete_session', { providerId, sessionId, sourcePath });
}

export async function launchSessionTerminal(command: string, cwd?: string | null): Promise<boolean> {
  return invoke('launch_session_terminal', { command, cwd: cwd ?? null });
}

export async function listChannels(): Promise<Channel[]> {
  return invoke('list_channels');
}

export async function addChannel(req: AddChannelRequest): Promise<string> {
  return invoke('add_channel', { req });
}

export async function deleteChannel(id: string): Promise<boolean> {
  return invoke('delete_channel', { id });
}

export async function updateChannel(id: string, req: AddChannelRequest): Promise<boolean> {
  return invoke('update_channel', { id, req });
}

export async function getConsoleSettings(): Promise<ConsoleSettings> {
  return invoke('get_console_settings');
}

export async function saveConsoleSettings(settings: ConsoleSettings): Promise<void> {
  return invoke('save_console_settings', { settings });
}

export async function getAppSettings(): Promise<AppSettings> {
  return invoke('get_app_settings');
}

export async function saveAppSettings(settings: AppSettings): Promise<AppSettings> {
  return invoke('save_app_settings', { settings });
}

export async function getAutoLaunchStatus(): Promise<boolean> {
  return invoke('get_auto_launch_status');
}

export async function setAutoLaunch(enabled: boolean): Promise<boolean> {
  return invoke('set_auto_launch', { enabled });
}


export async function getToolUiState(): Promise<ToolUiState> {
  return invoke('get_tool_ui_state');
}

export async function saveToolUiState(state: ToolUiState): Promise<ToolUiState> {
  return invoke('save_tool_ui_state', { state });
}

export async function applyChannelToTool(id: string, target: ToolSyncTarget): Promise<ToolSyncResult> {
  return invoke('apply_channel_to_tool', { id, target });
}

export async function setChannelEnabled(id: string, enabled: boolean): Promise<boolean> {
  return invoke('set_channel_enabled', { id, enabled });
}

export async function testChannel(
  baseUrl: string,
  apiKey: string,
  protocol: Channel['protocol'] = 'openai-chat-completions',
): Promise<TestResult> {
  return invoke('test_channel', { req: { base_url: baseUrl, api_key: apiKey, protocol } });
}

export async function apiProbeChannel(
  baseUrl: string,
  apiKey: string,
  model: string,
  protocol: Channel['protocol'] = 'openai-chat-completions',
): Promise<ApiProbeResult> {
  return invoke('api_probe_channel', { req: { base_url: baseUrl, api_key: apiKey, protocol, model } });
}

export async function probeChannel(id: string): Promise<TestResult> {
  return invoke('probe_channel', { id });
}

export async function chatForward(req: {
  model: string;
  messages: Message[];
  max_tokens?: number;
  temperature?: number;
  channel_id?: string;
}): Promise<ChatResponse> {
  return invoke('chat_forward', { req });
}

export async function chatStream(
  req: {
    model: string;
    messages: Message[];
    max_tokens?: number;
    temperature?: number;
    channel_id?: string;
  },
  onEvent: (evt: StreamEvent) => void,
): Promise<UnlistenFn> {
  const unlisten = await listen<StreamEvent>('chat-stream-event', (event) => {
    onEvent(event.payload);
  });
  // Fire and forget — events will arrive via listener
  invoke('chat_stream', { req }).catch((e) => {
    onEvent({ event_type: 'error', data: { message: String(e) } });
  });
  return unlisten;
}
