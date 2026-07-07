import { useCallback, useMemo, useState, useEffect } from 'react';
import {
  addChannel,
  applyChannelToTool,
  deleteChannel,
  getConsoleSettings,
  getToolUiState,
  listChannels,
  probeChannel,
  saveConsoleSettings,
  saveToolUiState,
  updateChannel,
  setChannelEnabled,
  type AddChannelRequest,
  type Channel,
  type ClientId,
  type ToolSyncTarget,
} from '../lib/tauri';
import {
  buildProviderGroups,
  defaultProtocolForFamily,
  providerFamily,
  providerProtocolsForFamily,
  type ProviderFamily,
  type ProviderProtocol,
} from '../lib/providers';
import { Button } from './shared/Button';
import { Badge } from './shared/Badge';
import { Dialog } from './shared/Dialog';
import { EmptyState } from './shared/EmptyState';
import { PlusIcon, RefreshIcon, RouteProbeIcon, TrashIcon, XIcon } from './shared/ActionIcons';
import { Overview } from './providers/Overview';
import { ProviderSection } from './providers/ProviderSection';
import { ChannelEditor } from './providers/ChannelEditor';
import { RouteProbeDialog } from './providers/RouteProbeDialog';
import { useI18n } from '../i18n';
import { clientIcon, getClientApp } from './shared/clientApps';

type PendingAction = { kind: 'delete'; channel: Channel };

type AppliedToolChannelIds = Partial<Record<ToolSyncTarget, string>>;

interface DashboardProps {
  activeClient: ClientId;
}

function providerFamilyForClient(clientId: ClientId): ProviderFamily | null {
  if (clientId === 'codex') return 'openai';
  if (clientId === 'claude-code') return 'anthropic';
  return null;
}

function syncTargetForClient(clientId: ClientId): ToolSyncTarget | null {
  if (clientId === 'codex') return 'codex';
  if (clientId === 'claude-code') return 'claude';
  return null;
}

