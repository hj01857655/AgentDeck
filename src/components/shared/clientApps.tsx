import { type ReactNode } from 'react';
import type { AppSettings, ClientId, VisibleClients } from '../../lib/tauri';
import {
  AntigravityBrandIcon,
  ClaudeBrandIcon,
  CodexBrandIcon,
  HermesBrandIcon,
  OpenClawBrandIcon,
  OpenCodeBrandIcon,
} from './BrandIcons';

export type ManagedClientTarget = 'claude' | 'codex';

export interface ClientAppDefinition {
  id: ClientId;
  target?: ManagedClientTarget;
  name: string;
  shortName: string;
  description: string;
  defaultVisible: boolean;
}

export const CLIENT_ORDER: ClientId[] = [
  'claude-code',
  'codex',
  'claude-desktop',
  'antigravity',
  'opencode',
  'openclaw',
  'hermes',
];

export const DEFAULT_VISIBLE_CLIENTS: VisibleClients = {
  'claude-code': true,
  codex: true,
  'claude-desktop': false,
  antigravity: false,
  opencode: false,
  openclaw: false,
  hermes: false,
};

export const CLIENT_APPS: ClientAppDefinition[] = [
  {
    id: 'claude-code',
    target: 'claude',
    name: 'Claude Code（CLI）',
    shortName: 'Claude Code',
    description: '管理 Claude Code CLI 会话、MCP、Skills、Plugin 与 AgentDeck 应用状态。',
    defaultVisible: true,
  },
  {
    id: 'codex',
    target: 'codex',
    name: 'Codex',
    shortName: 'Codex',
    description: '管理 Codex 会话、MCP、Skills、Plugin 与 AgentDeck 应用状态。',
    defaultVisible: true,
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    shortName: 'Claude Desktop',
    description: 'Claude Desktop 是独立客户端，不等同于 Claude Code CLI；展示用户级 Desktop 配置路径。',
    defaultVisible: false,
  },
  {
    id: 'antigravity',
    name: 'Antigravity CLI',
    shortName: 'Antigravity',
    description: '展示 Antigravity CLI 用户级配置、环境变量与会话路径。',
    defaultVisible: false,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    shortName: 'OpenCode',
    description: '展示 OpenCode 用户级配置目录、数据目录和数据库路径。',
    defaultVisible: false,
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    shortName: 'OpenClaw',
    description: '展示 OpenClaw 配置、Agents、Workspace 与 Memory 路径。',
    defaultVisible: false,
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    shortName: 'Hermes',
    description: '展示 Hermes Agent 配置、会话、数据库和 Memories 路径。',
    defaultVisible: false,
  },
];

export const APP_SETTINGS_EVENT = 'agentdeck:app-settings-updated';

export function clientIcon(id: ClientId, size = 18, className = ''): ReactNode {
  if (id === 'claude-code' || id === 'claude-desktop') return <ClaudeBrandIcon size={size} className={className} />;
  if (id === 'codex') return <CodexBrandIcon size={size} className={className} />;
  if (id === 'antigravity') return <AntigravityBrandIcon size={size} className={className} />;
  if (id === 'openclaw') return <OpenClawBrandIcon size={size} className={className} />;
  if (id === 'hermes') return <HermesBrandIcon size={size} className={className} />;
  return <OpenCodeBrandIcon size={size} className={className} />;
}

export function getClientApp(id: ClientId): ClientAppDefinition {
  return CLIENT_APPS.find((client) => client.id === id) ?? CLIENT_APPS[0];
}

export function visibleClientIds(value: VisibleClients): ClientId[] {
  return CLIENT_ORDER.filter((id) => value[id]);
}

export function firstVisibleClient(value: VisibleClients): ClientId {
  return visibleClientIds(value)[0] ?? 'claude-code';
}

export function emitAppSettingsUpdated(settings: AppSettings) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<AppSettings>(APP_SETTINGS_EVENT, { detail: settings }));
  }
}
