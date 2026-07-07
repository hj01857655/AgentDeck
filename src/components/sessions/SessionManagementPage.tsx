import { useEffect, useMemo, useState } from 'react';
import { chatForward, listChannels, type Channel, type Message } from '../../lib/tauri';
import { Button } from '../shared/Button';
import { PlayIcon, PlusIcon, RefreshIcon, TrashIcon } from '../shared/ActionIcons';

interface SessionItem { id: string; title: string; model: string; channel_id?: string; messages: Message[]; updated_at: number; }
const STORAGE_KEY = 'agentdeck:sessions';

function readSessions(): SessionItem[] { try { const raw = window.localStorage.getItem(STORAGE_KEY); const parsed = raw ? JSON.parse(raw) as SessionItem[] : []; return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function writeSessions(rows: SessionItem[]) { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); }
function createSession(channels: Channel[]): SessionItem { const channel = channels.find((item) => item.enabled) ?? channels[0]; return { id: crypto.randomUUID?.() ?? `${Date.now()}`, title: '新会话', model: channel?.models[0] ?? 'gpt-4o', channel_id: channel?.id, messages: [{ role: 'user', content: 'ping' }], updated_at: Date.now() }; }
function formatTime(value: number) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }

export function SessionManagementPage() {
  const [sessions, setSessions] = useState<SessionItem[]>(() => readSessions());
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeId, setActiveId] = useState<string | null>(sessions[0]?.id ?? null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState('');
  const active = useMemo(() => sessions.find((item) => item.id === activeId) ?? sessions[0] ?? null, [activeId, sessions]);
  const persist = (next: SessionItem[]) => { setSessions(next); writeSessions(next); };
  const refreshChannels = async () => setChannels(await listChannels());
  useEffect(() => { void refreshChannels(); }, []);
  const add = () => { const next = createSession(channels); persist([next, ...sessions]); setActiveId(next.id); };
  const remove = (id: string) => { const next = sessions.filter((item) => item.id !== id); persist(next); if (activeId === id) setActiveId(next[0]?.id ?? null); };
  const updateActive = (patch: Partial<SessionItem>) => { if (!active) return; persist(sessions.map((item) => item.id === active.id ? { ...item, ...patch, updated_at: Date.now() } : item)); };
  const run = async () => { if (!active) return; setRunning(true); setResult(''); try { const resp = await chatForward({ model: active.model, messages: active.messages, channel_id: active.channel_id, max_tokens: 256, temperature: 0.2 }); setResult(JSON.stringify(resp.body, null, 2)); } catch (err) { setResult(String(err)); } finally { setRunning(false); } };

  return <div className="mx-auto grid max-w-[1800px] gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
    <section className="rounded-2xl border border-base-300 bg-base-200/70 p-4 shadow-xl xl:col-span-2"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Playground / Sessions</p><h2 className="mt-1 text-xl font-semibold text-base-content">会话管理</h2><p className="mt-2 text-sm text-base-content/55">按会话保存模型、接入点和消息，快速验证当前路由。</p></div><div className="flex gap-2"><Button tone="secondary" className="btn-square" onClick={() => void refreshChannels()} aria-label="刷新"><RefreshIcon /></Button><Button tone="primary" className="btn-square" onClick={add} aria-label="新建"><PlusIcon /></Button></div></div></section>
    <section className="overflow-hidden rounded-2xl border border-base-300 bg-base-100/70">{sessions.length === 0 ? <div className="p-8 text-center text-sm text-base-content/50">还没有会话，点击右上角新建。</div> : sessions.map((item, index) => <button key={item.id} type="button" onClick={() => setActiveId(item.id)} className={`group flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-base-200/70 ${active?.id === item.id ? 'bg-primary/10' : ''} ${index !== sessions.length - 1 ? 'border-b border-base-300' : ''}`}><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-base-content">{item.title}</div><div className="truncate text-xs text-base-content/50">{item.model} · {formatTime(item.updated_at)}</div></div><span className="rounded-md bg-base-200 px-1.5 py-0.5 text-[10px] text-base-content/50">{item.messages.length}</span></button>)}</section>
    <section className="rounded-2xl border border-base-300 bg-base-100/70 p-4">{!active ? <div className="p-8 text-center text-sm text-base-content/50">选择或新建一个会话。</div> : <div className="space-y-3"><div className="grid gap-3 md:grid-cols-2"><label className="space-y-1.5"><span className="text-xs font-semibold text-base-content/55">标题</span><input className="input input-bordered w-full bg-base-100" value={active.title} onChange={(e) => updateActive({ title: e.target.value })} /></label><label className="space-y-1.5"><span className="text-xs font-semibold text-base-content/55">模型</span><input className="input input-bordered w-full bg-base-100" value={active.model} onChange={(e) => updateActive({ model: e.target.value })} /></label></div><label className="space-y-1.5"><span className="text-xs font-semibold text-base-content/55">接入点</span><select className="select select-bordered w-full bg-base-100" value={active.channel_id ?? ''} onChange={(e) => updateActive({ channel_id: e.target.value || undefined })}><option value="">自动路由</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label><label className="space-y-1.5"><span className="text-xs font-semibold text-base-content/55">用户消息</span><textarea className="textarea textarea-bordered min-h-36 w-full bg-base-100" value={active.messages[0]?.content ?? ''} onChange={(e) => updateActive({ messages: [{ role: 'user', content: e.target.value }] })} /></label><div className="flex justify-between gap-2"><Button tone="danger" className="btn-square" onClick={() => remove(active.id)} aria-label="删除"><TrashIcon /></Button><Button tone="primary" onClick={() => void run()} disabled={running}>{running ? <span className="loading loading-spinner loading-xs" /> : <PlayIcon />}运行</Button></div>{result && <pre className="max-h-80 overflow-auto rounded-2xl border border-base-300 bg-base-200/70 p-3 text-xs text-base-content/70">{result}</pre>}</div>}</section>
  </div>;
}
