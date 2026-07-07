import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteMcpServer,
  getToolUiState,
  importMcpFromApps,
  importSkillFromPath,
  installSkillFromGit,
  listExtensionLocations,
  listManagedSkills,
  listMcpServers,
  saveToolUiState,
  searchSkillsSh,
  toggleMcpApp,
  toggleSkillApp,
  upsertMcpServer,
  type ExtensionLocation,
  type ManagedMcpServer,
  type ManagedSkill,
  type SkillsShSkill,
  type ManualPluginItem,
  type ToolTargetApps,
  type ToolUiState,
} from '../../lib/tauri';
import { Button } from '../shared/Button';
import { Dialog } from '../shared/Dialog';
import { CodexBrandIcon, ClaudeBrandIcon } from '../shared/BrandIcons';
import { DownloadIcon, EditIcon, PlusIcon, RefreshIcon, SaveIcon, TrashIcon, XIcon } from '../shared/ActionIcons';

export type ExtensionKind = 'mcp' | 'skills' | 'plugin';

type TargetApp = keyof ToolTargetApps;

type PluginRow = {
  id: string;
  name: string;
  description: string;
  path: string;
  apps: ToolTargetApps;
  updated_at: number;
  manual?: boolean;
};

type ManualPlugin = ManualPluginItem;

const pageCopy: Record<ExtensionKind, { title: string; eyebrow: string; description: string; empty: string }> = {
  mcp: {
    title: 'MCP 管理',
    eyebrow: 'Claude / Codex',
    description: '统一读取 Claude 与 Codex 的 MCP 配置，开关会同步写回对应工具配置文件。',
    empty: '还没有发现 MCP 服务。点击添加，或从工具配置中导入/刷新。',
  },
  skills: {
    title: 'Skills 管理',
    eyebrow: 'Claude / Codex',
    description: '扫描 Claude 与 Codex 的 Skills 目录，开关会复制/备份并同步到目标工具目录。',
    empty: '还没有发现 Skill。点击导入/添加，选择包含 SKILL.md 的目录。',
  },
  plugin: {
    title: 'Plugin 管理',
    eyebrow: 'Claude / Codex',
    description: '展示 Codex 插件目录和 Claude settings 插件作用域，提供统一的开关、导入和添加入口。',
    empty: '还没有发现 Plugin 条目。点击导入/添加记录一个 Plugin。',
  },
};

const emptyApps: ToolTargetApps = { claude: false, codex: false };
const bothApps: ToolTargetApps = { claude: true, codex: true };

const emptyToolUiState: ToolUiState = { plugin_switches: {}, manual_plugins: [], applied_tool_channel_ids: {}, model_list_cache: {} };

function normalizeToolUiState(state: ToolUiState | null | undefined): ToolUiState {
  return {
    plugin_switches: state?.plugin_switches ?? {},
    manual_plugins: Array.isArray(state?.manual_plugins) ? state.manual_plugins : [],
    applied_tool_channel_ids: state?.applied_tool_channel_ids ?? {},
    model_list_cache: state?.model_list_cache ?? {},
  };
}

function countApps<T extends { apps: ToolTargetApps }>(rows: T[]) {
  return rows.reduce(
    (acc, row) => ({
      claude: acc.claude + (row.apps.claude ? 1 : 0),
      codex: acc.codex + (row.apps.codex ? 1 : 0),
    }),
    { claude: 0, codex: 0 },
  );
}

function visibleRowsForTarget<T extends { apps: ToolTargetApps }>(rows: T[], focusApp: TargetApp | null): T[] {
  if (!focusApp) return rows;
  return rows.filter((row) => row.apps[focusApp]);
}

