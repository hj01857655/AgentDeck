import { useCallback, useEffect, useMemo, useState } from 'react';
import { listExtensionLocations, type ExtensionLocation } from '../../lib/tauri';
import { Button } from '../shared/Button';
import { Dialog } from '../shared/Dialog';
import { EditIcon, PlusIcon, PowerIcon, RefreshIcon, SaveIcon, TrashIcon, XIcon } from '../shared/ActionIcons';

export type ExtensionKind = 'mcp' | 'skills' | 'plugin';

interface ExtensionDefinition {
  title: string;
  eyebrow: string;
  description: string;
  nameLabel: string;
  sourceLabel: string;
  sourcePlaceholder: string;
  emptyTitle: string;
  emptyDescription: string;
}

interface ManagedExtension {
  id: string;
  name: string;
  source: string;
  description: string;
  enabled: boolean;
  updatedAt: number;
}

const definitions: Record<ExtensionKind, ExtensionDefinition> = {
  mcp: {
    title: 'MCP 管理',
    eyebrow: 'Codex / Claude MCP',
    description: '按官方路径查看 MCP：Codex 使用 config.toml；Claude 用户/本地状态在 ~/.claude.json，项目配置在 .mcp.json。',
    nameLabel: '服务名称',
    sourceLabel: '命令 / URL',
    sourcePlaceholder: 'npx -y @modelcontextprotocol/server-filesystem ...',
    emptyTitle: '还没有手动 MCP 配置',
    emptyDescription: '真实 MCP 配置在上方目录区展示；这里可记录待添加或自定义服务。',
  },
  skills: {
    title: 'Skills 管理',
    eyebrow: 'Codex / Claude Skills',
    description: 'Codex 源码显示主目录是 $HOME/.agents/skills；Claude 官方文档使用 ~/.claude/skills 与项目 .claude/skills，旧 commands 兼容为 skills。',
    nameLabel: 'Skill 名称',
    sourceLabel: '仓库 / 路径',
    sourcePlaceholder: 'https://github.com/... --skill name',
    emptyTitle: '还没有手动 Skill 配置',
    emptyDescription: '真实 Skills 目录在上方目录区展示；这里可记录待安装或自定义 Skill。',
  },
  plugin: {
    title: 'Plugin 管理',
    eyebrow: 'Codex / Claude Plugins',
    description: '按官方路径查看插件：Codex 使用 plugins/cache；Claude 插件属于 settings 作用域，落在 ~/.claude/settings.json、项目 .claude/settings.json 或 settings.local.json。',
    nameLabel: 'Plugin 名称',
    sourceLabel: '入口 / 路径',
    sourcePlaceholder: '.codex-plugin/plugin.json 或插件目录',
    emptyTitle: '还没有手动 Plugin 配置',
    emptyDescription: '真实插件目录在上方目录区展示；这里可记录待安装或自定义插件。',
  },
};

function storageKey(kind: ExtensionKind) {
  return `ai-gateway:${kind}:managed-items`;
}

function createId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readItems(kind: ExtensionKind): ManagedExtension[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(kind)) ?? '[]') as ManagedExtension[];
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeItems(kind: ExtensionKind, items: ManagedExtension[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey(kind), JSON.stringify(items));
}

function createEmptyItem(): ManagedExtension {
  return {
    id: createId(),
    name: '',
    source: '',
    description: '',
    enabled: true,
    updatedAt: Date.now(),
  };
}

