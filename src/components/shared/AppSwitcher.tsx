import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAppSettings, saveAppSettings, type AppSettings, type ClientId } from '../../lib/tauri';
import { APP_SETTINGS_EVENT, CLIENT_APPS, DEFAULT_VISIBLE_CLIENTS, clientIcon, emitAppSettingsUpdated } from './clientApps';

interface AppSwitcherProps {
  className?: string;
  compact?: boolean;
  activeClient?: ClientId;
  onClientChange?: (clientId: ClientId) => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  active_client: 'claude-code',
  visible_clients: DEFAULT_VISIBLE_CLIENTS,
  launch_on_startup: false,
  minimize_to_tray_on_close: true,
  skip_claude_onboarding: false,
};

export function AppSwitcher({ className = '', compact = false, activeClient: controlledActiveClient, onClientChange }: AppSwitcherProps) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [savingClient, setSavingClient] = useState<ClientId | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setSettings(await getAppSettings());
    } catch {
      setSettings(DEFAULT_SETTINGS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onSettingsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<AppSettings>).detail;
      if (detail) setSettings(detail);
      else void refresh();
    };
    window.addEventListener(APP_SETTINGS_EVENT, onSettingsUpdated);
    return () => window.removeEventListener(APP_SETTINGS_EVENT, onSettingsUpdated);
  }, [refresh]);

  const clients = useMemo(() => CLIENT_APPS.filter((client) => settings.visible_clients[client.id]), [settings.visible_clients]);
  const effectiveActiveClient = controlledActiveClient ?? settings.active_client;
  const activeClient = CLIENT_APPS.find((client) => client.id === effectiveActiveClient) ?? CLIENT_APPS[0];

  const switchClient = async (id: ClientId) => {
    if (id === effectiveActiveClient || savingClient) return;

    const previous = settings;
    const optimistic: AppSettings = {
      ...settings,
      active_client: id,
    };

    setSavingClient(id);
    setSettings(optimistic);
    onClientChange?.(id);

    try {
      const saved = await saveAppSettings(optimistic);
      setSettings(saved);
      emitAppSettingsUpdated(saved);
      if (saved.active_client !== id) onClientChange?.(saved.active_client);
    } catch (error) {
      setSettings(previous);
      onClientChange?.(previous.active_client);
      console.error('Failed to switch active app', error);
    } finally {
      setSavingClient(null);
    }
  };

  const visibleClients = clients.length > 0 ? clients : CLIENT_APPS.filter((client) => DEFAULT_VISIBLE_CLIENTS[client.id]);
  const activeId = activeClient.id;

  return (
    <div className={`inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-base-300 bg-base-200/70 p-1 ${className}`} aria-label="AppSwitcher">
      {visibleClients.map((client) => {
        const selected = activeId === client.id;
        const saving = savingClient === client.id;
        return (
          <button
            key={client.id}
            type="button"
            onClick={() => void switchClient(client.id)}
            aria-pressed={selected}
            title={client.name}
            className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-xl px-2.5 text-sm font-medium transition ${
              selected
                ? 'bg-base-100 text-base-content shadow-sm ring-1 ring-primary/35'
                : 'text-base-content/55 hover:bg-base-100/60 hover:text-base-content'
            }`}
            disabled={loading || Boolean(savingClient)}
          >
            <span className="grid h-5 w-5 place-items-center rounded-md bg-base-100/70 ring-1 ring-base-300/70">
              {saving ? <span className="loading loading-spinner loading-xs" /> : clientIcon(client.id, 15)}
            </span>
            {!compact && <span className="hidden whitespace-nowrap xl:inline">{client.shortName}</span>}
          </button>
        );
      })}
    </div>
  );
}