export default function Dashboard({ activeClient }: DashboardProps) {
  const { t } = useI18n();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activePage, setActivePage] = useState<ProviderFamily | null>('openai');
  const [defaultProtocol, setDefaultProtocol] = useState<ProviderProtocol>('openai-chat-completions');
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [showRouteProbe, setShowRouteProbe] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<string | null>(null);
  const [appliedToolChannelIds, setAppliedToolChannelIds] = useState<AppliedToolChannelIds>({});
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const refreshChannels = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      const fresh = await listChannels();
      setChannels(fresh);
      setSelectedChannelId((current) => {
        if (current && fresh.some((channel) => channel.id === current)) return current;
        return fresh[0]?.id ?? '';
      });
    } catch (err) {
      setPageError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshChannels();
  }, [refreshChannels]);

  useEffect(() => {
    let cancelled = false;
    void getToolUiState()
      .then((state) => {
        if (!cancelled) setAppliedToolChannelIds(state.applied_tool_channel_ids ?? {});
      })
      .catch((err) => {
        if (!cancelled) setPageError(String(err));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const nextFamily = providerFamilyForClient(activeClient);
    setActivePage(nextFamily);
    if (!nextFamily) return;
    setDefaultProtocol((current) => {
      const protocols = providerProtocolsForFamily(nextFamily);
      return protocols.includes(current) ? current : defaultProtocolForFamily(nextFamily);
    });
  }, [activeClient]);

  useEffect(() => {
    let cancelled = false;

    void getConsoleSettings()
      .then((settings) => {
        if (cancelled) return;
        setDefaultProtocol(settings.default_protocol);
        setSelectedChannelId(settings.selected_channel_id ?? '');
      })
      .catch((err) => {
        if (!cancelled) setPageError(String(err));
      })
      .finally(() => {
        if (!cancelled) setSettingsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;

    void saveConsoleSettings({
      active_provider: 'all',
      selected_channel_id: selectedChannelId || null,
      default_protocol: defaultProtocol,
    }).catch((err) => setPageError(String(err)));
  }, [defaultProtocol, selectedChannelId, settingsLoaded]);

  const pageChannels = useMemo(() => {
    if (!activePage) return [];
    const protocols = providerProtocolsForFamily(activePage);
    return channels.filter((channel) => protocols.includes(channel.protocol));
  }, [activePage, channels]);
  const groups = useMemo(() => buildProviderGroups(pageChannels), [pageChannels]);
  const defaultProtocolForPage = useMemo(() => {
    if (!activePage) return 'openai-chat-completions';
    const protocols = providerProtocolsForFamily(activePage);
    return protocols.includes(defaultProtocol) ? defaultProtocol : defaultProtocolForFamily(activePage);
  }, [activePage, defaultProtocol]);

  const openNewChannel = () => {
    setEditingChannel(null);
    setShowEditor(true);
  };

  const openEditChannel = (channel: Channel) => {
    setEditingChannel(channel);
    setShowEditor(true);
  };

  const handleSaveChannel = async (req: AddChannelRequest) => {
    setSaving(true);
    setPageError(null);
    setPageNotice(null);
    try {
      if (editingChannel) {
        await updateChannel(editingChannel.id, req);
      } else {
        const id = await addChannel(req);
        setSelectedChannelId(id);
      }
      setDefaultProtocol(req.protocol);
      setActivePage(providerFamily(req.protocol));
      setShowEditor(false);
      setEditingChannel(null);
      await refreshChannels();
    } catch (err) {
      setPageError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteChannel = async (channel: Channel) => {
    setPageError(null);
    setPageNotice(null);
    try {
      await deleteChannel(channel.id);
      await refreshChannels();
    } catch (err) {
      setPageError(String(err));
    }
  };

  const handleToggleEnabled = async (channel: Channel) => {
    setPageError(null);
    setPageNotice(null);
    try {
      await setChannelEnabled(channel.id, !channel.enabled);
      await refreshChannels();
    } catch (err) {
      setPageError(String(err));
    }
  };

  const handleProbeChannel = async (channel: Channel) => {
    setPageError(null);
    setPageNotice(null);
    try {
      const result = await probeChannel(channel.id);
      setPageNotice(`检测完成：HTTP ${result.status} · ${result.elapsed_ms}ms${result.models.length ? ` · 更新 ${result.models.length} 个模型` : ''}`);
      await refreshChannels();
    } catch (err) {
      setPageError(String(err));
      await refreshChannels();
    }
  };

  const handleEnableForTool = async (channel: Channel, target: ToolSyncTarget) => {
    setPageError(null);
    setPageNotice(null);
    setSelectedChannelId(channel.id);
    try {
      const result = await applyChannelToTool(channel.id, target);
      const state = await getToolUiState();
      const nextApplied = { ...(state.applied_tool_channel_ids ?? {}), [target]: channel.id };
      await saveToolUiState({ ...state, applied_tool_channel_ids: nextApplied });
      setAppliedToolChannelIds(nextApplied);
      const targetName = target === 'codex' ? 'Codex' : 'Claude';
      setPageNotice(`已启用 ${targetName} 当前提供商：更新 ${result.files.length} 个文件，备份 ${result.backups.length} 个文件。`);
    } catch (err) {
      setPageError(String(err));
    }
  };

  const confirmPendingAction = async () => {
    const action = pendingAction;
    if (!action) return;
    setPendingAction(null);

    if (action.kind === 'delete') {
      await handleDeleteChannel(action.channel);
    }
  };

  const pendingActionTitle = '删除提供商配置';

  const pendingActionDescription = pendingAction?.kind === 'delete'
    ? `将删除提供商配置「${pendingAction.channel.name}」，此操作不可撤销。`
    : '';

  const activeClientInfo = getClientApp(activeClient);
  const hasProviderPlane = activePage !== null;
  const syncTarget = syncTargetForClient(activeClient);

  return (
    <div className="mx-auto max-w-[1800px]">
      <main className="min-w-0 space-y-5">
        <Overview groups={groups} channels={pageChannels} />

        {pageError && (
          <div className="rounded-2xl border border-error/30 bg-error/10 p-4 text-sm text-error">
            {pageError}
          </div>
        )}

        {pageNotice && (
          <div className="rounded-2xl border border-success/30 bg-success/10 p-4 text-sm text-success">
            {pageNotice}
          </div>
        )}

        {!hasProviderPlane ? (
          <section className="rounded-3xl border border-base-300 bg-base-100/80 p-6 shadow-xl">
            <div className="flex items-start gap-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-base-300 bg-base-200/70">
                {clientIcon(activeClient, 22)}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{activeClientInfo.shortName}</p>
                <h2 className="mt-1 text-xl font-semibold text-base-content">{activeClientInfo.name} 暂未接入提供商配置</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-base-content/55">
                  提供商配置目前只对 Codex 和 Claude Code（CLI）生效。{activeClientInfo.name} 的运行时路径、MCP、Skills、Plugin 可在对应管理页或设置页查看，不会再强行显示成 OpenAI Compatible。
                </p>
              </div>
            </div>
          </section>
        ) : (
        <section className="rounded-3xl border border-base-300 bg-base-200/55 p-4 shadow-2xl">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold text-base-content">{activePage === 'openai' ? 'OpenAI / OpenAI Compatible' : 'Anthropic Messages'}</h2>
                <Badge tone="info">{pageChannels.length} {t('providerMatrix.channels')}</Badge>
              </div>
              <p className="mt-2 text-sm text-base-content/55">
                当前 AppSwitcher 只在 Codex / Claude Code（CLI）间切换提供商配置上下文。其它 App 不再映射到 OpenAI Compatible。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button tone="secondary" onClick={() => void refreshChannels()} disabled={loading} className="btn-square" aria-label={loading ? t('dashboard.refreshing') : t('dashboard.refresh')} title={loading ? t('dashboard.refreshing') : t('dashboard.refresh')}>
                {loading ? <span className="loading loading-spinner loading-xs" /> : <RefreshIcon />}
              </Button>
              <Button tone="secondary" onClick={() => setShowRouteProbe(true)} disabled={pageChannels.length === 0} className="btn-square" aria-label="路由探测" title="路由探测">
                <RouteProbeIcon />
              </Button>
              <Button tone="primary" onClick={openNewChannel} className="btn-square" aria-label="添加提供商" title="添加提供商">
                <PlusIcon />
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="grid gap-2">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-16 animate-pulse rounded-2xl border border-base-300 bg-base-100/60" />
              ))}
            </div>
          ) : pageChannels.length === 0 ? (
            <EmptyState
              title="还没有提供商配置"
              description="添加服务地址、API Key、协议、模型和权重后，网关就能开始路由请求。"
            />
          ) : (
            <div className="grid gap-3">
              {groups.map((group) => (
                <ProviderSection
                  key={group.protocol}
                  group={group}
                  selectedChannelId={selectedChannelId}
                  syncTarget={syncTarget}
                  appliedToolChannelIds={appliedToolChannelIds}
                  onEdit={openEditChannel}
                  onDelete={(channel) => setPendingAction({ kind: 'delete', channel })}
                  onToggleEnabled={handleToggleEnabled}
                  onProbe={handleProbeChannel}
                  onEnableForTool={(channel, target) => void handleEnableForTool(channel, target)}
                />
              ))}
            </div>
          )}
        </section>
        )}
      </main>

      <Dialog
        open={showEditor}
        title={editingChannel ? '编辑提供商配置' : '添加提供商'}
        description="配置协议、服务地址、API Key、模型和路由权重。"
        onClose={() => setShowEditor(false)}
        size="lg"
      >
        <ChannelEditor
          channel={editingChannel}
          defaultProtocol={editingChannel?.protocol ?? defaultProtocolForPage}
          providerPage={activePage ?? 'openai'}
          saving={saving}
          onCancel={() => setShowEditor(false)}
          onSave={handleSaveChannel}
        />
      </Dialog>

      <Dialog
        open={showRouteProbe}
        title="路由探测"
        description="按模型走网关路由，验证最终命中的提供商配置和响应内容。"
        onClose={() => setShowRouteProbe(false)}
        size="lg"
      >
        <RouteProbeDialog channels={pageChannels} />
      </Dialog>

      <Dialog
        open={pendingAction !== null}
        title={pendingActionTitle}
        description={pendingActionDescription}
        onClose={() => setPendingAction(null)}
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <Button tone="ghost" onClick={() => setPendingAction(null)} className="btn-square" aria-label="取消" title="取消">
              <XIcon />
            </Button>
            <Button tone="danger" onClick={() => void confirmPendingAction()} className="btn-square" aria-label="确认删除" title="确认删除">
              <TrashIcon />
            </Button>
          </div>
        }
      >
        <div className="rounded-2xl border border-base-300 bg-base-200/70 p-4 text-sm leading-6 text-base-content/70">
          删除后如需恢复，需要重新添加提供商配置。
        </div>
      </Dialog>
    </div>
  );
}