function AppSwitchButton({ app, enabled, disabled, focused, onToggle }: { app: TargetApp; enabled: boolean; disabled?: boolean; focused?: boolean; onToggle: () => void }) {
  const label = app === 'claude' ? 'Claude' : 'Codex';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      aria-label={`${enabled ? '禁用' : '启用'} ${label}`}
      title={`${label}${enabled ? ' 已启用' : ' 未启用'}`}
      className={`grid h-8 w-8 place-items-center rounded-xl border transition ${
        enabled
          ? app === 'claude'
            ? 'border-orange-500/30 bg-orange-500/15 text-orange-600 shadow-[inset_0_0_0_1px_rgba(249,115,22,0.18)] dark:text-orange-300'
            : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-600 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.18)] dark:text-emerald-300'
          : 'border-base-300 bg-base-200/70 opacity-45 hover:opacity-90'
      } ${focused ? 'ring-2 ring-primary/55 ring-offset-1 ring-offset-base-100' : ''} ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
    >
      {app === 'claude' ? <ClaudeBrandIcon size={16} /> : <CodexBrandIcon size={16} />}
    </button>
  );
}

function AppSwitchGroup({ apps, disabled, focusApp, onToggle }: { apps: ToolTargetApps; disabled?: boolean; focusApp?: TargetApp | null; onToggle: (app: TargetApp, enabled: boolean) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <AppSwitchButton app="claude" enabled={apps.claude} disabled={disabled} focused={focusApp === 'claude'} onToggle={() => onToggle('claude', !apps.claude)} />
      <AppSwitchButton app="codex" enabled={apps.codex} disabled={disabled} focused={focusApp === 'codex'} onToggle={() => onToggle('codex', !apps.codex)} />
    </div>
  );
}

function StatsBar({
  total,
  counts,
  loading,
  onRefresh,
  onImport,
  onAdd,
  refreshTitle = '刷新',
  importTitle = '导入',
  addTitle = '添加',
}: {
  total: number;
  counts: { claude: number; codex: number };
  loading: boolean;
  onRefresh: () => void;
  onImport?: () => void;
  onAdd?: () => void;
  refreshTitle?: string;
  importTitle?: string;
  addTitle?: string;
}) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-xl border border-base-300 bg-base-100/75 px-3 py-2 text-xs text-base-content/60">总计 <b className="text-base-content">{total}</b></span>
        <span className="inline-flex items-center gap-1.5 rounded-xl border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-xs text-orange-600 dark:text-orange-300"><ClaudeBrandIcon size={14} /> {counts.claude}</span>
        <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-300"><CodexBrandIcon size={14} /> {counts.codex}</span>
      </div>
      <div className="flex shrink-0 justify-end gap-2">
        <Button tone="secondary" onClick={onRefresh} disabled={loading} className="btn-square" aria-label={refreshTitle} title={refreshTitle}>
          {loading ? <span className="loading loading-spinner loading-xs" /> : <RefreshIcon />}
        </Button>
        {onImport && <Button tone="secondary" onClick={onImport} disabled={loading} className="btn-square" aria-label={importTitle} title={importTitle}><DownloadIcon /></Button>}
        {onAdd && <Button tone="primary" onClick={onAdd} disabled={loading} className="btn-square" aria-label={addTitle} title={addTitle}><PlusIcon /></Button>}
      </div>
    </div>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-base-300 bg-base-100/60 p-8 text-center text-sm text-base-content/55">{text}</div>;
}

function SourceLocations({ locations }: { locations: ExtensionLocation[] }) {
  return (
    <details className="rounded-2xl border border-base-300 bg-base-100/60">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-base-content">运行时路径</summary>
      <div className="grid gap-2 border-t border-base-300 p-3 xl:grid-cols-2">
        {locations.map((location) => (
          <div key={`${location.target}:${location.path}`} className="rounded-xl border border-base-300 bg-base-200/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-base-content">{location.label}</div>
                <div className="truncate font-mono text-[11px] text-base-content/45">{location.path}</div>
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${location.exists ? 'border-success/25 bg-success/10 text-success' : 'border-base-300 text-base-content/45'}`}>{location.exists ? `${location.entries.length} 项` : '不存在'}</span>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

type McpTransport = 'stdio' | 'http' | 'sse';

function makeEmptyMcp(): ManagedMcpServer {
  return { id: '', name: '', description: '', server: { type: 'stdio', command: '', args: [] }, apps: { ...bothApps }, updated_at: Date.now() };
}

function parseMcpJson(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stringifyMcpSpec(spec: Record<string, unknown>) {
  return JSON.stringify(spec, null, 2);
}

function readObjectText(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? JSON.stringify(value, null, 2) : '';
}

function parseLooseObject(text: string): Record<string, string> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, string>;
  } catch {
    // allow KEY=value lines for env/headers
  }
  return Object.fromEntries(trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const index = line.indexOf('=');
    return index >= 0 ? [line.slice(0, index).trim(), line.slice(index + 1).trim()] : [line, ''];
  }).filter(([key]) => key));
}

