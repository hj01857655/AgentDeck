import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface Channel {
  id: string;
  name: string;
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

export interface AddChannelRequest {
  name: string;
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

export async function listExtensionLocations(kind: 'mcp' | 'skills' | 'plugin'): Promise<ExtensionLocation[]> {
  return invoke('list_extension_locations', { kind });
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

export async function listManagedSkills(): Promise<ManagedSkill[]> {
  return invoke('list_managed_skills');
}

export async function toggleSkillApp(skill: ManagedSkill, app: keyof ToolTargetApps, enabled: boolean): Promise<SkillToggleResult> {
  return invoke('toggle_skill_app', { skill, app, enabled });
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
