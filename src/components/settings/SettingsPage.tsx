import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  detectClientInstallations,
  getAppSettings,
  listClientRuntimeLocations,
  saveAppSettings,
  type AppSettings,
  type ClientInstallation,
  type ClientId,
  type ExtensionLocation,
  type VisibleClients,
} from '../../lib/tauri';
import { Button } from '../shared/Button';
import { PowerIcon, RefreshIcon, SettingsIcon } from '../shared/ActionIcons';
import { IconDropdown, type IconDropdownOption } from '../shared/IconDropdown';
import {
  CLIENT_APPS,
  CLIENT_ORDER,
  DEFAULT_VISIBLE_CLIENTS,
  clientIcon,
  emitAppSettingsUpdated,
} from '../shared/clientApps';
import { ThemeToggle } from '../shared/ThemeToggle';
import { LanguageToggle } from '../shared/LanguageToggle';

type SettingPath = Pick<ExtensionLocation, 'label' | 'path' | 'exists' | 'entries'>;

function copyText(value: string) {
  if (value) void navigator.clipboard?.writeText(value);
}

function ClientDropdown({ active, onChange }: { active: ClientId; onChange: (value: ClientId) => void }) {
  const options: IconDropdownOption<ClientId>[] = CLIENT_APPS.map((client) => ({
    value: client.id,
    label: client.name,
    description: client.shortName,
    icon: clientIcon(client.id, 16),
  }));
  return <IconDropdown value={active} options={options} onChange={onChange} label="切换设置 App" buttonClassName="w-full md:w-64" />;
}

function PathRow({ item }: { item: SettingPath }) {
  return (
    <button
      type="button"
      onClick={() => copyText(item.path)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-base-300 bg-base-100/70 px-3 py-2 text-left transition hover:bg-base-200/70"
      title="点击复制路径"
    >
      <div className="min-w-0">
        <div className="text-xs font-semibold text-base-content/60">{item.label}</div>
        <div className="mt-1 truncate font-mono text-[11px] text-base-content/45">{item.path}</div>
      </div>
      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${item.exists ? 'border-success/25 bg-success/10 text-success' : 'border-base-300 text-base-content/45'}`}>
        {item.exists ? `${item.entries.length} 项` : '不存在'}
      </span>
    </button>
  );
}

function InstallationRow({ item }: { item: ClientInstallation }) {
  return (
    <div className="flex w-full items-center justify-between gap-3 rounded-xl border border-base-300 bg-base-100/70 px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-base-content/60">{item.name}</span>
          {item.command && <span className="rounded-md border border-base-300 bg-base-200 px-1.5 py-0.5 font-mono text-[10px] text-base-content/45">{item.command}</span>}
        </div>
        <div className="mt-1 truncate font-mono text-[11px] text-base-content/45">{item.path || item.error || '未定位到可执行文件'}</div>
        {item.version && <div className="mt-1 truncate text-[11px] text-base-content/55">{item.version}</div>}
        {!item.version && item.error && item.installed && <div className="mt-1 truncate text-[11px] text-warning">{item.error}</div>}
      </div>
      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${item.installed ? 'border-success/25 bg-success/10 text-success' : 'border-error/25 bg-error/10 text-error'}`}>
        {item.installed ? (item.version ? '已安装' : '已找到') : '未安装'}
      </span>
    </div>
  );
}

