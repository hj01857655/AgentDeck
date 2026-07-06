import { useEffect, useMemo, useState } from 'react';
import { providerLabel, uniqueModels } from '../../lib/providers';
import { chatForward, type Channel, type ChatResponse } from '../../lib/tauri';
import { Button } from '../shared/Button';
import { PlayIcon } from '../shared/ActionIcons';

interface RouteProbeDialogProps {
  channels: Channel[];
}

type ProbeState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; result: ChatResponse; text: string; raw: string; ok: boolean }
  | { kind: 'error'; message: string };

function extractText(body: Record<string, unknown>): string {
  const choices = body.choices;
  if (Array.isArray(choices)) {
    const first = choices[0] as Record<string, unknown> | undefined;
    const message = first?.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (typeof content === 'string' && content.trim()) return content;

    const text = first?.text;
    if (typeof text === 'string' && text.trim()) return text;
  }

  const outputText = body.output_text;
  if (typeof outputText === 'string' && outputText.trim()) return outputText;

  const raw = body.raw;
  if (typeof raw === 'string' && raw.trim()) return raw;

  return '响应里没有可直接展示的文本，已保留原始响应。';
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function RouteProbeDialog({ channels }: RouteProbeDialogProps) {
  const models = useMemo(() => uniqueModels(channels), [channels]);
  const [model, setModel] = useState(models[0] ?? '');
  const [channelId, setChannelId] = useState('__auto__');
  const [prompt, setPrompt] = useState('用一句话回复：路由探测成功。');
  const [state, setState] = useState<ProbeState>({ kind: 'idle' });

  const candidateChannels = useMemo(
    () => channels.filter((channel) => !model || channel.models.includes(model)),
    [channels, model],
  );

  useEffect(() => {
    if (!model && models.length > 0) setModel(models[0]);
    if (model && models.length > 0 && !models.includes(model)) setModel(models[0]);
  }, [model, models]);

  useEffect(() => {
    if (channelId === '__auto__') return;
    if (!candidateChannels.some((channel) => channel.id === channelId)) setChannelId('__auto__');
  }, [candidateChannels, channelId]);

  const runProbe = async () => {
    if (!model.trim()) {
      setState({ kind: 'error', message: '请先在提供商配置里添加模型，或获取模型后保存。' });
      return;
    }
    if (!prompt.trim()) {
      setState({ kind: 'error', message: '请输入探测内容。' });
      return;
    }

    setState({ kind: 'running' });
    try {
      const result = await chatForward({
        model: model.trim(),
        messages: [{ role: 'user', content: prompt.trim() }],
        max_tokens: 128,
        temperature: 0,
        channel_id: channelId === '__auto__' ? undefined : channelId,
      });
      setState({
        kind: 'done',
        result,
        text: extractText(result.body),
        raw: prettyJson(result.body),
        ok: result.status < 400,
      });
    } catch (err) {
      setState({ kind: 'error', message: String(err) });
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-base-content/55">模型</span>
          <select value={model} onChange={(event) => setModel(event.target.value)} className="select select-bordered w-full bg-base-100">
            {models.length === 0 ? (
              <option value="">暂无模型</option>
            ) : (
              models.map((item) => <option key={item} value={item}>{item}</option>)
            )}
          </select>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-base-content/55">路由范围</span>
          <select value={channelId} onChange={(event) => setChannelId(event.target.value)} className="select select-bordered w-full bg-base-100">
            <option value="__auto__">自动路由（按模型 / 健康 / 权重选择）</option>
            {candidateChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name} · {providerLabel(channel.protocol)}{channel.enabled ? '' : ' · 已禁用'}{channel.healthy ? '' : ' · 异常'}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-base-content/55">探测内容</span>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={4}
          className="textarea textarea-bordered w-full resize-none bg-base-100 text-base-content placeholder:text-base-content/35"
          placeholder="输入一条最小请求，用来验证路由是否可用。"
        />
      </label>

      <div className="flex flex-col gap-2 rounded-2xl border border-base-300 bg-base-200/50 p-3 text-xs text-base-content/60 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-medium text-base-content">这不是获取模型，也不是单个提供商的 API 探测。</p>
          <p className="mt-1">自动路由会走网关选择逻辑；指定提供商配置则只验证该行。</p>
        </div>
        <Button
          tone="primary"
          disabled={state.kind === 'running' || models.length === 0}
          onClick={() => void runProbe()}
          className="btn-square shrink-0"
          aria-label={state.kind === 'running' ? '探测中' : '开始探测'}
          title={state.kind === 'running' ? '探测中' : '开始探测'}
        >
          {state.kind === 'running' ? <span className="loading loading-spinner loading-xs" /> : <PlayIcon />}
        </Button>
      </div>

      {state.kind === 'error' && (
        <div className="rounded-2xl border border-error/30 bg-error/10 p-3 text-sm text-error">{state.message}</div>
      )}

      {state.kind === 'running' && (
        <div className="flex items-center justify-between rounded-2xl border border-base-300 bg-base-100/75 p-3 text-sm text-base-content/70">
          <span>正在发送最小请求...</span>
          <span className="loading loading-spinner loading-sm" />
        </div>
      )}

      {state.kind === 'done' && (
        <div className="space-y-3 rounded-2xl border border-base-300 bg-base-100/75 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`badge badge-sm ${state.ok ? 'badge-success' : 'badge-error'}`}>{state.ok ? '探测成功' : '探测失败'}</span>
            <span className="badge badge-outline badge-sm">HTTP {state.result.status}</span>
            <span className="badge badge-outline badge-sm">{state.result.elapsed_ms}ms</span>
            <span className="badge badge-outline badge-sm">命中：{state.result.channel_name}</span>
          </div>

          <div className="rounded-xl border border-base-300 bg-base-200/55 p-3">
            <p className="text-xs text-base-content/50">响应文本</p>
            <p className="mt-1 whitespace-pre-wrap break-words leading-6 text-base-content">{state.text}</p>
          </div>

          <details>
            <summary className="cursor-pointer text-xs text-base-content/55 hover:text-base-content">查看原始响应</summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-base-200 p-3 font-mono text-[11px] leading-5 text-base-content/70">{state.raw}</pre>
          </details>
        </div>
      )}
    </div>
  );
}