function McpPanel({ focusApp, onError }: { focusApp: TargetApp | null; onError: (value: string | null) => void }) {
  const [rows, setRows] = useState<ManagedMcpServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<ManagedMcpServer | null>(null);
  const [jsonText, setJsonText] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    onError(null);
    try { setRows(await listMcpServers()); } catch (err) { onError(String(err)); } finally { setLoading(false); }
  }, [onError]);

  useEffect(() => { void refresh(); }, [refresh]);
  const visibleRows = useMemo(() => visibleRowsForTarget(rows, focusApp), [focusApp, rows]);
  const counts = useMemo(() => countApps(visibleRows), [visibleRows]);

  const openEdit = (row: ManagedMcpServer) => { setEditing(row); setJsonText(JSON.stringify(row.server, null, 2)); };
  const currentSpec = useMemo(() => parseMcpJson(jsonText), [jsonText]);
  const currentType = ((currentSpec.type as string | undefined) ?? 'stdio') as McpTransport;
  const updateSpec = (patch: Record<string, unknown>) => setJsonText(stringifyMcpSpec({ ...currentSpec, ...patch }));
  const setTransport = (type: McpTransport) => {
    if (type === 'stdio') setJsonText(stringifyMcpSpec({ type, command: '', args: [] }));
    else setJsonText(stringifyMcpSpec({ type, url: '', headers: {} }));
  };
  const save = async () => {
    if (!editing) return;
    try {
      const server = JSON.parse(jsonText) as Record<string, unknown>;
      await upsertMcpServer({ ...editing, id: editing.id.trim(), name: editing.name.trim() || editing.id.trim(), server, updated_at: Date.now() });
      setEditing(null);
      await refresh();
    } catch (err) { onError(String(err)); }
  };
  const toggle = async (row: ManagedMcpServer, app: TargetApp, enabled: boolean) => {
    const next = { ...row, apps: { ...row.apps, [app]: enabled }, updated_at: Date.now() };
    setRows((current) => current.map((item) => item.id === row.id ? next : item));
    try { await toggleMcpApp(row.id, app, enabled, next); await refresh(); } catch (err) { onError(String(err)); await refresh(); }
  };
  const remove = async (row: ManagedMcpServer) => {
    try { await deleteMcpServer(row.id); await refresh(); } catch (err) { onError(String(err)); }
  };

  const importFromApps = async () => {
    setLoading(true);
    onError(null);
    try { await importMcpFromApps(); await refresh(); } catch (err) { onError(String(err)); } finally { setLoading(false); }
  };

  return <>
    <StatsBar total={visibleRows.length} counts={counts} loading={loading} onRefresh={refresh} onImport={importFromApps} onAdd={() => openEdit(makeEmptyMcp())} refreshTitle="刷新 MCP" importTitle="从 Claude/Codex 导入" addTitle="添加 MCP 服务" />
    {visibleRows.length === 0 ? <EmptyBlock text={pageCopy.mcp.empty} /> : <div className="overflow-hidden rounded-2xl border border-base-300 bg-base-100/70">
      {visibleRows.map((row, index) => <div key={row.id} className={`group flex items-center gap-3 px-4 py-2.5 transition hover:bg-base-200/70 ${index !== visibleRows.length - 1 ? 'border-b border-base-300' : ''}`}>
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-semibold text-base-content">{row.name || row.id}</span><span className="rounded-md bg-base-200 px-1.5 py-0.5 font-mono text-[10px] text-base-content/50">{row.id}</span></div><div className="truncate text-xs text-base-content/50">{row.description || JSON.stringify(row.server)}</div></div>
        <AppSwitchGroup apps={row.apps} focusApp={focusApp} onToggle={(app, enabled) => void toggle(row, app, enabled)} />
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
          <Button tone="ghost" className="btn-square btn-sm" onClick={() => openEdit(row)} aria-label="编辑" title="编辑"><EditIcon /></Button>
          <Button tone="danger" className="btn-square btn-sm" onClick={() => void remove(row)} aria-label="删除" title="删除"><TrashIcon /></Button>
        </div>
      </div>)}
    </div>}
    <Dialog open={editing !== null} title={editing?.id ? '编辑 MCP 服务' : '添加 MCP 服务'} description="服务定义会按 Claude/Codex 开关写入对应配置。" onClose={() => setEditing(null)} size="lg">
      {editing && <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1.5"><span className="text-xs font-semibold text-base-content/55">ID</span><input className="input input-bordered w-full bg-base-100" value={editing.id} onChange={(e) => setEditing({ ...editing, id: e.target.value })} /></label>
          <label className="space-y-1.5"><span className="text-xs font-semibold text-base-content/55">名称</span><input className="input input-bordered w-full bg-base-100" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
        </div>
        <label className="space-y-1.5"><span className="text-xs font-semibold text-base-content/55">说明</span><input className="input input-bordered w-full bg-base-100" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></label>
        <div className="rounded-2xl border border-base-300 bg-base-200/45 p-3">
          <div className="mb-3 flex flex-wrap gap-2">
            {(['stdio', 'http', 'sse'] as McpTransport[]).map((type) => <button key={type} type="button" onClick={() => setTransport(type)} className={`btn btn-xs rounded-xl ${currentType === type ? 'btn-primary' : 'btn-outline'}`}>{type}</button>)}
          </div>
          {currentType === 'stdio' ? <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5"><span className="text-xs font-semibold text-base-content/55">Command</span><input className="input input-bordered w-full bg-base-100 font-mono" value={String(currentSpec.command ?? '')} onChange={(e) => updateSpec({ command: e.target.value })} placeholder="npx" /></label>
            <label className="space-y-1.5"><span className="text-xs font-semibold text-base-content/55">Args（一行一个）</span><textarea className="textarea textarea-bordered min-h-24 w-full bg-base-100 font-mono text-xs" value={Array.isArray(currentSpec.args) ? currentSpec.args.map(String).join('\n') : ''} onChange={(e) => updateSpec({ args: e.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) })} placeholder={'-y\n@modelcontextprotocol/server-filesystem'} /></label>
            <label className="space-y-1.5 md:col-span-2"><span className="text-xs font-semibold text-base-content/55">Env（JSON 或 KEY=value）</span><textarea className="textarea textarea-bordered min-h-24 w-full bg-base-100 font-mono text-xs" value={readObjectText(currentSpec.env)} onChange={(e) => updateSpec({ env: parseLooseObject(e.target.value) })} placeholder={'{"API_KEY":"..."}'} /></label>
          </div> : <div className="grid gap-3">
            <label className="space-y-1.5"><span className="text-xs font-semibold text-base-content/55">URL</span><input className="input input-bordered w-full bg-base-100 font-mono" value={String(currentSpec.url ?? '')} onChange={(e) => updateSpec({ url: e.target.value })} placeholder="https://example.com/mcp" /></label>
            <label className="space-y-1.5"><span className="text-xs font-semibold text-base-content/55">Headers（JSON 或 KEY=value）</span><textarea className="textarea textarea-bordered min-h-24 w-full bg-base-100 font-mono text-xs" value={readObjectText(currentSpec.headers)} onChange={(e) => updateSpec({ headers: parseLooseObject(e.target.value) })} placeholder={'{"Authorization":"Bearer ..."}'} /></label>
          </div>}
        </div>
        <details className="rounded-2xl border border-base-300 bg-base-100/70">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-base-content/55">高级 JSON</summary>
          <textarea className="textarea textarea-bordered min-h-44 w-full rounded-t-none border-x-0 border-b-0 bg-base-100 font-mono text-xs" value={jsonText} onChange={(e) => setJsonText(e.target.value)} />
        </details>
        <div className="flex items-center justify-between gap-3"><AppSwitchGroup apps={editing.apps} focusApp={focusApp} onToggle={(app, enabled) => setEditing({ ...editing, apps: { ...editing.apps, [app]: enabled } })} /><div className="flex gap-2"><Button tone="ghost" className="btn-square" onClick={() => setEditing(null)} aria-label="取消"><XIcon /></Button><Button tone="primary" className="btn-square" onClick={() => void save()} aria-label="保存"><SaveIcon /></Button></div></div>
      </div>}
    </Dialog>
  </>;
}

