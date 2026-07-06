import type { ProviderGroup } from '../../lib/providers';
import { modelCoverage, providerStatus } from '../../lib/providers';
import type { Channel, ToolSyncTarget } from '../../lib/tauri';
import { Badge } from '../shared/Badge';
import { ChannelCard } from './ChannelCard';
import { useI18n } from '../../i18n';

interface ProviderSectionProps {
  group: ProviderGroup;
  selectedChannelId: string;
  appliedToolChannelIds: Partial<Record<ToolSyncTarget, string>>;
  onEdit: (channel: Channel) => void;
  onDelete: (channel: Channel) => void;
  onToggleEnabled: (channel: Channel) => void;
  onApplyToTool: (channel: Channel, target: ToolSyncTarget) => void;
}

const toneMap = {
  good: 'good',
  warn: 'warn',
  bad: 'bad',
  neutral: 'neutral',
} as const;

export function ProviderSection({
  group,
  selectedChannelId,
  appliedToolChannelIds,
  onEdit,
  onDelete,
  onToggleEnabled,
  onApplyToTool,
}: ProviderSectionProps) {
  const { t } = useI18n();
  const status = providerStatus(group);

  return (
    <section className="overflow-hidden rounded-2xl border border-base-300 bg-base-200/45">
      <div className="border-b border-base-300 bg-base-100/65 px-3 py-2.5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold text-base-content">{group.label}</h3>
              <Badge tone={toneMap[status.tone]}>{status.label}</Badge>
              <Badge tone="neutral">{group.totalChannels} {t('providerMatrix.channels')}</Badge>
            </div>
            <p className="mt-1 truncate text-xs text-base-content/55">{modelCoverage(group, 8)}</p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs text-base-content/60">
            <span className="rounded-lg border border-base-300 bg-base-200/70 px-2 py-1">健康 {group.healthyChannels}/{group.totalChannels}</span>
            <span className="rounded-lg border border-base-300 bg-base-200/70 px-2 py-1">启用 {group.enabledChannels}/{group.totalChannels}</span>
            <span className="rounded-lg border border-base-300 bg-base-200/70 px-2 py-1">权重 {group.totalWeight}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-2 p-2.5">
        {group.channels.map((channel) => (
          <ChannelCard
            key={channel.id}
            channel={channel}
            selected={selectedChannelId === channel.id}
            codexSelected={appliedToolChannelIds.codex === channel.id}
            claudeSelected={appliedToolChannelIds.claude === channel.id}
            onEdit={onEdit}
            onDelete={onDelete}
            onToggleEnabled={onToggleEnabled}
            onApplyToTool={onApplyToTool}
          />
        ))}
      </div>
    </section>
  );
}
