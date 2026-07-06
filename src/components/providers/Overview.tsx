import type { ProviderGroup } from '../../lib/providers';
import type { Channel } from '../../lib/tauri';
import { useI18n } from '../../i18n';

interface OverviewProps {
  groups: ProviderGroup[];
  channels: Channel[];
}

export function Overview({ groups, channels }: OverviewProps) {
  const { t } = useI18n();
  const healthy = channels.filter((channel) => channel.healthy).length;
  const enabled = channels.filter((channel) => channel.enabled).length;
  const models = new Set(channels.flatMap((channel) => channel.models)).size;
  const totalWeight = channels.reduce((sum, channel) => sum + channel.weight, 0);

  const stats = [
    { label: t('overview.providers'), value: groups.length },
    { label: t('overview.channels'), value: `${healthy}/${channels.length}` },
    { label: t('overview.enabled'), value: `${enabled}/${channels.length}` },
    { label: t('overview.models'), value: models },
    { label: t('overview.routeWeight'), value: totalWeight },
  ];

  return (
    <section className="rounded-2xl border border-base-300 bg-base-200/70 p-3 shadow-xl">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{t('overview.eyebrow')}</p>
          <h2 className="mt-1 truncate text-base font-semibold tracking-tight text-base-content">{t('overview.title')}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-xl border border-base-300 bg-base-100/75 px-3 py-2">
              <span className="text-xs text-base-content/55">{stat.label}</span>
              <span className="ml-2 text-sm font-semibold text-base-content">{stat.value}</span>
            </div>
          ))}
          <div className="rounded-xl border border-success/20 bg-success/10 px-3 py-2 text-xs text-success">
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-success shadow-[0_0_14px_var(--color-success)]" />
            {t('overview.ready')}
          </div>
        </div>
      </div>
    </section>
  );
}