function SkillsPanel({ focusApp, onError }: { focusApp: TargetApp | null; onError: (value: string | null) => void }) {
  const [rows, setRows] = useState<ManagedSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importPath, setImportPath] = useState('');
  const [importApps, setImportApps] = useState<ToolTargetApps>({ ...bothApps });
  const [searchOpen, setSearchOpen] = useState(false);
  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [skillSearchResults, setSkillSearchResults] = useState<SkillsShSkill[]>([]);
  const [searchingSkills, setSearchingSkills] = useState(false);
  const [installingSkillKey, setInstallingSkillKey] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    onError(null);
    try { setRows(await listManagedSkills()); } catch (err) { onError(String(err)); } finally { setLoading(false); }
  }, [onError]);
  useEffect(() => { void refresh(); }, [refresh]);
  const visibleRows = useMemo(() => visibleRowsForTarget(rows, focusApp), [focusApp, rows]);
  const counts = useMemo(() => countApps(visibleRows), [visibleRows]);
  const toggle = async (row: ManagedSkill, app: TargetApp, enabled: boolean) => {
    const next = { ...row, apps: { ...row.apps, [app]: enabled }, updated_at: Date.now() };
    setRows((current) => current.map((item) => item.directory === row.directory ? next : item));
    try { await toggleSkillApp(row, app, enabled); await refresh(); } catch (err) { onError(String(err)); await refresh(); }
  };
  const importSkill = async () => {
    try {
      await importSkillFromPath(importPath, importApps);
      setImportOpen(false);
      setImportPath('');
      await refresh();
    } catch (err) { onError(String(err)); }
  };
  const runSkillsSearch = async () => {
    const query = skillSearchQuery.trim();
    if (!query) return;
    setSearchingSkills(true);
    onError(null);
    try {
      const result = await searchSkillsSh(query, 20, 0);
      setSkillSearchResults(result.skills);
    } catch (err) { onError(String(err)); } finally { setSearchingSkills(false); }
  };
  const installRemoteSkill = async (skill: SkillsShSkill) => {
    setInstallingSkillKey(skill.key);
    onError(null);
    try {
      await installSkillFromGit(skill, importApps);
      await refresh();
    } catch (err) { onError(String(err)); } finally { setInstallingSkillKey(null); }
  };
  return <>
    <StatsBar total={visibleRows.length} counts={counts} loading={loading} onRefresh={refresh} onImport={() => setImportOpen(true)} onAdd={() => setSearchOpen(true)} refreshTitle="刷新 Skills" importTitle="导入本地 Skill" addTitle="搜索 skills.sh" />
    {visibleRows.length === 0 ? <EmptyBlock text={pageCopy.skills.empty} /> : <div className="overflow-hidden rounded-2xl border border-base-300 bg-base-100/70">
      {visibleRows.map((row, index) => <div key={row.directory} className={`group flex items-center gap-3 px-4 py-2.5 transition hover:bg-base-200/70 ${index !== visibleRows.length - 1 ? 'border-b border-base-300' : ''}`}>
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-semibold text-base-content">{row.name}</span><span className="rounded-md bg-base-200 px-1.5 py-0.5 font-mono text-[10px] text-base-content/50">{row.directory}</span></div><div className="truncate text-xs text-base-content/50">{row.description || row.source} · {row.path}</div></div>
        <AppSwitchGroup apps={row.apps} focusApp={focusApp} onToggle={(app, enabled) => void toggle(row, app, enabled)} />
      </div>)}
    </div>}
    <Dialog open={searchOpen} title="搜索 skills.sh" description="从 skills.sh 搜索远程 Skill，安装时会 clone GitHub 仓库并复制到选中的 Claude/Codex Skills 目录。" onClose={() => setSearchOpen(false)} size="lg">
      <div className="space-y-3">
        <div className="flex gap-2">
          <input className="input input-bordered w-full bg-base-100" value={skillSearchQuery} onChange={(e) => setSkillSearchQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void runSkillsSearch(); }} placeholder="ui ux / react / tauri / mcp ..." />
          <Button tone="primary" onClick={() => void runSkillsSearch()} disabled={searchingSkills || !skillSearchQuery.trim()}>{searchingSkills ? <span className="loading loading-spinner loading-xs" /> : '搜索'}</Button>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-base-300 bg-base-200/50 p-3"><span className="text-sm font-medium text-base-content">安装到</span><AppSwitchGroup apps={importApps} focusApp={focusApp} onToggle={(app, enabled) => setImportApps({ ...importApps, [app]: enabled })} /></div>
        <div className="max-h-[420px] overflow-auto rounded-2xl border border-base-300 bg-base-100/70">
          {skillSearchResults.length === 0 ? <div className="p-8 text-center text-sm text-base-content/45">输入关键词搜索 skills.sh。</div> : skillSearchResults.map((skill, index) => <div key={skill.key} className={`flex items-center gap-3 px-4 py-3 ${index !== skillSearchResults.length - 1 ? 'border-b border-base-300' : ''}`}>
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-base-content">{skill.name}</div><div className="truncate text-xs text-base-content/50">{skill.repo_owner}/{skill.repo_name} · {skill.directory} · {skill.installs} installs</div></div>
            <Button tone="primary" onClick={() => void installRemoteSkill(skill)} disabled={Boolean(installingSkillKey) || (!importApps.claude && !importApps.codex)}>{installingSkillKey === skill.key ? <span className="loading loading-spinner loading-xs" /> : '安装'}</Button>
          </div>)}
        </div>
      </div>
    </Dialog>
    <Dialog open={importOpen} title="导入 / 添加 Skill" description="填写包含 SKILL.md 的本地目录，AgentDeck 会复制到选中的 Claude/Codex Skills 目录。" onClose={() => setImportOpen(false)}>
      <div className="space-y-3">
        <label className="space-y-1.5"><span className="text-xs font-semibold text-base-content/55">Skill 目录路径</span><input className="input input-bordered w-full bg-base-100 font-mono" placeholder="C:\\Users\\you\\Downloads\\my-skill" value={importPath} onChange={(e) => setImportPath(e.target.value)} /></label>
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-base-300 bg-base-200/50 p-3"><span className="text-sm font-medium text-base-content">安装到</span><AppSwitchGroup apps={importApps} focusApp={focusApp} onToggle={(app, enabled) => setImportApps({ ...importApps, [app]: enabled })} /></div>
        <div className="flex justify-end gap-2"><Button tone="ghost" className="btn-square" onClick={() => setImportOpen(false)} aria-label="取消"><XIcon /></Button><Button tone="primary" className="btn-square" onClick={() => void importSkill()} disabled={!importPath.trim() || (!importApps.claude && !importApps.codex)} aria-label="保存"><SaveIcon /></Button></div>
      </div>
    </Dialog>
  </>;
}


