import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteMcpServer,
  listExtensionLocations,
  listManagedSkills,
  listMcpServers,
  toggleMcpApp,
  toggleSkillApp,
  upsertMcpServer,
  type ExtensionLocation,
  type ManagedMcpServer,
  type ManagedSkill,
  type ToolTargetApps,
} from '../../lib/tauri';
import { Button } from '../shared/Button';
import { Dialog } from '../shared/Dialog';
import { CodexBrandIcon, ClaudeBrandIcon } from '../shared/BrandIcons';
import { EditIcon, PlusIcon, RefreshIcon, SaveIcon, TrashIcon, XIcon } from '../shared/ActionIcons';

export type ExtensionKind = 'mcp' | 'skills' | 'plugin';

type TargetApp = keyof ToolTargetApps;

type PluginRow = {
  id: string;
  name: string;
  description: string;
  path: string;
  apps: ToolTargetApps;
  updated_at: number;
};

const pageCopy: Record<ExtensionKind, { title: string; eyebrow: string; description: string; empty: string }> = {
  mcp: {
    title: 'MCP 管理',
    eyebrow: 'Claude / Codex',
    description: '统一读取 Claude 与 Codex 的 MCP 配置，开关会同步写回对应工具配置文件。',
    empty: '还没有发现 MCP 服务。点击添加，或先从工具配置中导入。',
  },
  skills: {
    title: 'Skills 管理',
    eyebrow: 'Claude / Codex',
    description: '扫描 Claude 与 Codex 的 Skills 目录，开关会复制/备份并同步到目标工具目录。',
    empty: '还没有发现 Skill。先安装 Skill，或把包含 SKILL.md 的目录放到 Skills 目录。',
  },
  plugin: {
    title: 'Plugin 管理',
    eyebrow: 'Claude / Codex',
    description: '展示 Codex 插件目录和 Claude settings 插件作用域，使用同一套开关管理入口。',
    empty: '还没有发现 Plugin 条目。',
  },
};

function pluginSwitchStorageKey() {
  return 'agentdeck:plugin-target-switches';
}

function readPluginSwitches(): Record<string, ToolTargetApps> {
  try {
    const raw = window.localStorage.getItem(pluginSwitchStorageKey());
    return raw ? JSON.parse(raw) as Record<string, ToolTargetApps> : {};
  } catch {
    return {};
  }
}

function writePluginSwitches(value: Record<string, ToolTargetApps>) {
  window.localStorage.setItem(pluginSwitchStorageKey(), JSON.stringify(value));
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

function AppSwitchButton({ app, enabled, disabled, onToggle }: { app: TargetApp; enabled: boolean; disabled?: boolean; onToggle: () => void }) {
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
      } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
    >
      {app === 'claude' ? <ClaudeBrandIcon size={16} /> : <CodexBrandIcon size={16} />}
    </button>
  );
}

function AppSwitchGroup({ apps, disabled, onToggle }: { apps: ToolTargetApps; disabled?: boolean; onToggle: (app: TargetApp, enabled: boolean) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <AppSwitchButton app="claude" enabled={apps.claude} disabled={disabled} onToggle={() => onToggle('claude', !apps.claude)} />
      <AppSwitchButton app="codex" enabled={apps.codex} disabled={disabled} onToggle={() => onToggle('codex', !apps.codex)} />
    </div>
  );
}

