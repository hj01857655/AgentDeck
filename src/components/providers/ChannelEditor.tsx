import { useEffect, useMemo, useState } from 'react';
import { apiKeyFormatHint, providerDefaults, providerLabel, providerProtocolsForFamily, validateApiKey, type ProviderFamily, type ProviderProtocol } from '../../lib/providers';
import { apiProbeChannel, testChannel, type AddChannelRequest, type ApiProbeResult, type Channel } from '../../lib/tauri';
import { Button } from '../shared/Button';
import { ApiProbeIcon, DownloadIcon, SaveIcon, XIcon } from '../shared/ActionIcons';
import { Field, TextInput } from '../shared/Field';
import { useI18n } from '../../i18n';

function createEmptyForm(protocol: ProviderProtocol = 'openai-chat-completions') {
  const defaults = providerDefaults(protocol);
  return {
    name: '',
    base_url: defaults.base_url,
    api_key: '',
    models: '',
    protocol,
    weight: 1,
  };
}

function parseModels(value: string) {
  return value.split(',').map((model) => model.trim()).filter(Boolean);
}

function serializeModels(models: string[]) {
  return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean))).join(',');
}

function modelCacheKey(protocol: ProviderProtocol, baseUrl: string) {
  return `ai-gateway:model-list:${protocol}:${baseUrl.trim().replace(/\/+$/, '')}`;
}