function buildPluginRows(locations: ExtensionLocation[], state: ToolUiState): PluginRow[] {
  const normalized = normalizeToolUiState(state);
  const switches = normalized.plugin_switches;
  const isInternalPluginContainer = (entry: { name: string; path: string }) => {
    const name = entry.name.trim().toLowerCase();
    const path = entry.path.replaceAll('\\', '/').toLowerCase();
    return name === 'cache'
      || name.startsWith('.')
      || path.endsWith('/.codex/plugins/cache')
      || path.includes('/.codex/plugins/.marketplace-plugin-source-staging');
  };
  const scanned = locations.flatMap((location) => {
    // 配置文件只是运行时来源位置，不是 Plugin 条目本身。
    // 例如 ~/.claude/settings.json 应显示在“运行时路径”，不能混进 Plugin 管理列表。
    if (location.is_file) return [];
    const baseApps = { claude: location.target.includes('claude'), codex: location.target.includes('codex') };
    const entries = location.entries.length > 0 ? location.entries : location.exists ? [{ name: location.label, path: location.path, kind: 'dir' }] : [];
    return entries.filter((entry) => entry.kind !== 'file' && !isInternalPluginContainer(entry)).map((entry) => {
      const id = `${location.target}:${entry.path}`;
      return { id, name: entry.name, description: location.label, path: entry.path, apps: switches[id] ?? baseApps, updated_at: Date.now() };
    });
  });
  const manual = normalized.manual_plugins.map((row) => ({ ...row, apps: switches[row.id] ?? row.apps ?? { ...emptyApps }, updated_at: row.updated_at ?? Date.now(), manual: true }));
  return [...manual, ...scanned];
}

