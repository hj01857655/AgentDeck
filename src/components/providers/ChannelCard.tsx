import type { ReactNode } from 'react';
import type { Channel, ToolSyncTarget } from '../../lib/tauri';
import { maskSecret, providerLabel, serviceProviderLabel } from '../../lib/providers';
import { useI18n } from '../../i18n';

interface ChannelCardProps {
  channel: Channel;
  selected: boolean;
  syncTarget: ToolSyncTarget | null;
  codexSelected: boolean;
  claudeSelected: boolean;
  onEdit: (channel: Channel) => void;
  onDelete: (channel: Channel) => void;
  onToggleEnabled: (channel: Channel) => void;
  onProbe: (channel: Channel) => void;
  onEnableForTool: (channel: Channel, target: ToolSyncTarget) => void;
}

interface IconButtonProps {
  label: string;
  tone?: 'ghost' | 'success' | 'danger' | 'primary' | 'app';
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function IconButton({ label, tone = 'ghost', active = false, disabled = false, onClick, children }: IconButtonProps) {
  const toneClass = disabled && active
    ? 'cursor-not-allowed border-base-300 bg-base-200 text-base-content/45 shadow-none'
    : active
      ? 'border-primary/60 bg-primary/15 text-primary shadow-[inset_0_0_0_1px_var(--color-primary)]'
    : tone === 'success'
      ? 'btn-success'
      : tone === 'danger'
        ? 'btn-error'
        : tone === 'primary'
          ? 'btn-primary'
          : tone === 'app'
            ? 'btn-ghost border border-base-300 bg-base-100/70 text-base-content/75 hover:border-primary/40 hover:bg-primary/10 hover:text-primary'
            : 'btn-ghost border border-transparent hover:border-base-300';

  return (
    <button type="button" className={`btn btn-square btn-xs overflow-hidden ${toneClass}`} onClick={onClick} disabled={disabled} aria-label={label} title={label} aria-pressed={active || undefined}>
      <span className="inline-grid h-3.5 w-3.5 shrink-0 place-items-center leading-none" aria-hidden="true">{children}</span>
    </button>
  );
}

function channelStatus(channel: Channel) {
  if (!channel.enabled) {
    return { label: '禁用', className: 'border-base-300 bg-base-200 text-base-content/55', dotClassName: 'bg-base-content/35' };
  }
  if (!channel.healthy) {
    return { label: '异常', className: 'border-error/25 bg-error/10 text-error', dotClassName: 'bg-error' };
  }
  return { label: '可用', className: 'border-success/25 bg-success/10 text-success', dotClassName: 'bg-success' };
}

function StatusPill({ channel }: { channel: Channel }) {
  const status = channelStatus(channel);
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${status.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${status.dotClassName}`} />
      {status.label}
    </span>
  );
}

function CurrentProviderPill() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-success/30 bg-success/12 px-1.5 py-0.5 text-[10px] font-semibold text-success">
      <span className="h-1.5 w-1.5 rounded-full bg-success" />
      当前启用
    </span>
  );
}

function ProbeIcon() { return <svg className="h-full w-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 1-15.1 6.6" /><path d="M3 12A9 9 0 0 1 18.1 5.4" /><path d="M18 2v4h-4" /><path d="M6 22v-4h4" /></svg>; }
function EditIcon() { return <svg className="h-full w-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>; }
function PowerIcon() { return <svg className="h-full w-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v10" /><path d="M18.4 6.6a8 8 0 1 1-12.8 0" /></svg>; }
function PowerOffIcon() { return <svg className="h-full w-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v6" /><path d="M6.7 6.7a8 8 0 0 0 10.6 10.6" /><path d="M18.4 6.6a8 8 0 0 1-9.9 12.1" /><path d="M3 3l18 18" /></svg>; }
function TrashIcon() { return <svg className="h-full w-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 15h10l1-15" /><path d="M10 11v6M14 11v6" /></svg>; }
function PlayIcon() { return <svg className="h-full w-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m7 4 12 8-12 8Z" /></svg>; }
function CheckIcon() { return <svg className="h-full w-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>; }

export function ChannelCard({ channel, selected, syncTarget, codexSelected, claudeSelected, onEdit, onDelete, onToggleEnabled, onProbe, onEnableForTool }: ChannelCardProps) {
  const { t } = useI18n();
  const visibleModels = channel.models.slice(0, 2);
  const syncSelected = syncTarget === 'codex' ? codexSelected : syncTarget === 'claude' ? claudeSelected : false;
  const syncTargetName = syncTarget === 'codex' ? 'Codex' : syncTarget === 'claude' ? 'Claude Code' : '';
  const syncLabel = syncTarget
    ? !channel.enabled
      ? `先启用该提供商配置，再设为 ${syncTargetName} 当前提供商`
      : syncSelected
        ? `${syncTargetName} 当前启用`
        : `启用为 ${syncTargetName} 当前提供商`
    : '';
  const rowStateClass = syncSelected
    ? 'border-success/30 bg-success/10 shadow-[inset_3px_0_0_var(--color-success)] ring-1 ring-inset ring-success/20 hover:bg-success/15'
    : selected
      ? 'bg-primary/10 shadow-[inset_3px_0_0_var(--color-primary)] hover:bg-primary/12'
      : 'bg-base-100/55 hover:bg-base-200/60';

  return (
    <div className={`grid min-w-0 grid-cols-[minmax(180px,1.2fr)_minmax(220px,1.5fr)_minmax(180px,1fr)_max-content] items-center gap-3 border-b border-base-300 px-3 py-2 text-xs transition last:border-b-0 ${rowStateClass}`}>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-base-content">{channel.name}</span>
          <StatusPill channel={channel} />
          {syncSelected && <CurrentProviderPill />}
        </div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-base-content/45">{channel.base_url}</div>
      </div>

      <div className="min-w-0 truncate text-base-content/55">
        <span className="font-medium text-base-content/70">{serviceProviderLabel(channel.service_provider)}</span>
        <span className="mx-1.5 text-base-content/30">/</span>
        <span>{providerLabel(channel.protocol)}</span>
        <span className="mx-1.5 text-base-content/30">/</span>
        <span className="font-mono">{maskSecret(channel.api_key)}</span>
        <span className="mx-1.5 text-base-content/30">/</span>
        <span>权重 {channel.weight}</span>
      </div>

      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        {visibleModels.map((model) => <span key={model} className="truncate rounded-md bg-base-200 px-1.5 py-0.5 font-mono text-[11px] text-base-content/65">{model}</span>)}
        {channel.models.length === 0 && <span className="text-base-content/40">未配置模型</span>}
        {channel.models.length > visibleModels.length && <span className="shrink-0 text-base-content/45">+{channel.models.length - visibleModels.length}</span>}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-1">
        {syncTarget && (
          <IconButton label={syncLabel} tone={syncSelected ? 'success' : 'primary'} active={syncSelected} disabled={syncSelected || !channel.enabled} onClick={() => onEnableForTool(channel, syncTarget)}>
            {syncSelected ? <CheckIcon /> : <PlayIcon />}
          </IconButton>
        )}
        <IconButton label="重新检测" tone="app" onClick={() => onProbe(channel)}><ProbeIcon /></IconButton>
        <IconButton label={t('channel.edit')} onClick={() => onEdit(channel)}><EditIcon /></IconButton>
        <IconButton label={channel.enabled ? t('channel.disable') : t('channel.enable')} tone={channel.enabled ? 'ghost' : 'success'} onClick={() => onToggleEnabled(channel)}>{channel.enabled ? <PowerOffIcon /> : <PowerIcon />}</IconButton>
        <IconButton label={t('channel.delete')} tone="danger" onClick={() => onDelete(channel)}><TrashIcon /></IconButton>
      </div>
    </div>
  );
}
