import { useState, type ReactNode } from 'react';
import Dashboard from './components/Dashboard';
import { LanguageToggle } from './components/shared/LanguageToggle';
import { ThemeToggle } from './components/shared/ThemeToggle';
import { McpIcon, PluginIcon, SessionIcon, SkillsIcon } from './components/shared/ActionIcons';
import { ExtensionManagementPage, type ExtensionKind } from './components/extensions/ExtensionManagementPage';
import { SessionManagementPage } from './components/sessions/SessionManagementPage';
import { useI18n } from './i18n';

type WorkspacePage = 'providers' | 'sessions' | ExtensionKind;

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

function App() {
  const { t } = useI18n();
  const [activePage, setActivePage] = useState<WorkspacePage>('providers');

  return (
    <div className="min-h-screen overflow-x-hidden bg-base-100 text-base-content transition-colors">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute left-[-12rem] top-[-10rem] h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute right-[-10rem] top-1/4 h-[32rem] w-[32rem] rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(148,163,184,0.12)_1px,transparent_0)] bg-[length:32px_32px] opacity-40" />
      </div>

      <header className="border-b border-base-300 bg-base-100/85 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-4">
          <button type="button" onClick={() => setActivePage('providers')} className="flex items-center gap-3 rounded-2xl text-left" aria-label="提供商管理" title="提供商管理">
            <div className={`grid h-10 w-10 place-items-center rounded-2xl border transition ${activePage === 'providers' ? 'border-primary/50 bg-primary/15 text-primary' : 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200 shadow-[0_0_28px_rgba(34,211,238,0.16)]'}`}>
              AD
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-base-content">{t('app.title')}</h1>
              <p className="text-xs uppercase tracking-[0.22em] text-base-content/60">{activePage === 'providers' ? t('app.subtitle') : activePage === 'mcp' ? 'MCP 管理' : activePage === 'skills' ? 'Skills 管理' : activePage === 'plugin' ? 'Plugin 管理' : '会话管理'}</p>
            </div>
          </button>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-3 rounded-2xl border border-base-300 bg-base-200/70 px-4 py-2 text-xs text-base-content/60 md:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.9)]" />
              {t('app.status')}
            </div>
            <div className="flex items-center gap-1 rounded-2xl border border-base-300 bg-base-100/70 p-1">
              <HeaderToolButton label="MCP 管理" active={activePage === 'mcp'} onClick={() => setActivePage('mcp')}>
                <McpIcon />
              </HeaderToolButton>
              <HeaderToolButton label="Skills 管理" active={activePage === 'skills'} onClick={() => setActivePage('skills')}>
                <SkillsIcon />
              </HeaderToolButton>
              <HeaderToolButton label="Plugin 管理" active={activePage === 'plugin'} onClick={() => setActivePage('plugin')}>
                <PluginIcon />
              </HeaderToolButton>
              <HeaderToolButton label="会话管理" active={activePage === 'sessions'} onClick={() => setActivePage('sessions')}>
                <SessionIcon />
              </HeaderToolButton>
            </div>
            <ThemeToggle />
            <LanguageToggle />
          </div>
        </div>
      </header>

      <main className="px-6 py-6">
        {activePage === 'providers' ? <Dashboard /> : activePage === 'sessions' ? <SessionManagementPage /> : <ExtensionManagementPage kind={activePage} />}
      </main>
    </div>
  );
}

export default App;