function PluginPanel({ locations, focusApp, onError }: { locations: ExtensionLocation[]; focusApp: TargetApp | null; onError: (value: string | null) => void }) {
  const [toolState, setToolState] = useState<ToolUiState>(emptyToolUiState);
  const [rows, setRows] = useState<PluginRow[]>(() => buildPluginRows(locations, emptyToolUiState));
  const [editing, setEditing] = useState<ManualPlugin | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    onError(null);
    try {
      const nextState = normalizeToolUiState(await getToolUiState());
      setToolState(nextState);
      setRows(buildPluginRows(locations, nextState));
    } catch (err) {
      onError(String(err));
    } finally {
      setLoading(false);
    }
  }, [locations, onError]);

  useEffect(() => { void refresh(); }, [refresh]);
  const visibleRows = useMemo(() => visibleRowsForTarget(rows, focusApp), [focusApp, rows]);
  const counts = useMemo(() => countApps(visibleRows), [visibleRows]);
  const openAdd = () => setEditing({ id: '', name: '', description: '', path: '', apps: { ...bothApps }, updated_at: Date.now(), manual: true });

  const persistState = async (nextState: ToolUiState) => {
    const saved = normalizeToolUiState(await saveToolUiState(nextState));
    setToolState(saved);
    setRows(buildPluginRows(locations, saved));
  };

  const toggle = async (row: PluginRow, app: TargetApp, enabled: boolean) => {
    const nextRows = rows.map((item) => item.id === row.id ? { ...item, apps: { ...item.apps, [app]: enabled } } : item);
    setRows(nextRows);
    const next = nextRows.find((item) => item.id === row.id);
    try {
      await persistState({
        ...toolState,
        plugin_switches: next ? { ...toolState.plugin_switches, [row.id]: next.apps } : toolState.plugin_switches,
      });
      onError(null);
    } catch (err) {
      onError(String(err));
      await refresh();
    }
  };

  const saveManual = async () => {
    if (!editing) return;
    const name = editing.name.trim() || editing.path.split(/[\/]/).filter(Boolean).pop() || 'Plugin';
    const path = editing.path.trim();
    const id = editing.id || `manual:${path || name}:${Date.now()}`;
    const next: ManualPlugin = { ...editing, id, name, path, description: editing.description.trim() || '手动导入', updated_at: Date.now(), manual: true };
    const current = toolState.manual_plugins.filter((item) => item.id !== id);
    try {
      await persistState({
        ...toolState,
        plugin_switches: { ...toolState.plugin_switches, [id]: next.apps },
        manual_plugins: [next, ...current],
      });
      setEditing(null);
    } catch (err) {
      onError(String(err));
    }
  };

  const removeManual = async (row: PluginRow) => {
    const nextSwitches = { ...toolState.plugin_switches };
    delete nextSwitches[row.id];
    try {
      await persistState({
        ...toolState,
        plugin_switches: nextSwitches,
        manual_plugins: toolState.manual_plugins.filter((item) => item.id !== row.id),
      });
    } catch (err) {
      onError(String(err));
    }
  };

  return <>
    <StatsBar total={visibleRows.length} counts={counts} loading={loading} onRefresh={() => void refresh()} onImport={openAdd} onAdd={openAdd} refreshTitle="刷新 Plugin" importTitle="导入 Plugin" addTitle="添加 Plugin" />
    {visibleRows.length === 0 ? <EmptyBlock text={pageCopy.plugin.empty} /> : <div className="overflow-hidden rounded-2xl border border-base-300 bg-base-100/70">
      {visibleRows.map((row, index) => <div key={row.id} className={`group flex items-center gap-3 px-4 py-2.5 transition hover:bg-base-200/70 ${index !== visibleRows.length - 1 ? 'border-b border-base-300' : ''}`}>
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-semibold text-base-content">{row.name}</span>{row.manual && <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">手动</span>}</div><div className="truncate text-xs text-base-content/50">{row.description} · {row.path}</div></div>
        <AppSwitchGroup apps={row.apps} disabled={loading} focusApp={focusApp} onToggle={(app, enabled) => void toggle(row, app, enabled)} />
        {row.manual && <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100"><Button tone="danger" className="btn-square btn-sm" onClick={() => void removeManual(row)} aria-label="删除" title="删除"><TrashIcon /></Button></div>}
      </div>)}
    </div>}
    <Dialog open={editing !== null} title="导入 / 添加 Plugin" description="记录 Plugin 路径并设置 Claude/Codex 开关；已存在的工具目录会继续从运行时路径自动导入。" onClose={() => setEditing(null)}>
      {editing && <div className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2"><label className="space-y-1.5"><span className="text-xs font-semibold text-base-content/55">名称</span><input className="input input-bordered w-full bg-base-100" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label><label className="space-y-1.5"><span className="text-xs font-semibold text-base-content/55">路径</span><input className="input input-bordered w-full bg-base-100 font-mono" value={editing.path} onChange={(e) => setEditing({ ...editing, path: e.target.value })} /></label></div>
        <label className="space-y-1.5"><span className="text-xs font-semibold text-base-content/55">说明</span><input className="input input-bordered w-full bg-base-100" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></label>
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-base-300 bg-base-200/50 p-3"><span className="text-sm font-medium text-base-content">启用到</span><AppSwitchGroup apps={editing.apps} focusApp={focusApp} onToggle={(app, enabled) => setEditing({ ...editing, apps: { ...editing.apps, [app]: enabled } })} /></div>
        <div className="flex justify-end gap-2"><Button tone="ghost" className="btn-square" onClick={() => setEditing(null)} aria-label="取消"><XIcon /></Button><Button tone="primary" className="btn-square" onClick={() => void saveManual()} disabled={!editing.name.trim() && !editing.path.trim()} aria-label="保存"><SaveIcon /></Button></div>
      </div>}
    </Dialog>
  </>;
}

