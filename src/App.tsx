import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Dashboard from './components/Dashboard';
import { LanguageToggle } from './components/shared/LanguageToggle';
import { ThemeToggle } from './components/shared/ThemeToggle';
import { AppSwitcher } from './components/shared/AppSwitcher';
import { APP_SETTINGS_EVENT } from './components/shared/clientApps';
import { getAppSettings, type AppSettings, type ClientId } from './lib/tauri';
import { McpIcon, PluginIcon, SessionIcon, SettingsIcon, SkillsIcon } from './components/shared/ActionIcons';
import { ExtensionManagementPage, type ExtensionKind } from './components/extensions/ExtensionManagementPage';
import { SessionManagementPage } from './components/sessions/SessionManagementPage';
import { SettingsPage } from './components/settings/SettingsPage';
import { useI18n } from './i18n';

type WorkspacePage = 'providers' | 'sessions' | 'settings' | ExtensionKind;

interface HeaderToolButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}

function HeaderToolButton({ label, active, onClick, children }: HeaderToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`btn btn-square btn-sm border ${
        active
          ? 'border-primary/60 bg-primary/15 text-primary shadow-[inset_0_0_0_1px_var(--color-primary)]'
          : 'btn-ghost border-base-300 bg-base-200/70 text-base-content/70 hover:border-primary/40 hover:bg-primary/10 hover:text-primary'
      }`}
    >
      {children}
    </button>
  );
}

function BackIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function pageTitle(page: WorkspacePage, providersTitle: string) {
  if (page === 'providers') return providersTitle;
  if (page === 'mcp') return 'MCP 管理';
  if (page === 'skills') return 'Skills 管理';
  if (page === 'plugin') return 'Plugin 管理';
  if (page === 'settings') return '设置';
  if (page === 'sessions') return '会话管理';
  return providersTitle;
}

function App() {
  const { t } = useI18n();
  const [activePage, setActivePage] = useState<WorkspacePage>('providers');
  const [activeClient, setActiveClient] = useState<ClientId>('claude-code');

  const refreshAppSettings = useCallback(async () => {
    try {
      const settings = await getAppSettings();
      setActiveClient(settings.active_client);
    } catch {
      setActiveClient('claude-code');
    }
  }, []);

  useEffect(() => {
    void refreshAppSettings();
    const onSettingsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<AppSettings>).detail;
      if (detail?.active_client) setActiveClient(detail.active_client);
      else void refreshAppSettings();
    };
    window.addEventListener(APP_SETTINGS_EVENT, onSettingsUpdated);
    return () => window.removeEventListener(APP_SETTINGS_EVENT, onSettingsUpdated);
  }, [refreshAppSettings]);

  const isProvidersPage = activePage === 'providers';
  const currentTitle = pageTitle(activePage, t('app.title'));

  return (
    <div className="h-screen overflow-hidden bg-base-100 text-base-content transition-colors">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute left-[-12rem] top-[-10rem] h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute right-[-10rem] top-1/4 h-[32rem] w-[32rem] rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(148,163,184,0.12)_1px,transparent_0)] bg-[length:32px_32px] opacity-40" />
      </div>

      <header className="fixed inset-x-0 top-0 z-50 border-b border-base-300 bg-base-100/85 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {isProvidersPage ? (
              <button type="button" onClick={() => setActivePage('providers')} className="flex items-center gap-3 rounded-2xl text-left" aria-label="提供商管理" title="提供商管理">
                <div className="grid h-10 w-10 place-items-center rounded-2xl border border-primary/50 bg-primary/15 text-primary transition">
                  AD
                </div>
                <div>
                  <h1 className="text-lg font-semibold tracking-tight text-base-content">{t('app.title')}</h1>
                  <p className="text-xs uppercase tracking-[0.22em] text-base-content/60">{t('app.subtitle')}</p>
                </div>
              </button>
            ) : (
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setActivePage('providers')}
                  className="btn btn-square btn-sm rounded-xl border border-base-300 bg-base-100/80 text-base-content/70 hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                  aria-label="返回提供商管理"
                  title="返回提供商管理"
                >
                  <BackIcon />
                </button>
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-semibold tracking-tight text-base-content">{currentTitle}</h1>
                  <p className="text-xs uppercase tracking-[0.22em] text-base-content/55">AgentDeck</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {isProvidersPage ? (
              <>
                <AppSwitcher activeClient={activeClient} onClientChange={setActiveClient} />
                <div className="flex items-center gap-1 rounded-2xl border border-base-300 bg-base-100/70 p-1">
                  <HeaderToolButton label="MCP 管理" active={false} onClick={() => setActivePage('mcp')}>
                    <McpIcon />
                  </HeaderToolButton>
                  <HeaderToolButton label="Skills 管理" active={false} onClick={() => setActivePage('skills')}>
                    <SkillsIcon />
                  </HeaderToolButton>
                  <HeaderToolButton label="Plugin 管理" active={false} onClick={() => setActivePage('plugin')}>
                    <PluginIcon />
                  </HeaderToolButton>
                  <HeaderToolButton label="会话管理" active={false} onClick={() => setActivePage('sessions')}>
                    <SessionIcon />
                  </HeaderToolButton>
                  <HeaderToolButton label="设置" active={false} onClick={() => setActivePage('settings')}>
                    <SettingsIcon />
                  </HeaderToolButton>
                </div>
              </>
            ) : null}
            <ThemeToggle />
            <LanguageToggle />
          </div>
        </div>
      </header>

      <main className="h-screen overflow-y-auto px-6 pb-6 pt-[6.5rem]">
        {activePage === 'providers' ? <Dashboard activeClient={activeClient} /> : activePage === 'sessions' ? <SessionManagementPage activeClient={activeClient} /> : activePage === 'settings' ? <SettingsPage /> : <ExtensionManagementPage kind={activePage} />}
      </main>
    </div>
  );
}

export default App;

