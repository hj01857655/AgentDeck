import { useEffect, useMemo, useState } from 'react';
import { deleteSession, getSessionMessages, launchSessionTerminal, listSessions, type ClientId, type SessionMessage, type SessionMeta } from '../../lib/tauri';
import { Button } from '../shared/Button';
import { Dialog } from '../shared/Dialog';
import { RefreshIcon, TrashIcon, PlayIcon } from '../shared/ActionIcons';
import { AntigravityBrandIcon, ClaudeBrandIcon, CodexBrandIcon, HermesBrandIcon, OpenClawBrandIcon, OpenCodeBrandIcon } from '../shared/BrandIcons';
import { IconDropdown, type IconDropdownOption } from '../shared/IconDropdown';

type SessionProviderId = 'codex' | 'claude' | 'antigravity' | 'opencode' | 'openclaw' | 'hermes';
type ProviderFilter = 'all' | SessionProviderId;
type ViewMode = 'flat' | 'grouped';

interface SessionManagementPageProps {
  activeClient: ClientId;
}

function providerFilterForClient(clientId: ClientId): ProviderFilter {
  if (clientId === 'codex') return 'codex';
  if (clientId === 'claude-code') return 'claude';
  if (clientId === 'antigravity') return 'antigravity';
  if (clientId === 'opencode') return 'opencode';
  if (clientId === 'openclaw') return 'openclaw';
  if (clientId === 'hermes') return 'hermes';
  return 'all';
}

function providerLabel(providerId: string) {
  if (providerId === 'codex') return 'Codex';
  if (providerId === 'claude') return 'Claude Code';
  if (providerId === 'antigravity') return 'Antigravity CLI';
  if (providerId === 'opencode') return 'OpenCode';
  if (providerId === 'openclaw') return 'OpenClaw';
  if (providerId === 'hermes') return 'Hermes Agent';
  return providerId;
}

function providerIcon(providerId: string, size = 16) {
  if (providerId === 'claude') return <ClaudeBrandIcon size={size} />;
  if (providerId === 'codex') return <CodexBrandIcon size={size} />;
  if (providerId === 'antigravity') return <AntigravityBrandIcon size={size} />;
  if (providerId === 'opencode') return <OpenCodeBrandIcon size={size} />;
  if (providerId === 'openclaw') return <OpenClawBrandIcon size={size} />;
  if (providerId === 'hermes') return <HermesBrandIcon size={size} />;
  return null;
}

function ProviderMark({ providerId }: { providerId: string }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-base-300 bg-base-200/70 px-2 py-0.5 text-[11px] font-medium text-base-content/70">
    {providerIcon(providerId, 14)}
    {providerLabel(providerId)}
  </span>;
}

function providerFilterIcon(providerId: ProviderFilter) {
  if (providerId !== 'all') return providerIcon(providerId);
  return <span className="grid h-4 w-4 place-items-center rounded-md border border-base-300 bg-base-100 text-[10px] font-bold text-base-content/60">全</span>;
}

const providerFilterOptions: IconDropdownOption<ProviderFilter>[] = (['all', 'codex', 'claude', 'antigravity', 'opencode', 'openclaw', 'hermes'] as ProviderFilter[]).map((item) => ({
  value: item,
  label: item === 'all' ? '全部来源' : providerLabel(item),
  description: item === 'all' ? '显示所有已扫描会话' : `${providerLabel(item)} 会话`,
  icon: providerFilterIcon(item),
}));