function readModelCache(protocol: ProviderProtocol, baseUrl: string): string[] {
  if (typeof window === 'undefined' || !baseUrl.trim()) return [];
  try {
    const raw = window.localStorage.getItem(modelCacheKey(protocol, baseUrl));
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed?.models) ? parsed.models.filter((item: unknown) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeModelCache(protocol: ProviderProtocol, baseUrl: string, models: string[]) {
  if (typeof window === 'undefined' || !baseUrl.trim() || models.length === 0) return;
  window.localStorage.setItem(modelCacheKey(protocol, baseUrl), JSON.stringify({ models, cached_at: Date.now() }));
}

type ApiProbeState =
  | { kind: 'running'; model: string }
  | { kind: 'done'; result: ApiProbeResult; ok: boolean; summary: string; raw: string }
  | { kind: 'error'; model: string; message: string };

function stringFromPath(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  return null;
}

function summarizeApiBody(body: string): string {
  if (!body.trim()) return '响应体为空。';

  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const error = json.error as Record<string, unknown> | undefined;
    const errorMessage = stringFromPath(error?.message) ?? stringFromPath(json.message);
    if (errorMessage) return errorMessage;

    const outputText = stringFromPath(json.output_text);
    if (outputText) return outputText;

    const choices = json.choices;
    if (Array.isArray(choices)) {
      const first = choices[0] as Record<string, unknown> | undefined;
      const message = first?.message as Record<string, unknown> | undefined;
      const content = stringFromPath(message?.content) ?? stringFromPath(first?.text);
      if (content) return content;
    }

    const content = json.content;
    if (Array.isArray(content)) {
      const firstText = content
        .map((item) => stringFromPath((item as Record<string, unknown>)?.text))
        .find(Boolean);
      if (firstText) return firstText;
    }

    const object = stringFromPath(json.object);
    const id = stringFromPath(json.id);
    if (object || id) return [object, id].filter(Boolean).join(' · ');

    return body.slice(0, 240);
  } catch {
    return body.slice(0, 240);
  }
}

interface ChannelEditorProps {
  channel?: Channel | null;
  defaultProtocol?: ProviderProtocol;
  providerPage: ProviderFamily;
  saving: boolean;
  onCancel: () => void;
  onSave: (req: AddChannelRequest) => Promise<void>;
}

export function ChannelEditor({ channel, defaultProtocol = 'openai-chat-completions', providerPage, saving, onCancel, onSave }: ChannelEditorProps) {
  const { t } = useI18n();
  const [form, setForm] = useState(createEmptyForm(defaultProtocol));
  const [error, setError] = useState<string | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [apiProbing, setApiProbing] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiProbeState | null>(null);

  const selectedModels = useMemo(() => parseModels(form.models), [form.models]);
  const modelOptions = useMemo(() => Array.from(new Set([...discoveredModels, ...selectedModels])).sort(), [discoveredModels, selectedModels]);
  const protocolOptions = useMemo(() => providerProtocolsForFamily(providerPage), [providerPage]);

  useEffect(() => {
    if (channel) {
      setForm({
        name: channel.name,
        base_url: channel.base_url,
        api_key: channel.api_key,
        models: serializeModels(channel.models),
        protocol: channel.protocol,
        weight: channel.weight,
      });
    } else {
      setForm(createEmptyForm(defaultProtocol));
    }
    setError(null);
    setDiscoveredModels([]);
    setModelError(null);
    setModelPickerOpen(false);
    setShowApiKey(false);
    setApiStatus(null);
  }, [channel, defaultProtocol]);

  useEffect(() => {
    const cached = readModelCache(form.protocol, form.base_url);
    setDiscoveredModels(cached);
    setModelError(null);
    setModelPickerOpen(false);
  }, [form.protocol, form.base_url]);

  const setProtocol = (protocol: ProviderProtocol) => {
    const defaults = providerDefaults(protocol);
    setForm((current) => ({
      ...current,
      protocol,
      base_url: defaults.base_url,
      models: '',
    }));
    setDiscoveredModels([]);
    setModelError(null);
    setModelPickerOpen(false);
    setApiStatus(null);
  };

  const toggleModel = (model: string) => {
    if (!model) return;
    setForm((current) => {
      const models = parseModels(current.models);
      const nextModels = models.includes(model) ? models.filter((item) => item !== model) : [...models, model];
      return { ...current, models: serializeModels(nextModels) };
    });
  };

  const selectAllModels = () => {
    if (modelOptions.length === 0) return;
    setForm((current) => ({ ...current, models: serializeModels(modelOptions) }));
  };

  const unselectAllModels = () => {
    setForm((current) => ({ ...current, models: '' }));
  };

  const removeModel = (model: string) => {
    setForm((current) => ({ ...current, models: serializeModels(parseModels(current.models).filter((item) => item !== model)) }));
  };

  const fetchModels = async () => {
    if (!form.base_url.trim()) return setError(t('editor.baseUrlRequired'));
    const apiKeyError = validateApiKey(form.protocol, form.api_key);
    if (apiKeyError) return setError(apiKeyError);

    setError(null);
    setModelError(null);
    setFetchingModels(true);
    try {
      const result = await testChannel(form.base_url.trim().replace(/\/+$/, ''), form.api_key.trim(), form.protocol);
      if (result.status >= 400) {
        setModelError(`获取模型失败 · HTTP ${result.status}`);
        setModelPickerOpen(true);
        return;
      }
      setDiscoveredModels(result.models);
      writeModelCache(form.protocol, form.base_url, result.models);
      setModelPickerOpen(true);
      if (result.models.length === 0) setModelError('接口未返回模型列表。');
    } catch (err) {
      setModelError(`获取模型失败 · ${String(err)}`);
      setModelPickerOpen(true);
    } finally {
      setFetchingModels(false);
    }
  };

  const probeApi = async () => {
    if (!form.base_url.trim()) return setError(t('editor.baseUrlRequired'));
    const apiKeyError = validateApiKey(form.protocol, form.api_key);
    if (apiKeyError) return setError(apiKeyError);
    const model = selectedModels[0];
    if (!model) return setError(t('editor.modelsRequired'));

    setError(null);
    setApiStatus({ kind: 'running', model });
    setApiProbing(true);
    try {
      const result = await apiProbeChannel(form.base_url.trim().replace(/\/+$/, ''), form.api_key.trim(), model, form.protocol);
      const ok = result.status < 400;
      setApiStatus({
        kind: 'done',
        result,
        ok,
        summary: summarizeApiBody(result.body),
        raw: result.body || '响应体为空。',
      });
    } catch (err) {
      setApiStatus({ kind: 'error', model, message: String(err) });
    } finally {
      setApiProbing(false);
    }
  };

  const submit = async () => {
    const models = selectedModels;
    if (!form.name.trim()) return setError(t('editor.nameRequired'));
    if (!form.base_url.trim()) return setError(t('editor.baseUrlRequired'));
    const apiKeyError = validateApiKey(form.protocol, form.api_key);
    if (apiKeyError) return setError(apiKeyError);
    if (models.length === 0) return setError(t('editor.modelsRequired'));

    setError(null);
    await onSave({
      name: form.name.trim(),
      base_url: form.base_url.trim().replace(/\/+$/, ''),
      api_key: form.api_key.trim(),
      models,
      protocol: form.protocol,
      weight: Number(form.weight) || 1,
    });
  };

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t('editor.name')}>
          <TextInput value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="prod-openai-key" />
        </Field>
        <Field label={t('editor.protocol')}>
          <select
            value={form.protocol}
            onChange={(event) => setProtocol(event.target.value as ProviderProtocol)}
            className="select select-bordered w-full bg-base-100"
          >
            {protocolOptions.map((protocol) => (
              <option key={protocol} value={protocol}>{providerLabel(protocol)}</option>
            ))}
          </select>
        </Field>
        <Field label={t('editor.baseUrl')}>
          <TextInput value={form.base_url} onChange={(event) => setForm({ ...form, base_url: event.target.value })} placeholder="https://api.openai.com" className="font-mono" />
        </Field>
        <Field label={t('editor.weight')} hint={t('editor.weightHint')}>
          <TextInput value={form.weight} onChange={(event) => setForm({ ...form, weight: Number(event.target.value) })} type="number" />
        </Field>
        <div className="md:col-span-2">
          <Field label={t('editor.apiKey')} hint={apiKeyFormatHint(form.protocol)}>
            <div className="relative">
              <input
                value={form.api_key}
                onChange={(event) => setForm({ ...form, api_key: event.target.value })}
                type={showApiKey ? 'text' : 'password'}
                placeholder="sk-..."
                className="input input-bordered w-full bg-base-100 pr-11 font-mono text-base-content placeholder:text-base-content/35"
              />
              <button
                type="button"
                className="btn btn-ghost btn-square btn-sm absolute right-1.5 top-1/2 -translate-y-1/2 text-base-content/60 hover:text-base-content"
                onClick={() => setShowApiKey((visible) => !visible)}
                aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
                title={showApiKey ? '隐藏 API Key' : '显示 API Key'}
              >
                {showApiKey ? (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 3l18 18" />
                    <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                    <path d="M9.9 4.2A10.7 10.7 0 0 1 12 4c5 0 8.5 4.1 10 8a15.7 15.7 0 0 1-2.1 3.5" />
                    <path d="M6.6 6.6C4.5 8 3 10.1 2 12c2 3.9 5 8 10 8 1.5 0 2.8-.4 4-1" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label={t('editor.models')} hint={t('editor.modelsHint')}>
            <div className="space-y-3 rounded-2xl border border-base-300 bg-base-200/50 p-3">
              <div className="relative">
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-outline min-w-0 flex-1 justify-between bg-base-100 font-normal"
                    onClick={() => setModelPickerOpen((open) => !open)}
                  >
                    <span>{selectedModels.length > 0 ? `已选择 ${selectedModels.length} 个模型` : discoveredModels.length > 0 ? `可选 ${discoveredModels.length} 个模型` : '点击获取模型后勾选'}</span>
                    <span className="text-base-content/45">⌄</span>
                  </button>
                  <Button
                    tone="secondary"
                    disabled={fetchingModels || !form.base_url.trim() || !form.api_key.trim()}
                    onClick={() => void fetchModels()}
                    className="btn-square shrink-0"
                    aria-label={fetchingModels ? '获取模型中' : '获取模型'}
                    title={fetchingModels ? '获取模型中' : '获取模型'}
                  >
                    {fetchingModels ? <span className="loading loading-spinner loading-xs" /> : <DownloadIcon />}
                  </Button>
                </div>

                {modelPickerOpen && (
                  <div className="absolute left-0 right-0 top-full z-20 mt-2 max-h-72 overflow-auto rounded-2xl border border-base-300 bg-base-100 p-2 shadow-2xl">
                    {modelError && <div className="mb-2 rounded-xl border border-error/25 bg-error/10 p-2 text-xs text-error">{modelError}</div>}
                    {modelOptions.length === 0 ? (
                      <div className="p-3 text-sm text-base-content/55">还没有模型列表。点击右侧“获取模型”后在这里勾选。</div>
                    ) : (
                      <div className="space-y-2">
                        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-xl border border-base-300 bg-base-100/95 px-3 py-2 backdrop-blur">
                          <span className="text-xs text-base-content/55">已选 {selectedModels.length} / {modelOptions.length}</span>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              className="btn btn-primary btn-square btn-xs"
                              onClick={selectAllModels}
                              aria-label="全选模型"
                              title="全选模型"
                            >
                              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="m4 12 4 4L20 4" />
                                <path d="m4 20 4 0" />
                                <path d="M13 20h7" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline btn-square btn-xs"
                              onClick={unselectAllModels}
                              aria-label="取消全选模型"
                              title="取消全选模型"
                            >
                              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M5 12h14" />
                                <path d="M8 6h11" />
                                <path d="M8 18h11" />
                              </svg>
                            </button>
                          </div>
                        </div>
                        <div className="grid gap-1">
                          {modelOptions.map((model) => (
                            <label key={model} className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-base-200">
                              <input
                                type="checkbox"
                                className="checkbox checkbox-primary checkbox-sm"
                                checked={selectedModels.includes(model)}
                                onChange={() => toggleModel(model)}
                              />
                              <span className="font-mono">{model}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {selectedModels.map((model) => (
                  <span key={model} className="inline-flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/10 px-2.5 py-1.5 font-mono text-xs text-primary">
                    {model}
                    <button
                      type="button"
                      onClick={() => removeModel(model)}
                      className="rounded px-1 text-primary/65 transition hover:bg-primary/10 hover:text-primary"
                      aria-label={`移除模型 ${model}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {selectedModels.length === 0 && <span className="text-xs text-base-content/55">还没有选择模型。</span>}
              </div>
              {discoveredModels.length > 0 && <div className="text-xs text-base-content/45">已缓存 {discoveredModels.length} 个模型；下次打开同一协议和 Base URL 会直接可选。</div>}
            </div>
          </Field>
        </div>

        <div className="rounded-2xl border border-base-300 bg-base-200/50 p-4 md:col-span-2">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-medium text-base-content">API 探测</p>
              <p className="mt-1 text-xs leading-5 text-base-content/55">只用已选模型发起一次最小真实请求，验证协议接口可用性。</p>
            </div>
            <Button
              tone="secondary"
              disabled={apiProbing || !form.base_url.trim() || !form.api_key.trim() || selectedModels.length === 0}
              onClick={() => void probeApi()}
              className="btn-square shrink-0"
              aria-label={apiProbing ? 'API 探测中' : 'API 探测'}
              title={apiProbing ? 'API 探测中' : 'API 探测'}
            >
              {apiProbing ? <span className="loading loading-spinner loading-xs" /> : <ApiProbeIcon />}
            </Button>
          </div>
          {apiStatus && (
            <div className="mt-3 rounded-2xl border border-base-300 bg-base-100/75 p-3 text-xs text-base-content/70">
              {apiStatus.kind === 'running' && (
                <div className="flex items-center justify-between gap-3">
                  <span>正在用模型 <span className="font-mono text-base-content">{apiStatus.model}</span> 发起最小请求...</span>
                  <span className="loading loading-spinner loading-xs" />
                </div>
              )}

              {apiStatus.kind === 'error' && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge badge-error badge-sm">探测失败</span>
                    <span className="font-mono">{apiStatus.model}</span>
                  </div>
                  <p className="leading-5 text-error">{apiStatus.message}</p>
                </div>
              )}

              {apiStatus.kind === 'done' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`badge badge-sm ${apiStatus.ok ? 'badge-success' : 'badge-error'}`}>
                      {apiStatus.ok ? '探测成功' : '探测失败'}
                    </span>
                    <span className="badge badge-outline badge-sm">HTTP {apiStatus.result.status}</span>
                    <span className="badge badge-outline badge-sm">{apiStatus.result.elapsed_ms}ms</span>
                  </div>

                  <div className="grid gap-2 md:grid-cols-3">
                    <div className="rounded-xl border border-base-300 bg-base-200/55 p-3">
                      <p className="text-base-content/50">协议</p>
                      <p className="mt-1 font-medium text-base-content">{providerLabel(form.protocol)}</p>
                    </div>
                    <div className="rounded-xl border border-base-300 bg-base-200/55 p-3">
                      <p className="text-base-content/50">模型</p>
                      <p className="mt-1 font-mono font-medium text-base-content">{apiStatus.result.model}</p>
                    </div>
                    <div className="rounded-xl border border-base-300 bg-base-200/55 p-3">
                      <p className="text-base-content/50">Base URL</p>
                      <p className="mt-1 truncate font-mono font-medium text-base-content">{form.base_url.trim().replace(/\/+$/, '')}</p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-base-300 bg-base-200/55 p-3">
                    <p className="text-base-content/50">响应摘要</p>
                    <p className="mt-1 whitespace-pre-wrap break-words leading-5 text-base-content">{apiStatus.summary}</p>
                  </div>

                  <details>
                    <summary className="cursor-pointer text-base-content/55 hover:text-base-content">查看原始响应</summary>
                    <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-base-200 p-3 font-mono text-[11px] leading-5 text-base-content/70">
                      {apiStatus.raw}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {error && <div className="mt-4 rounded-2xl border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</div>}

      <div className="mt-5 flex justify-end gap-3">
        <Button tone="ghost" onClick={onCancel} className="btn-square" aria-label={t('editor.cancel')} title={t('editor.cancel')}>
          <XIcon />
        </Button>
        <Button tone="primary" disabled={saving} onClick={submit} className="btn-square" aria-label={saving ? t('editor.saving') : channel ? t('editor.save') : t('editor.add')} title={saving ? t('editor.saving') : channel ? t('editor.save') : t('editor.add')}>
          {saving ? <span className="loading loading-spinner loading-xs" /> : <SaveIcon />}
        </Button>
      </div>
    </div>
  );
}