function ClientVisibilitySettings({ visibleClients, onToggle }: { visibleClients: VisibleClients; onToggle: (id: ClientId) => void }) {
  return (
    <section className="rounded-2xl border border-base-300 bg-base-100/80 p-3 shadow-xl">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 border-b border-base-300/70 pb-2">
          <div>
          <h3 className="text-base font-semibold text-base-content">AppSwitcher 显示</h3>
            <p className="mt-0.5 text-xs text-base-content/55">只影响 Header 的 AppSwitcher；不影响会话、MCP、Skills、Plugin 页面的 App 筛选。</p>
          </div>
          <span className="shrink-0 rounded-full border border-base-300 bg-base-200 px-2 py-0.5 text-[11px] text-base-content/55">
            {CLIENT_ORDER.filter((id) => visibleClients[id]).length}/{CLIENT_APPS.length}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
          {CLIENT_APPS.map((client) => {
            const visible = visibleClients[client.id];
            return (
              <button
                key={client.id}
                type="button"
                onClick={() => onToggle(client.id)}
                className={`flex min-w-0 items-center gap-2 rounded-xl border px-2 py-1.5 text-left transition ${
                  visible ? 'border-primary/35 bg-primary/10 text-base-content' : 'border-base-300 bg-base-200/50 text-base-content/45 hover:bg-base-200'
                }`}
                aria-pressed={visible}
                title={client.name}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-base-300/70 bg-base-100/70">
                  {clientIcon(client.id, 15)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{client.shortName}</span>
                <span className={`h-2 w-2 shrink-0 rounded-full ${visible ? 'bg-primary' : 'bg-base-content/20'}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ToggleRow({
  icon,
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition ${
        checked ? 'border-primary/35 bg-primary/10' : 'border-base-300 bg-base-200/45 hover:bg-base-200/75'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${checked ? 'border-primary/25 bg-primary/10 text-primary' : 'border-base-300 bg-base-100 text-base-content/55'}`}>
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-base-content">{title}</span>
          <span className="mt-0.5 block text-xs leading-snug text-base-content/55">{description}</span>
        </span>
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full border transition ${checked ? 'border-primary bg-primary' : 'border-base-300 bg-base-300'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-base-100 shadow transition ${checked ? 'left-5' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

export function SettingsPage() {
  const [appSettings, setAppSettings] = useState<AppSettings>({
    active_client: 'claude-code',
    visible_clients: DEFAULT_VISIBLE_CLIENTS,
    launch_on_startup: false,
    minimize_to_tray_on_close: true,
    skip_claude_onboarding: false,
  });
  const [paths, setPaths] = useState<ExtensionLocation[]>([]);
  const [installations, setInstallations] = useState<ClientInstallation[]>([]);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [loadingPaths, setLoadingPaths] = useState(false);
  const [loadingInstallations, setLoadingInstallations] = useState(false);
  const [savingBehavior, setSavingBehavior] = useState(false);
  const [error, setError] = useState('');

  const activeClient = appSettings.active_client;
  const activeDefinition = useMemo(() => CLIENT_APPS.find((client) => client.id === activeClient) ?? CLIENT_APPS[0], [activeClient]);

  const refreshSettings = useCallback(async () => {
    setLoadingSettings(true);
    setError('');
    try {
      const next = await getAppSettings();
      setAppSettings(next);
      emitAppSettingsUpdated(next);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingSettings(false);
    }
  }, []);

  const refreshPaths = useCallback(async (clientId: ClientId) => {
    setLoadingPaths(true);
    setLoadingInstallations(true);
    setError('');
    try {
      const [nextPaths, nextInstallations] = await Promise.all([
        listClientRuntimeLocations(clientId),
        detectClientInstallations(clientId),
      ]);
      setPaths(nextPaths);
      setInstallations(nextInstallations);
    } catch (err) {
      setPaths([]);
      setInstallations([]);
      setError(String(err));
    } finally {
      setLoadingPaths(false);
      setLoadingInstallations(false);
    }
  }, []);

  useEffect(() => { void refreshSettings(); }, [refreshSettings]);
  useEffect(() => { void refreshPaths(activeClient); }, [activeClient, refreshPaths]);

  const persistAppSettings = async (next: AppSettings) => {
    setError('');
    setSavingBehavior(true);
    try {
      const saved = await saveAppSettings(next);
      setAppSettings(saved);
      emitAppSettingsUpdated(saved);
    } catch (err) {
      setError(String(err));
    } finally {
      setSavingBehavior(false);
    }
  };

  const switchClient = (value: ClientId) => {
    void persistAppSettings({ ...appSettings, active_client: value });
  };

  const toggleVisibleClient = (id: ClientId) => {
    const visibleClients = appSettings.visible_clients;
    if (visibleClients[id] && CLIENT_ORDER.filter((clientId) => visibleClients[clientId]).length <= 1) return;
    const nextVisible = { ...visibleClients, [id]: !visibleClients[id] };
    void persistAppSettings({ ...appSettings, active_client: activeClient, visible_clients: nextVisible });
  };

  return (
    <div className="mx-auto max-w-[1800px] space-y-4">
      <section className="rounded-2xl border border-base-300 bg-base-200/70 p-4 shadow-xl">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">AgentDeck 设置</p>
            <h2 className="mt-1 text-xl font-semibold text-base-content">设置</h2>
            <p className="mt-2 text-sm text-base-content/55">设置页只加载当前 App 的用户级运行时路径，不再做全量会话和工具扫描。</p>
          </div>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-end">
            <ClientDropdown active={activeClient} onChange={switchClient} />
            <Button tone="secondary" onClick={() => void refreshPaths(activeClient)} disabled={loadingSettings || loadingPaths || loadingInstallations} className="btn-square" aria-label="刷新检测" title="刷新检测">
              {loadingSettings || loadingPaths || loadingInstallations ? <span className="loading loading-spinner loading-xs" /> : <RefreshIcon />}
            </Button>
          </div>
        </div>
      </section>

      {error && <div className="rounded-2xl border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</div>}

      <section className="rounded-2xl border border-base-300 bg-base-100/80 p-4 shadow-xl">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl border border-base-300 bg-base-200/70">{clientIcon(activeClient)}</div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-base-content">{activeDefinition.name}</h3>
            <p className="mt-1 text-sm text-base-content/55">{activeDefinition.description}</p>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <div className="mb-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-base-content/45">安装检测</div>
            {loadingInstallations ? <div className="rounded-xl border border-base-300 bg-base-200/50 p-4 text-sm text-base-content/55"><span className="loading loading-spinner loading-xs" /> 正在检测安装状态...</div> : null}
            {!loadingInstallations && installations.length === 0 ? <div className="rounded-xl border border-dashed border-base-300 p-4 text-sm text-base-content/45">没有可用的安装检测结果。</div> : null}
            {!loadingInstallations && installations.map((item, index) => <InstallationRow key={`${item.name}:${item.path ?? index}`} item={item} />)}
          </div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-base-content/45">运行时路径</div>
          {loadingPaths ? <div className="rounded-xl border border-base-300 bg-base-200/50 p-4 text-sm text-base-content/55"><span className="loading loading-spinner loading-xs" /> 正在读取当前 App 路径...</div> : null}
          {!loadingPaths && paths.length === 0 ? <div className="rounded-xl border border-dashed border-base-300 p-4 text-sm text-base-content/45">没有发现 {activeDefinition.name} 的用户级运行时路径。</div> : null}
          {!loadingPaths && paths.map((item) => <PathRow key={`${item.label}:${item.path}`} item={item} />)}
        </div>
      </section>

      <section className="rounded-2xl border border-base-300 bg-base-100/80 p-3 shadow-xl">
        <div className="space-y-3">
          <div className="flex items-center gap-2 border-b border-base-300/70 pb-2">
            <SettingsIcon className="h-4 w-4 text-primary" />
            <div>
              <h3 className="text-base font-semibold text-base-content">窗口与启动</h3>
              <p className="mt-0.5 text-xs text-base-content/55">配置启动、托盘和 Claude Code 首次确认行为。</p>
            </div>
          </div>
          <div className="grid gap-2 xl:grid-cols-3">
            <ToggleRow
              icon={<PowerIcon />}
              title="开机自启"
              description="随系统启动自动运行 AgentDeck。"
              checked={appSettings.launch_on_startup}
              disabled={savingBehavior}
              onChange={(value) => void persistAppSettings({ ...appSettings, launch_on_startup: value })}
            />
            <ToggleRow
              icon={<SettingsIcon />}
              title="关闭时最小化到托盘"
              description="点击关闭按钮时隐藏到系统托盘。"
              checked={appSettings.minimize_to_tray_on_close}
              disabled={savingBehavior}
              onChange={(value) => void persistAppSettings({ ...appSettings, minimize_to_tray_on_close: value })}
            />
            <ToggleRow
              icon={clientIcon('claude-code', 18)}
              title="跳过 Claude Code 初次安装确认"
              description="写入或移除 ~/.claude.json 的确认标记。"
              checked={appSettings.skip_claude_onboarding}
              disabled={savingBehavior}
              onChange={(value) => void persistAppSettings({ ...appSettings, skip_claude_onboarding: value })}
            />
          </div>
        </div>
      </section>

      <ClientVisibilitySettings visibleClients={appSettings.visible_clients} onToggle={toggleVisibleClient} />

      <section className="rounded-2xl border border-base-300 bg-base-100/80 p-4 shadow-xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-base font-semibold text-base-content">界面偏好</h3>
            <p className="mt-1 text-sm text-base-content/55">主题和语言使用全局控件，改动会立即保存到本机。</p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle />
          </div>
        </div>
      </section>
    </div>
  );
}
