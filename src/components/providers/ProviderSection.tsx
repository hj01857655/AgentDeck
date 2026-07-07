import type { ProviderGroup } from '../../lib/providers';
import { modelCoverage, providerStatus } from '../../lib/providers';
import type { Channel, ToolSyncTarget } from '../../lib/tauri';
import { Badge } from '../shared/Badge';
import { ChannelCard } from './ChannelCard';
import { useI18n } from '../../i18n';

interface ProviderSectionProps {
  group: ProviderGroup;
  selectedChannelId: string;
  syncTarget: ToolSyncTarget | null;
  appliedToolChannelIds: Partial<Record<ToolSyncTarget, string>>;
  onEdit: (channel: Channel) => void;
  onDelete: (channel: Channel) => void;
  onToggleEnabled: (channel: Channel) => void;
  onProbe: (channel: Channel) => void;
  onEnableForTool: (channel: Channel, target: ToolSyncTarget) => void;
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
  syncTarget,
  appliedToolChannelIds,
  onEdit,
  onDelete,
  onToggleEnabled,
  onProbe,
  onEnableForTool,
}: ProviderSectionProps) {
  const { t } = useI18n();
  const status = providerStatus(group);

  return (
    <section className="overflow-hidden rounded-2xl border border-base-300 bg-base-100/70">
      <div className="border-b border-base-300 bg-base-200/45 px-3 py-2">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold text-base-content">{group.label}</h3>
              <Badge tone={toneMap[status.tone]}>{status.label}</Badge>
              <Badge tone="neutral">{group.totalChannels} {t('providerMatrix.channels')}</Badge>
            </div>
            <p className="mt-0.5 truncate text-xs text-base-content/50">{modelCoverage(group, 6)}</p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs text-base-content/60">
            <span className="rounded-lg border border-base-300 bg-base-200/70 px-2 py-1">健康 {group.healthyChannels}/{group.totalChannels}</span>
            <span className="rounded-lg border border-base-300 bg-base-200/70 px-2 py-1">启用 {group.enabledChannels}/{group.totalChannels}</span>
            <span className="rounded-lg border border-base-300 bg-base-200/70 px-2 py-1">权重 {group.totalWeight}</span>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        {group.channels.map((channel) => (
          <ChannelCard
            key={channel.id}
            channel={channel}
            selected={selectedChannelId === channel.id}
            syncTarget={syncTarget}
            codexSelected={appliedToolChannelIds.codex === channel.id}
            claudeSelected={appliedToolChannelIds.claude === channel.id}
            onEdit={onEdit}
            onDelete={onDelete}
            onToggleEnabled={onToggleEnabled}
            onProbe={onProbe}
            onEnableForTool={onEnableForTool}
          />
        ))}
      </div>
    </section>
  );
}