interface ExtensionManagementPageProps { kind: ExtensionKind; }

export function ExtensionManagementPage({ kind }: ExtensionManagementPageProps) {
  const copy = pageCopy[kind];
  const [locations, setLocations] = useState<ExtensionLocation[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focusApp: TargetApp | null = null;
  const visibleLocations = locations;

  const refreshLocations = useCallback(async () => {
    setLoadingLocations(true);
    setError(null);
    try { setLocations(await listExtensionLocations(kind)); } catch (err) { setError(String(err)); } finally { setLoadingLocations(false); }
  }, [kind]);

  useEffect(() => { void refreshLocations(); }, [refreshLocations]);

  return <div className="mx-auto max-w-[1800px] space-y-4">
    <section className="rounded-2xl border border-base-300 bg-base-200/70 p-4 shadow-xl">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{copy.eyebrow}</p><h2 className="mt-1 text-xl font-semibold text-base-content">{copy.title}</h2><p className="mt-2 text-sm text-base-content/55">{copy.description}</p><p className="mt-2 text-xs text-base-content/45">本页显示 Claude / Codex 全部条目，不受 Header AppSwitcher 当前 App 影响。</p></div>
        <Button tone="secondary" onClick={() => void refreshLocations()} disabled={loadingLocations} className="btn-square" aria-label="刷新路径" title="刷新路径">{loadingLocations ? <span className="loading loading-spinner loading-xs" /> : <RefreshIcon />}</Button>
      </div>
    </section>
    {error && <div className="rounded-2xl border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</div>}
    {kind === 'mcp' && <McpPanel focusApp={focusApp} onError={setError} />}
    {kind === 'skills' && <SkillsPanel focusApp={focusApp} onError={setError} />}
    {kind === 'plugin' && <PluginPanel locations={visibleLocations} focusApp={focusApp} onError={setError} />}
    <SourceLocations locations={visibleLocations} />
  </div>;
}