function formatDate(value: number) {
  if (!value) return '未保存';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function targetTone(target: string) {
  if (target.includes('system')) return 'border-info/25 bg-info/10 text-info';
  if (target.includes('legacy')) return 'border-warning/25 bg-warning/10 text-warning';
  if (target.includes('claude')) return 'border-secondary/25 bg-secondary/10 text-secondary';
  return 'border-primary/25 bg-primary/10 text-primary';
}

interface ExtensionManagementPageProps {
  kind: ExtensionKind;
}

export function ExtensionManagementPage({ kind }: ExtensionManagementPageProps) {
  const definition = definitions[kind];
  const [items, setItems] = useState<ManagedExtension[]>(() => readItems(kind));
  const [locations, setLocations] = useState<ExtensionLocation[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [editingItem, setEditingItem] = useState<ManagedExtension | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enabledCount = useMemo(() => items.filter((item) => item.enabled).length, [items]);
  const locationEntryCount = useMemo(() => locations.reduce((sum, location) => sum + location.entries.length, 0), [locations]);

  const refreshLocations = useCallback(async () => {
    setLoadingLocations(true);
    setError(null);
    try {
      setLocations(await listExtensionLocations(kind));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingLocations(false);
    }
  }, [kind]);

  useEffect(() => {
    setItems(readItems(kind));
    setEditingItem(null);
    setError(null);
    void refreshLocations();
  }, [kind, refreshLocations]);

  const persist = (nextItems: ManagedExtension[]) => {
    setItems(nextItems);
    writeItems(kind, nextItems);
  };

  const openNew = () => {
    setEditingItem(createEmptyItem());
    setError(null);
  };

  const saveEditing = () => {
    if (!editingItem) return;
    const name = editingItem.name.trim();
    const source = editingItem.source.trim();
    if (!name) return setError(`${definition.nameLabel}必填。`);
    if (!source) return setError(`${definition.sourceLabel}必填。`);

    const normalized: ManagedExtension = {
      ...editingItem,
      name,
      source,
      description: editingItem.description.trim(),
      updatedAt: Date.now(),
    };
    const exists = items.some((item) => item.id === normalized.id);
    persist(exists ? items.map((item) => (item.id === normalized.id ? normalized : item)) : [normalized, ...items]);
    setEditingItem(null);
    setError(null);
  };

  const toggleItem = (item: ManagedExtension) => {
    persist(items.map((current) => current.id === item.id ? { ...current, enabled: !current.enabled, updatedAt: Date.now() } : current));
  };

  const deleteItem = (item: ManagedExtension) => {
    persist(items.filter((current) => current.id !== item.id));
  };

  return (
    <div className="mx-auto max-w-[1800px] space-y-5">
      <section className="rounded-2xl border border-base-300 bg-base-200/70 p-4 shadow-xl">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{definition.eyebrow}</p>
            <h2 className="mt-1 text-xl font-semibold text-base-content">{definition.title}</h2>
            <p className="mt-2 text-sm text-base-content/55">{definition.description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-xl border border-base-300 bg-base-100/75 px-3 py-2 text-xs text-base-content/60">
              目录项 <span className="font-semibold text-base-content">{locationEntryCount}</span>
            </div>
            <div className="rounded-xl border border-base-300 bg-base-100/75 px-3 py-2 text-xs text-base-content/60">
              手动启用 <span className="font-semibold text-base-content">{enabledCount}/{items.length}</span>
            </div>
            <Button tone="secondary" onClick={() => void refreshLocations()} disabled={loadingLocations} className="btn-square" aria-label="刷新目录" title="刷新目录">
              {loadingLocations ? <span className="loading loading-spinner loading-xs" /> : <RefreshIcon />}
            </Button>
            <Button tone="primary" onClick={openNew} className="btn-square" aria-label={`添加${definition.title}`} title={`添加${definition.title}`}>
              <PlusIcon />
            </Button>
          </div>
        </div>
      </section>

      {error && <div className="rounded-2xl border border-error/30 bg-error/10 p-4 text-sm text-error">{error}</div>}

      <section className="rounded-3xl border border-base-300 bg-base-200/55 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-base-content">真实运行时目录</h3>
            <p className="mt-1 text-xs text-base-content/55">来自本机 Codex / Claude 配置路径扫描，不是手填数据。</p>
          </div>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {locations.map((location) => (
            <article key={`${location.target}:${location.path}`} className="rounded-2xl border border-base-300 bg-base-100/75 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-semibold text-base-content">{location.label}</h4>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${targetTone(location.target)}`}>{location.target}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${location.exists ? 'border-success/25 bg-success/10 text-success' : 'border-base-300 bg-base-200 text-base-content/55'}`}>
                      {location.exists ? location.is_file ? '文件存在' : '目录存在' : '不存在'}
                    </span>
                  </div>
                  <p className="mt-1 break-all font-mono text-xs text-base-content/55">{location.path}</p>
                </div>
                <span className="rounded-xl border border-base-300 bg-base-200 px-2 py-1 text-xs text-base-content/60">
                  {location.entries.length} 项
                </span>
              </div>

              {location.entries.length === 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-base-300 bg-base-200/50 p-3 text-sm text-base-content/50">
                  {location.exists ? '没有发现可展示条目。' : '路径不存在。'}
                </div>
              ) : (
                <div className="mt-3 grid max-h-72 gap-1 overflow-auto pr-1">
                  {location.entries.map((entry) => (
                    <div key={entry.path} className="flex min-w-0 items-center justify-between gap-2 rounded-xl bg-base-200/70 px-2 py-1.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-base-content">{entry.name}</p>
                        <p className="truncate font-mono text-[11px] text-base-content/45">{entry.path}</p>
                      </div>
                      <span className="shrink-0 rounded-md border border-base-300 px-1.5 py-0.5 text-[10px] uppercase text-base-content/50">{entry.kind}</span>
                    </div>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-base-300 bg-base-200/55 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-base-content">手动管理项</h3>
            <p className="mt-1 text-xs text-base-content/55">用于记录待安装、外部来源或暂未落盘的配置。</p>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-base-300 bg-base-100/60 p-8 text-center">
            <h3 className="text-base font-semibold text-base-content">{definition.emptyTitle}</h3>
            <p className="mt-2 text-sm text-base-content/55">{definition.emptyDescription}</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {items.map((item) => (
              <article key={item.id} className="grid gap-3 rounded-2xl border border-base-300 bg-base-100/75 px-3 py-2.5 transition hover:border-primary/30 xl:grid-cols-[minmax(180px,1fr)_minmax(260px,1.4fr)_minmax(160px,0.8fr)_auto] xl:items-center">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-base-content">{item.name}</h3>
                    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${item.enabled ? 'border-success/25 bg-success/10 text-success' : 'border-base-300 bg-base-200 text-base-content/55'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${item.enabled ? 'bg-success' : 'bg-base-content/35'}`} />
                      {item.enabled ? '已启用' : '已禁用'}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-base-content/55">{item.description || '未填写说明'}</p>
                </div>
                <p className="min-w-0 truncate rounded-lg bg-base-200 px-2 py-1 font-mono text-xs text-base-content/65">{item.source}</p>
                <p className="text-xs text-base-content/50">更新于 {formatDate(item.updatedAt)}</p>
                <div className="flex shrink-0 items-center gap-1.5 xl:justify-end">
                  <Button tone="ghost" onClick={() => setEditingItem(item)} className="btn-square" aria-label="编辑" title="编辑">
                    <EditIcon />
                  </Button>
                  <Button tone={item.enabled ? 'ghost' : 'success'} onClick={() => toggleItem(item)} className="btn-square" aria-label={item.enabled ? '禁用' : '启用'} title={item.enabled ? '禁用' : '启用'}>
                    <PowerIcon />
                  </Button>
                  <Button tone="danger" onClick={() => deleteItem(item)} className="btn-square" aria-label="删除" title="删除">
                    <TrashIcon />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <Dialog
        open={editingItem !== null}
        title={editingItem && items.some((item) => item.id === editingItem.id) ? `编辑${definition.title}` : `添加${definition.title}`}
        description="保存到本地手动管理列表，不会直接写入 Codex / Claude 配置文件。"
        onClose={() => setEditingItem(null)}
        size="md"
      >
        {editingItem && (
          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-base-content/55">{definition.nameLabel}</span>
              <input value={editingItem.name} onChange={(event) => setEditingItem({ ...editingItem, name: event.target.value })} className="input input-bordered w-full bg-base-100" placeholder={definition.nameLabel} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-base-content/55">{definition.sourceLabel}</span>
              <input value={editingItem.source} onChange={(event) => setEditingItem({ ...editingItem, source: event.target.value })} className="input input-bordered w-full bg-base-100 font-mono" placeholder={definition.sourcePlaceholder} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-base-content/55">说明</span>
              <textarea value={editingItem.description} onChange={(event) => setEditingItem({ ...editingItem, description: event.target.value })} rows={4} className="textarea textarea-bordered w-full resize-none bg-base-100" placeholder="用途、参数、注意事项" />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-2xl border border-base-300 bg-base-200/60 p-3">
              <span>
                <span className="block text-sm font-medium text-base-content">启用</span>
                <span className="text-xs text-base-content/55">禁用后仍保留配置，但不作为可用项展示。</span>
              </span>
              <input type="checkbox" className="toggle toggle-primary" checked={editingItem.enabled} onChange={(event) => setEditingItem({ ...editingItem, enabled: event.target.checked })} />
            </label>

            {error && <div className="rounded-2xl border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</div>}

            <div className="flex justify-end gap-2">
              <Button tone="ghost" onClick={() => setEditingItem(null)} className="btn-square" aria-label="取消" title="取消"><XIcon /></Button>
              <Button tone="primary" onClick={saveEditing} className="btn-square" aria-label="保存" title="保存"><SaveIcon /></Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}


