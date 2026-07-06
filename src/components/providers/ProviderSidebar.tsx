import { providerProtocolsForFamily, type ProviderFamily, type ProviderGroup } from '../../lib/providers';
import { Badge } from '../shared/Badge';
import { useI18n } from '../../i18n';

interface ProviderSidebarProps {
  groups: ProviderGroup[];
  activePage: ProviderFamily;
  onSelectPage: (page: ProviderFamily) => void;
}

export function ProviderSidebar({ groups, activePage, onSelectPage }: ProviderSidebarProps) {
  const { t } = useI18n();
  const pageItems: Array<{ id: ProviderFamily; title: string; description: string }> = [
    { id: 'openai', title: 'OpenAI', description: 'Chat Completions / Responses' },
    { id: 'anthropic', title: 'Anthropic', description: 'Messages API' },
  ];

  return (
    <aside className="sticky top-6 self-start rounded-3xl border border-base-300 bg-base-200/70 p-3 shadow-xl backdrop-blur">
      <nav aria-label="页面导航" className="space-y-2">
        <div className="px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">页面</p>
          <h2 className="mt-1 text-xl font-semibold text-base-content">{t('sidebar.allProviders')}</h2>
          <p className="mt-1 text-xs text-base-content/55">区分 OpenAI 和 Anthropic 的提供商配置。</p>
        </div>

        {pageItems.map((item) => {
          const protocols = providerProtocolsForFamily(item.id);
          const pageGroups = groups.filter((group) => protocols.includes(group.protocol));
          const channels = pageGroups.reduce((sum, group) => sum + group.totalChannels, 0);
          const healthy = pageGroups.reduce((sum, group) => sum + group.healthyChannels, 0);

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectPage(item.id)}
              className={`w-full rounded-2xl border p-3 text-left transition ${
                activePage === item.id
                  ? 'border-primary/60 bg-primary/10 shadow-[inset_3px_0_0_var(--color-primary)]'
                  : 'border-base-300 bg-base-100/70 hover:border-primary/30 hover:bg-base-100'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-base-content">{item.title}</span>
                <Badge tone={channels === 0 ? 'neutral' : healthy === channels ? 'good' : 'warn'}>
                  {healthy}/{channels}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-base-content/55">{item.description}</p>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