function StatsBar({ total, counts, loading, onRefresh, onAdd }: { total: number; counts: { claude: number; codex: number }; loading: boolean; onRefresh: () => void; onAdd?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded-xl border border-base-300 bg-base-100/75 px-3 py-2 text-xs text-base-content/60">总计 <b className="text-base-content">{total}</b></span>
      <span className="inline-flex items-center gap-1.5 rounded-xl border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-xs text-orange-600 dark:text-orange-300"><ClaudeBrandIcon size={14} /> {counts.claude}</span>
      <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-300"><CodexBrandIcon size={14} /> {counts.codex}</span>
      <Button tone="secondary" onClick={onRefresh} disabled={loading} className="btn-square" aria-label="刷新" title="刷新">
        {loading ? <span className="loading loading-spinner loading-xs" /> : <RefreshIcon />}
      </Button>
      {onAdd && <Button tone="primary" onClick={onAdd} className="btn-square" aria-label="添加" title="添加"><PlusIcon /></Button>}
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

function makeEmptyMcp(): ManagedMcpServer {
  return {
    id: '',
    name: '',
    description: '',
    server: { type: 'stdio', command: '', args: [] },
    apps: { claude: true, codex: true },
    updated_at: Date.now(),
  };
}

function McpPanel({ onError }: { onError: (value: string | null) => void }) {
  const [rows, setRows] = useState<ManagedMcpServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<ManagedMcpServer | null>(null);
  const [jsonText, setJsonText] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    onError(null);
    try {
      setRows(await listMcpServers());
    } catch (err) {
      onError(String(err));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => { void refresh(); }, [refresh]);
  const counts = useMemo(() => countApps(rows), [rows]);

  const openEdit = (row: ManagedMcpServer) => {
    setEditing(row);
    setJsonText(JSON.stringify(row.server, null, 2));
  };

  const save = async () => {
    if (!editing) return;
    try {
      const server = JSON.parse(jsonText) as Record<string, unknown>;
      await upsertMcpServer({ ...editing, id: editing.id.trim(), name: editing.name.trim() || editing.id.trim(), server, updated_at: Date.now() });
      setEditing(null);
      await refresh();
    } catch (err) {
      onError(String(err));
    }
  };

  const toggle = async (row: ManagedMcpServer, app: TargetApp, enabled: boolean) => {
    const next = { ...row, apps: { ...row.apps, [app]: enabled }, updated_at: Date.now() };
    setRows((current) => current.map((item) => item.id === row.id ? next : item));
    try {
      await toggleMcpApp(row.id, app, enabled, next);
      await refresh();
    } catch (err) {
      onError(String(err));
      await refresh();
    }
  };

  const remove = async (row: ManagedMcpServer) => {
    try {
      await deleteMcpServer(row.id);
      await refresh();
    } catch (err) {
      onError(String(err));
    }
  };

  return (
    <>
      <StatsBar total={rows.length} counts={counts} loading={loading} onRefresh={refresh} onAdd={() => openEdit(makeEmptyMcp())} />
      {rows.length === 0 ? <EmptyBlock text={pageCopy.mcp.empty} /> : (
        <div className="overflow-hidden rounded-2xl border border-base-300 bg-base-100/70">
          {rows.map((row, index) => (
            <div key={row.id} className={`group flex items-center gap-3 px-4 py-2.5 transition hover:bg-base-200/70 ${index !== rows.length - 1 ? 'border-b border-base-300' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-base-content">{row.name || row.id}</span>
                  <span className="rounded-md bg-base-200 px-1.5 py-0.5 font-mono text-[10px] text-base-content/50">{row.id}</span>
                </div>
                <div className="truncate text-xs text-base-content/50">{row.description || JSON.stringify(row.server)}</div>
              </div>
              <AppSwitchGroup apps={row.apps} onToggle={(app, enabled) => void toggle(row, app, enabled)} />
              <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
                <Button tone="ghost" className="btn-square btn-sm" onClick={() => openEdit(row)} aria-label="编辑" title="编辑"><EditIcon /></Button>
                <Button tone="danger" className="btn-square btn-sm" onClick={() => void remove(row)} aria-label="删除" title="删除"><TrashIcon /></Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog open={editing !== null} title={editing?.id ? '编辑 MCP 服务' : '添加 MCP 服务'} description="服务定义会按 Claude/Codex 开关写入对应配置。" onClose={() => setEditing(null)} size="lg">
        {editing && <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5"><span className="text-xs font-semibold text-base-content/55">ID</span><input className="input input-bordered w-full bg-base-100" value={editing.id} onChange={(e) => setEditing({ ...editing, id: e.target.value })} /></label>
            <label className="space-y-1.5"><span className="text-xs font-semibold text-base-content/55">名称</span><input className="input input-bordered w-full bg-base-100" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
          </div>
          <label className="space-y-1.5"><span className="text-xs font-semibold text-base-content/55">说明</span><input className="input input-bordered w-full bg-base-100" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></label>
          <textarea className="textarea textarea-bordered min-h-56 w-full bg-base-100 font-mono text-xs" value={jsonText} onChange={(e) => setJsonText(e.target.value)} />
          <div className="flex items-center justify-between gap-3"><AppSwitchGroup apps={editing.apps} onToggle={(app, enabled) => setEditing({ ...editing, apps: { ...editing.apps, [app]: enabled } })} /><div className="flex gap-2"><Button tone="ghost" className="btn-square" onClick={() => setEditing(null)} aria-label="取消"><XIcon /></Button><Button tone="primary" className="btn-square" onClick={() => void save()} aria-label="保存"><SaveIcon /></Button></div></div>
        </div>}
      </Dialog>
    </>
  );
}

function SkillsPanel({ onError }: { onError: (value: string | null) => void }) {
  const [rows, setRows] = useState<ManagedSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    onError(null);
    try { setRows(await listManagedSkills()); } catch (err) { onError(String(err)); } finally { setLoading(false); }
  }, [onError]);
  useEffect(() => { void refresh(); }, [refresh]);
  const counts = useMemo(() => countApps(rows), [rows]);
  const toggle = async (row: ManagedSkill, app: TargetApp, enabled: boolean) => {
    const next = { ...row, apps: { ...row.apps, [app]: enabled }, updated_at: Date.now() };
    setRows((current) => current.map((item) => item.directory === row.directory ? next : item));
    try { await toggleSkillApp(row, app, enabled); await refresh(); } catch (err) { onError(String(err)); await refresh(); }
  };
  return <>
    <StatsBar total={rows.length} counts={counts} loading={loading} onRefresh={refresh} />
    {rows.length === 0 ? <EmptyBlock text={pageCopy.skills.empty} /> : <div className="overflow-hidden rounded-2xl border border-base-300 bg-base-100/70">
      {rows.map((row, index) => <div key={row.directory} className={`group flex items-center gap-3 px-4 py-2.5 transition hover:bg-base-200/70 ${index !== rows.length - 1 ? 'border-b border-base-300' : ''}`}>
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-semibold text-base-content">{row.name}</span><span className="rounded-md bg-base-200 px-1.5 py-0.5 font-mono text-[10px] text-base-content/50">{row.directory}</span></div><div className="truncate text-xs text-base-content/50">{row.description || row.source} · {row.path}</div></div>
        <AppSwitchGroup apps={row.apps} onToggle={(app, enabled) => void toggle(row, app, enabled)} />
      </div>)}
    </div>}
  </>;
}

function buildPluginRows(locations: ExtensionLocation[]): PluginRow[] {
  const switches = readPluginSwitches();
  return locations.flatMap((location) => {
    const baseApps = { claude: location.target.includes('claude'), codex: location.target.includes('codex') };
    const entries = location.entries.length > 0 ? location.entries : location.exists ? [{ name: location.label, path: location.path, kind: location.is_file ? 'file' : 'dir' }] : [];
    return entries.map((entry) => ({
      id: `${location.target}:${entry.path}`,
      name: entry.name,
      description: location.label,
      path: entry.path,
      apps: switches[`${location.target}:${entry.path}`] ?? baseApps,
      updated_at: Date.now(),
    }));
  });
}

function PluginPanel({ locations, onError }: { locations: ExtensionLocation[]; onError: (value: string | null) => void }) {
  const [rows, setRows] = useState<PluginRow[]>(() => buildPluginRows(locations));
  useEffect(() => setRows(buildPluginRows(locations)), [locations]);
  const counts = useMemo(() => countApps(rows), [rows]);
  const toggle = (row: PluginRow, app: TargetApp, enabled: boolean) => {
    const nextRows = rows.map((item) => item.id === row.id ? { ...item, apps: { ...item.apps, [app]: enabled } } : item);
    const switches = readPluginSwitches();
    const next = nextRows.find((item) => item.id === row.id);
    if (next) switches[row.id] = next.apps;
    writePluginSwitches(switches);
    setRows(nextRows);
    onError(null);
  };
  return <>
    <StatsBar total={rows.length} counts={counts} loading={false} onRefresh={() => setRows(buildPluginRows(locations))} />
    {rows.length === 0 ? <EmptyBlock text={pageCopy.plugin.empty} /> : <div className="overflow-hidden rounded-2xl border border-base-300 bg-base-100/70">
      {rows.map((row, index) => <div key={row.id} className={`group flex items-center gap-3 px-4 py-2.5 transition hover:bg-base-200/70 ${index !== rows.length - 1 ? 'border-b border-base-300' : ''}`}>
        <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-base-content">{row.name}</div><div className="truncate text-xs text-base-content/50">{row.description} · {row.path}</div></div>
        <AppSwitchGroup apps={row.apps} onToggle={(app, enabled) => toggle(row, app, enabled)} />
      </div>)}
    </div>}
  </>;
}

interface ExtensionManagementPageProps { kind: ExtensionKind; }

export function ExtensionManagementPage({ kind }: ExtensionManagementPageProps) {
  const copy = pageCopy[kind];
  const [locations, setLocations] = useState<ExtensionLocation[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshLocations = useCallback(async () => {
    setLoadingLocations(true);
    setError(null);
    try { setLocations(await listExtensionLocations(kind)); } catch (err) { setError(String(err)); } finally { setLoadingLocations(false); }
  }, [kind]);

  useEffect(() => { void refreshLocations(); }, [refreshLocations]);

  return <div className="mx-auto max-w-[1800px] space-y-4">
    <section className="rounded-2xl border border-base-300 bg-base-200/70 p-4 shadow-xl">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{copy.eyebrow}</p><h2 className="mt-1 text-xl font-semibold text-base-content">{copy.title}</h2><p className="mt-2 text-sm text-base-content/55">{copy.description}</p></div>
        <Button tone="secondary" onClick={() => void refreshLocations()} disabled={loadingLocations} className="btn-square" aria-label="刷新路径" title="刷新路径">{loadingLocations ? <span className="loading loading-spinner loading-xs" /> : <RefreshIcon />}</Button>
      </div>
    </section>
    {error && <div className="rounded-2xl border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</div>}
    {kind === 'mcp' && <McpPanel onError={setError} />}
    {kind === 'skills' && <SkillsPanel onError={setError} />}
    {kind === 'plugin' && <PluginPanel locations={locations} onError={setError} />}
    <SourceLocations locations={locations} />
  </div>;
}
