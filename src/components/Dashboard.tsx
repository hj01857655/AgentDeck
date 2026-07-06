import { useCallback, useMemo, useState, useEffect } from 'react';
import {
  addChannel,
  applyChannelToTool,
  deleteChannel,
  getConsoleSettings,
  listChannels,
  saveConsoleSettings,
  updateChannel,
  setChannelEnabled,
  type AddChannelRequest,
  type Channel,
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
import { ProviderSidebar } from './providers/ProviderSidebar';
import { Overview } from './providers/Overview';
import { ProviderSection } from './providers/ProviderSection';
import { ChannelEditor } from './providers/ChannelEditor';
import { RouteProbeDialog } from './providers/RouteProbeDialog';
import { useI18n } from '../i18n';

type PendingAction = { kind: 'delete'; channel: Channel };

type AppliedToolChannelIds = Partial<Record<ToolSyncTarget, string>>;

const appliedToolStorageKey = 'ai-gateway:applied-tool-channel-ids';

function readAppliedToolChannelIds(): AppliedToolChannelIds {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(appliedToolStorageKey) ?? '{}') as AppliedToolChannelIds;
    return {
      codex: typeof parsed.codex === 'string' ? parsed.codex : undefined,
      claude: typeof parsed.claude === 'string' ? parsed.claude : undefined,
    };
  } catch {
    return {};
  }
}

function writeAppliedToolChannelIds(value: AppliedToolChannelIds) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(appliedToolStorageKey, JSON.stringify(value));
}

export default function Dashboard() {
  const { t } = useI18n();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activePage, setActivePage] = useState<ProviderFamily>('openai');
  const [defaultProtocol, setDefaultProtocol] = useState<ProviderProtocol>('openai-chat-completions');
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [showRouteProbe, setShowRouteProbe] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<string | null>(null);
  const [appliedToolChannelIds, setAppliedToolChannelIds] = useState<AppliedToolChannelIds>(() => readAppliedToolChannelIds());
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
    const protocols = providerProtocolsForFamily(activePage);
    return channels.filter((channel) => protocols.includes(channel.protocol));
  }, [activePage, channels]);
  const groups = useMemo(() => buildProviderGroups(pageChannels), [pageChannels]);
  const defaultProtocolForPage = useMemo(() => {
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

  const handleApplyToTool = async (channel: Channel, target: ToolSyncTarget) => {
    setPageError(null);
    setPageNotice(null);
    setSelectedChannelId(channel.id);
    try {
      const result = await applyChannelToTool(channel.id, target);
      const nextApplied = { ...appliedToolChannelIds, [target]: channel.id };
      setAppliedToolChannelIds(nextApplied);
      writeAppliedToolChannelIds(nextApplied);
      const targetName = target === 'codex' ? 'Codex' : 'Claude';
      setPageNotice(`已应用到 ${targetName}：更新 ${result.files.length} 个文件，备份 ${result.backups.length} 个文件。`);
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

  return (
    <div className="mx-auto grid max-w-[1800px] gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
      <ProviderSidebar groups={buildProviderGroups(channels)} activePage={activePage} onSelectPage={setActivePage} />

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

        <section className="rounded-3xl border border-base-300 bg-base-200/55 p-4 shadow-2xl">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold text-base-content">{activePage === 'openai' ? 'OpenAI' : 'Anthropic'}</h2>
                <Badge tone="info">{pageChannels.length} {t('providerMatrix.channels')}</Badge>
              </div>
              <p className="mt-2 text-sm text-base-content/55">
                {t('dashboard.allDescription')}
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
                  appliedToolChannelIds={appliedToolChannelIds}
                  onEdit={openEditChannel}
                  onDelete={(channel) => setPendingAction({ kind: 'delete', channel })}
                  onToggleEnabled={handleToggleEnabled}
                  onApplyToTool={(channel, target) => void handleApplyToTool(channel, target)}
                />
              ))}
            </div>
          )}
        </section>
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
          providerPage={activePage}
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