function formatTime(value?: number | null) {
  if (!value) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function basename(path?: string | null) {
  if (!path) return '未知目录';
  const parts = path.replaceAll('\\\\', '/').replaceAll('\\', '/').split('/').filter(Boolean);
  return parts.at(-1) ?? path;
}

function normalizePath(path?: string | null) {
  return (path ?? '').replaceAll('\\\\', '/').replaceAll('\\', '/');
}

function sessionKey(item: SessionMeta) {
  return `${item.provider_id}:${item.source_path || item.session_id}`;
}

function sessionBucket(session: SessionMeta): { label: string; className: string } | null {
  if (session.provider_id !== 'codex') return null;
  const path = normalizePath(session.source_path).toLowerCase();
  if (path.includes('/archived_sessions/')) return { label: 'archived / 已归档', className: 'border-warning/25 bg-warning/10 text-warning' };
  if (path.includes('/sessions/')) return { label: 'active / 未归档', className: 'border-success/25 bg-success/10 text-success' };
  return null;
}

function SessionBucketMark({ session }: { session: SessionMeta }) {
  const bucket = sessionBucket(session);
  if (!bucket) return null;
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${bucket.className}`}>{bucket.label}</span>;
}

function roleLabel(role: string) {
  if (role === 'user') return '用户';
  if (role === 'assistant') return '助手';
  if (role === 'tool') return '工具';
  if (role === 'system') return '系统';
  if (role === 'developer') return '开发者';
  return role || '未知';
}

function roleClass(role: string) {
  if (role === 'user') return 'border-primary/30 bg-primary/10 text-primary';
  if (role === 'assistant') return 'border-success/30 bg-success/10 text-success';
  if (role === 'tool') return 'border-warning/30 bg-warning/10 text-warning';
  return 'border-base-300 bg-base-200 text-base-content/60';
}

function sessionResumeCommand(session: SessionMeta) {
  if (session.provider_id === 'codex') return `codex resume ${session.session_id}`;
  if (session.provider_id === 'claude') return `claude --resume ${session.session_id}`;
  if (session.provider_id === 'opencode') return `opencode -s ${session.session_id}`;
  if (session.provider_id === 'antigravity') return `gemini --resume ${session.session_id}`;
  if (session.provider_id === 'hermes') return `hermes resume ${session.session_id}`;
  return '';
}

function messagePreview(text: string, limit = 140) {
  const value = text.trim().replace(/\s+/g, ' ');
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function groupSessions(sessions: SessionMeta[]) {
  const providerOrder = ['codex', 'claude', 'opencode', 'antigravity', 'openclaw', 'hermes'];
  return providerOrder
    .filter((providerId) => sessions.some((item) => item.provider_id === providerId))
    .map((providerId) => {
      const providerSessions = sessions.filter((item) => item.provider_id === providerId);
      const dirMap = new Map<string, SessionMeta[]>();
      for (const session of providerSessions) {
        const key = session.project_dir || '未知目录';
        dirMap.set(key, [...(dirMap.get(key) ?? []), session]);
      }
      return {
        providerId,
        sessions: providerSessions,
        directories: Array.from(dirMap.entries()).map(([projectDir, items]) => ({ projectDir, sessions: items })),
      };
    });
}

async function copyText(value: string) {
  if (!value) return;
  await navigator.clipboard?.writeText(value);
}

export function SessionManagementPage({ activeClient }: SessionManagementPageProps) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<ProviderFilter>(() => providerFilterForClient(activeClient));
  const [viewMode, setViewMode] = useState<ViewMode>('flat');
  const [loading, setLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleteTargets, setDeleteTargets] = useState<SessionMeta[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [visibleMessageCount, setVisibleMessageCount] = useState(120);

  useEffect(() => {
    setProvider(providerFilterForClient(activeClient));
  }, [activeClient]);

  const refresh = async (preferredKey?: string | null) => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      // 对齐 cc-switch：会话管理一次加载全部来源，Provider 下拉只做页面内筛选。
      const rows = await listSessions('all');
      setSessions(rows);
      const nextKey = preferredKey && rows.some((item) => sessionKey(item) === preferredKey) ? preferredKey : null;
      setActiveKey(nextKey ?? (rows[0] ? sessionKey(rows[0]) : null));
    } catch (err) {
      setError(String(err));
      setSessions([]);
      setActiveKey(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return sessions.filter((item) => {
      if (provider !== 'all' && item.provider_id !== provider) return false;
      if (!text) return true;
      return [item.title, item.model, item.project_dir, item.source_path, item.session_id, providerLabel(item.provider_id), sessionBucket(item)?.label]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(text));
    });
  }, [provider, query, sessions]);

  const grouped = useMemo(() => groupSessions(filtered), [filtered]);
  const active = useMemo(() => activeKey ? (sessions.find((item) => sessionKey(item) === activeKey) ?? null) : null, [activeKey, sessions]);
  const selectedSessions = useMemo(() => sessions.filter((item) => selectedKeys.has(sessionKey(item))), [selectedKeys, sessions]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((item) => selectedKeys.has(sessionKey(item)));
  const visibleMessages = useMemo(() => messages.slice(0, visibleMessageCount), [messages, visibleMessageCount]);

  const providerStats = useMemo(() => providerFilterOptions
    .filter((item) => item.value !== 'all')
    .map((item) => ({ id: item.value, label: providerLabel(item.value), count: sessions.filter((session) => session.provider_id === item.value).length }))
    .filter((item) => item.count > 0), [sessions]);

  useEffect(() => {
    if (!active) {
      setMessages([]);
      setVisibleMessageCount(120);
      return;
    }
    let cancelled = false;
    setMessagesLoading(true);
    setMessages([]);
    setVisibleMessageCount(120);
    getSessionMessages(active.provider_id, active.source_path)
      .then((rows) => { if (!cancelled) setMessages(rows); })
      .catch((err) => { if (!cancelled) setError(String(err)); })
      .finally(() => { if (!cancelled) setMessagesLoading(false); });
    return () => { cancelled = true; };
  }, [active?.provider_id, active?.source_path]);

  useEffect(() => {
    if (!activeKey || filtered.some((item) => sessionKey(item) === activeKey)) return;
    setActiveKey(filtered[0] ? sessionKey(filtered[0]) : null);
  }, [activeKey, filtered]);

  useEffect(() => {
    setSelectedKeys((current) => {
      const valid = new Set(sessions.map(sessionKey));
      const next = new Set(Array.from(current).filter((key) => valid.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [sessions]);

  const toggleOne = (session: SessionMeta, checked: boolean) => {
    const key = sessionKey(session);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleGroup = (items: SessionMeta[], checked: boolean) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      for (const item of items) {
        const key = sessionKey(item);
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  };

  const toggleAllFiltered = () => toggleGroup(filtered, !allFilteredSelected);

  const confirmDelete = async () => {
    if (!deleteTargets || deleteTargets.length === 0) return;
    setDeleting(true);
    setError('');
    let ok = 0;
    try {
      for (const item of deleteTargets) {
        await deleteSession(item.provider_id, item.session_id, item.source_path);
        ok += 1;
      }
      setDeleteTargets(null);
      setSelectedKeys(new Set());
      setNotice(`已删除 ${ok} 个会话`);
      await refresh(active && deleteTargets.some((item) => sessionKey(item) === sessionKey(active)) ? null : activeKey);
    } catch (err) {
      setError(`删除中断：已删除 ${ok} 个；${String(err)}`);
      await refresh(activeKey);
    } finally {
      setDeleting(false);
    }
  };

  const copyResume = async (item: SessionMeta) => {
    await copyText(sessionResumeCommand(item));
    setNotice('已复制恢复命令');
  };

  const openResumeTerminal = async (item: SessionMeta) => {
    try {
      await launchSessionTerminal(sessionResumeCommand(item), item.project_dir);
      setNotice('已打开终端恢复会话');
    } catch (err) {
      await copyResume(item);
      setError(`打开终端失败，已复制恢复命令：${String(err)}`);
    }
  };

  const renderSessionRow = (item: SessionMeta) => {
    const key = sessionKey(item);
    const isActive = activeKey === key;
    const checked = selectedKeys.has(key);
    return <button
      key={key}
      type="button"
      onClick={() => setActiveKey(key)}
      className={`block w-full rounded-xl border px-3 py-2.5 text-left transition hover:bg-base-200/70 ${isActive ? 'border-primary/45 bg-primary/10 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.24)]' : 'border-transparent'}`}
    >
      <div className="flex items-start gap-2">
        {selectionMode && <input type="checkbox" className="checkbox checkbox-xs mt-1" checked={checked} onClick={(event) => event.stopPropagation()} onChange={(event) => toggleOne(item, event.currentTarget.checked)} aria-label="选择会话" />}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {providerIcon(item.provider_id, 15)}
            <span className="truncate text-sm font-semibold text-base-content">{item.title || '未命名会话'}</span>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-base-content/45">
            <span>{basename(item.project_dir)}</span>
            <span>·</span>
            <span>{formatTime(item.updated_at ?? item.created_at)}</span>
            <span>·</span>
            <span>{item.message_count} 条</span>
            {item.model && <span className="truncate">· {item.model}</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <ProviderMark providerId={item.provider_id} />
            <SessionBucketMark session={item} />
          </div>
        </div>
      </div>
    </button>;
  };

  return <div className="mx-auto flex h-[calc(100dvh-8rem)] max-w-[1800px] flex-col gap-3">
    <section className="shrink-0 rounded-2xl border border-base-300 bg-base-100/85 p-3 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Session Manager</p>
          <h2 className="mt-0.5 text-xl font-semibold text-base-content">会话管理</h2>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-base-content/50">
            <span>总计 {sessions.length}</span>
            {providerStats.map((item) => <span key={item.id}>· {item.label} {item.count}</span>)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectionMode && <Button tone="danger" onClick={() => setDeleteTargets(selectedSessions)} disabled={selectedSessions.length === 0 || deleting}>{deleting ? <span className="loading loading-spinner loading-xs" /> : <TrashIcon />}删除 {selectedSessions.length}</Button>}
          <Button tone={selectionMode ? 'primary' : 'secondary'} onClick={() => setSelectionMode(!selectionMode)}>{selectionMode ? '退出批量' : '批量管理'}</Button>
          <Button tone="secondary" className="btn-square" onClick={() => void refresh(activeKey)} disabled={loading} aria-label="刷新会话" title="刷新会话">{loading ? <span className="loading loading-spinner loading-xs" /> : <RefreshIcon />}</Button>
        </div>
      </div>
    </section>

    {notice && <div className="shrink-0 rounded-2xl border border-success/30 bg-success/10 p-3 text-sm text-success">{notice}</div>}
    {error && <div className="shrink-0 rounded-2xl border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</div>}

    <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100/85">
        <div className="shrink-0 space-y-2 border-b border-base-300 bg-base-200/45 p-3">
          <input className="input input-bordered input-sm w-full bg-base-100" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索会话、项目、模型、路径..." />
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <IconDropdown value={provider} options={providerFilterOptions} onChange={setProvider} label="Provider 过滤" className="w-full" buttonClassName="w-full" menuClassName="w-full" />
            <Button tone="secondary" className="min-w-24" onClick={() => setViewMode(viewMode === 'flat' ? 'grouped' : 'flat')}>{viewMode === 'flat' ? '列表' : '分组'}</Button>
          </div>
          {selectionMode && <div className="flex items-center justify-between text-xs text-base-content/55">
            <label className="inline-flex items-center gap-2"><input type="checkbox" className="checkbox checkbox-xs" checked={allFilteredSelected} onChange={toggleAllFiltered} disabled={filtered.length === 0} />全选当前列表</label>
            {selectedKeys.size > 0 && <button className="link-hover text-primary" type="button" onClick={() => setSelectedKeys(new Set())}>清空 {selectedKeys.size}</button>}
          </div>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {loading && sessions.length === 0 ? <div className="p-8 text-center text-sm text-base-content/50"><span className="loading loading-spinner loading-sm" /> 正在扫描会话...</div> : null}
          {!loading && filtered.length === 0 ? <div className="p-8 text-center text-sm text-base-content/50">没有匹配的会话。</div> : null}
          {viewMode === 'flat' ? <div className="space-y-1">{filtered.map(renderSessionRow)}</div> : <div className="space-y-2">
            {grouped.map((providerGroup) => {
              const providerChecked = providerGroup.sessions.every((item) => selectedKeys.has(sessionKey(item)));
              return <details key={providerGroup.providerId} open className="rounded-2xl border border-base-300 bg-base-100/70">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-base-content">
                  <span className="inline-flex items-center gap-2">{providerIcon(providerGroup.providerId)} {providerLabel(providerGroup.providerId)}</span>
                  <span className="inline-flex items-center gap-2 text-xs text-base-content/45">
                    {selectionMode && <input type="checkbox" className="checkbox checkbox-xs" checked={providerChecked} onClick={(e) => e.stopPropagation()} onChange={(e) => toggleGroup(providerGroup.sessions, e.currentTarget.checked)} />}
                    {providerGroup.sessions.length}
                  </span>
                </summary>
                <div className="space-y-2 border-t border-base-300 p-2">
                  {providerGroup.directories.map((dir) => {
                    const dirChecked = dir.sessions.every((item) => selectedKeys.has(sessionKey(item)));
                    return <details key={`${providerGroup.providerId}:${dir.projectDir}`} open className="rounded-xl bg-base-200/45">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-base-content/70">
                        <span className="truncate">{basename(dir.projectDir)}</span>
                        <span className="inline-flex items-center gap-2 text-base-content/45">
                          {selectionMode && <input type="checkbox" className="checkbox checkbox-xs" checked={dirChecked} onClick={(e) => e.stopPropagation()} onChange={(e) => toggleGroup(dir.sessions, e.currentTarget.checked)} />}
                          {dir.sessions.length}
                        </span>
                      </summary>
                      <div className="space-y-1 px-1 pb-1">{dir.sessions.map(renderSessionRow)}</div>
                    </details>;
                  })}
                </div>
              </details>;
            })}
          </div>}
        </div>
      </section>

      <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100/85">
        {!active ? <div className="grid flex-1 place-items-center p-10 text-center text-sm text-base-content/50">选择左侧会话后读取详情。</div> : <>
          <div className="shrink-0 border-b border-base-300 bg-base-200/45 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2"><ProviderMark providerId={active.provider_id} /><SessionBucketMark session={active} /></div>
                <h3 className="truncate text-lg font-semibold text-base-content">{active.title || '未命名会话'}</h3>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-base-content/50">
                  <span>{formatTime(active.updated_at ?? active.created_at)}</span>
                  <button type="button" className="link-hover truncate" onClick={() => void copyText(active.project_dir || '')}>{basename(active.project_dir)}</button>
                  <button type="button" className="link-hover max-w-[360px] truncate font-mono" onClick={() => void copyText(active.source_path)}>{basename(active.source_path)}</button>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {sessionResumeCommand(active) && <Button tone="primary" onClick={() => void openResumeTerminal(active)} title="打开终端恢复会话"><PlayIcon />恢复</Button>}
                {sessionResumeCommand(active) && <Button tone="secondary" onClick={() => void copyResume(active)} title="复制恢复命令">复制命令</Button>}
                <Button tone="danger" className="btn-square" onClick={() => setDeleteTargets([active])} aria-label="删除会话" title="删除会话"><TrashIcon /></Button>
              </div>
            </div>
            {sessionResumeCommand(active) && <div className="mt-3 flex items-center gap-2 rounded-xl border border-base-300 bg-base-100/75 px-3 py-2 font-mono text-xs text-base-content/55">
              <span className="min-w-0 flex-1 truncate">{sessionResumeCommand(active)}</span>
              <button type="button" className="link-hover shrink-0 text-primary" onClick={() => void copyResume(active)}>复制</button>
            </div>}
          </div>

          <div className="shrink-0 border-b border-base-300 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-base-content"><span>对话记录</span><span className="rounded-full bg-base-200 px-2 py-0.5 text-xs text-base-content/55">{messages.length}</span></div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {messagesLoading ? <div className="p-8 text-center text-sm text-base-content/50"><span className="loading loading-spinner loading-sm" /> 正在读取消息...</div> : null}
            {!messagesLoading && messages.length === 0 ? <div className="p-8 text-center text-sm text-base-content/50">这个会话没有可展示的消息。</div> : null}
            <div className="space-y-3">
              {visibleMessages.map((message, index) => <article key={`${message.ts ?? index}-${message.role}-${index}`} className="rounded-2xl border border-base-300 bg-base-200/35 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${roleClass(message.role)}`}>{roleLabel(message.role)}</span>
                  <span className="text-xs text-base-content/40">{formatTime(message.ts)}</span>
                  <button type="button" className="ml-auto rounded-lg border border-base-300 px-2 py-0.5 text-[11px] text-base-content/45 hover:bg-base-100 hover:text-base-content" onClick={() => void copyText(message.content).then(() => setNotice('已复制消息内容'))}>复制</button>
                </div>
                <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-base-content/80">{messagePreview(message.content, 6000)}</pre>
              </article>)}
              {!messagesLoading && messages.length > visibleMessages.length && <button type="button" className="btn btn-outline btn-sm w-full rounded-xl" onClick={() => setVisibleMessageCount((count) => Math.min(count + 120, messages.length))}>继续显示 {Math.min(120, messages.length - visibleMessages.length)} 条 · 已显示 {visibleMessages.length}/{messages.length}</button>}
            </div>
          </div>
        </>}
      </section>
    </div>

    <Dialog
      open={Boolean(deleteTargets)}
      title={deleteTargets && deleteTargets.length > 1 ? '批量删除会话' : '删除会话'}
      description={deleteTargets && deleteTargets.length > 1 ? `将永久删除 ${deleteTargets.length} 个本地会话记录，此操作不可恢复。` : '将永久删除此本地会话记录，此操作不可恢复。'}
      onClose={() => { if (!deleting) setDeleteTargets(null); }}
      size="sm"
      footer={<div className="flex justify-end gap-2"><Button tone="ghost" onClick={() => setDeleteTargets(null)} disabled={deleting}>取消</Button><Button tone="danger" onClick={() => void confirmDelete()} disabled={deleting}>{deleting ? <span className="loading loading-spinner loading-xs" /> : <TrashIcon />}删除</Button></div>}
    >
      <div className="space-y-2 text-sm">
        {(deleteTargets ?? []).slice(0, 6).map((item) => <div key={sessionKey(item)} className="truncate rounded-xl border border-base-300 bg-base-200/60 px-3 py-2">{item.title || item.session_id}</div>)}
        {(deleteTargets?.length ?? 0) > 6 && <div className="text-xs text-base-content/50">还有 {(deleteTargets?.length ?? 0) - 6} 个...</div>}
      </div>
    </Dialog>
  </div>;
}
