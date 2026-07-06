import type { ReactNode } from 'react';
import type { Channel, ToolSyncTarget } from '../../lib/tauri';
import { maskSecret, providerLabel } from '../../lib/providers';
import { useI18n } from '../../i18n';

interface ChannelCardProps {
  channel: Channel;
  selected: boolean;
  codexSelected: boolean;
  claudeSelected: boolean;
  onEdit: (channel: Channel) => void;
  onDelete: (channel: Channel) => void;
  onToggleEnabled: (channel: Channel) => void;
  onApplyToTool: (channel: Channel, target: ToolSyncTarget) => void;
}

interface IconButtonProps {
  label: string;
  tone?: 'ghost' | 'success' | 'danger' | 'primary' | 'app';
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function IconButton({ label, tone = 'ghost', active = false, onClick, children }: IconButtonProps) {
  const toneClass = active
    ? 'border-primary/60 bg-primary/15 text-primary shadow-[inset_0_0_0_1px_var(--color-primary)]'
    : tone === 'success'
      ? 'btn-success'
      : tone === 'danger'
        ? 'btn-error'
        : tone === 'primary'
          ? 'btn-primary'
          : tone === 'app'
            ? 'btn-ghost border border-base-300 bg-base-100/70 text-base-content/75 hover:border-primary/40 hover:bg-primary/10 hover:text-primary'
            : 'btn-ghost';

  return (
    <button type="button" className={`btn btn-square btn-xs overflow-hidden ${toneClass}`} onClick={onClick} aria-label={label} title={label} aria-pressed={active || undefined}>
      <span className="inline-grid h-3.5 w-3.5 shrink-0 place-items-center leading-none" aria-hidden="true">{children}</span>
    </button>
  );
}

function channelStatus(channel: Channel) {
  if (!channel.enabled) {
    return {
      label: '已禁用',
      className: 'border-base-300 bg-base-200 text-base-content/55',
      dotClassName: 'bg-base-content/35',
    };
  }

  if (!channel.healthy) {
    return {
      label: '异常',
      className: 'border-error/25 bg-error/10 text-error',
      dotClassName: 'bg-error',
    };
  }

  return {
    label: '可用',
    className: 'border-success/25 bg-success/10 text-success',
    dotClassName: 'bg-success',
  };
}

function StatusPill({ channel }: { channel: Channel }) {
  const status = channelStatus(channel);

  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${status.dotClassName}`} />
      {status.label}
    </span>
  );
}

function EditIcon() {
  return (
    <svg className="h-full w-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function PowerIcon() {
  return (
    <svg className="h-full w-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v10" />
      <path d="M18.4 6.6a8 8 0 1 1-12.8 0" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-full w-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 15h10l1-15" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function CodexIcon() {
  return (
    <svg className="h-full w-full" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M24 9.736V9.72c0-.018-.009-.035-.009-.053-.008-.017-.008-.034-.017-.052 0-.009-.009-.009-.009-.017a.19.19 0 0 0-.026-.044v-.009c-.009-.017-.026-.026-.044-.043l-.008-.009c-.018-.009-.035-.026-.053-.035l-3.72-2.143V3.02c0-.018 0-.044-.008-.061V2.94a.124.124 0 0 0-.017-.052V2.88c-.01-.017-.018-.035-.027-.043 0-.01-.008-.01-.008-.01a.19.19 0 0 0-.035-.043c-.018-.008-.026-.026-.044-.034-.008 0-.008-.01-.017-.01l-.009-.008L16.055.476a.338.338 0 0 0-.34 0l-3.72 2.143L8.286.476a.338.338 0 0 0-.34 0L4.06 2.723c-.01 0-.01.01-.01.01-.008 0-.008.008-.017.008-.017.009-.026.026-.043.035a.153.153 0 0 0-.035.043l-.009.009c-.008.017-.017.026-.026.044v.008c-.009.018-.009.035-.017.052v.018c0 .017-.009.043-.009.06v4.296L.166 9.457c-.018.01-.035.026-.053.035l-.008.009-.044.043v.01c-.009.017-.017.025-.026.043 0 .008-.009.008-.009.017a.124.124 0 0 0-.017.052C0 9.684 0 9.701 0 9.72v4.521a.34.34 0 0 0 .166.296l3.72 2.143v4.295a.34.34 0 0 0 .165.296l3.885 2.248c.009.008.018.008.026.017 0 0 .009 0 .009.009.009 0 .017.008.026.008.009 0 .009 0 .018.01.008 0 .017 0 .026.008h.061a.35.35 0 0 0 .13-.026c.018-.009.026-.009.044-.018l3.72-2.143 3.72 2.143c.017.009.026.018.043.018a.35.35 0 0 0 .13.026h.062c.008 0 .017 0 .026-.009.008 0 .008 0 .017-.009.009 0 .018-.008.026-.008.009 0 .009 0 .009-.009.009 0 .017-.009.026-.017l3.885-2.248a.34.34 0 0 0 .166-.296V16.68l3.72-2.143a.34.34 0 0 0 .165-.296V9.754c.009-.01.009-.018.009-.018zM12.17 20.67s-.009 0-.009-.009c-.009-.008-.017-.008-.035-.017-.008 0-.017-.009-.026-.009-.009 0-.017-.009-.035-.009-.008 0-.026-.008-.035-.008h-.069c-.009 0-.026 0-.035.008-.009 0-.017 0-.035.01-.009 0-.017.008-.026.008-.009.009-.017.009-.035.017 0 0-.009 0-.009.009l-3.37 1.951v-3.702l3.545-2.047 3.545 2.047v3.702zM4.4 7.793c.017-.017.025-.026.034-.026.009-.008.018-.008.026-.017l.026-.026c.01-.009.018-.018.018-.026.009-.01.009-.018.017-.026.009-.01.009-.018.018-.027.008-.008.008-.017.008-.034 0-.01.01-.018.01-.035 0-.009 0-.018.008-.035V3.603L7.77 5.46v4.094L4.225 11.6 1.02 9.745zm7.596-4.381 3.545 2.047V9.16l-3.38-1.951s-.009 0-.009-.009c-.008-.009-.017-.009-.034-.017-.01 0-.018-.009-.027-.009-.008 0-.017-.009-.034-.009-.01 0-.018-.008-.035-.008h-.07c-.009 0-.026 0-.035.008-.008 0-.017 0-.035.009-.008 0-.017.009-.026.009-.008.008-.026.008-.035.017 0 0-.008 0-.008.009L8.45 9.16v-3.7zm0 12.675L8.45 14.04V9.945l3.546-2.047 3.545 2.047v4.095zm-7.431-3.903 3.206-1.856v3.947c0 .008 0 .017.008.035 0 .008.009.017.009.034 0 .01.009.018.009.035.008.009.008.018.017.026.009.01.009.018.018.027.008.008.017.017.017.026l.026.026c.009.009.018.017.026.017.009.009.018.018.026.018l.01.008 3.38 1.952-3.207 1.855-3.545-2.047zm11.325 6.15-3.206-1.855 3.38-1.952.009-.008c.008-.009.017-.018.026-.018.008-.008.017-.008.026-.017l.026-.026c.009-.009.017-.018.017-.026.01-.01.01-.018.018-.027.009-.008.009-.017.017-.026.009-.008.009-.017.009-.035 0-.008.009-.017.009-.034 0-.01 0-.018.008-.035v-3.947l3.206 1.856v4.094zm3.885-6.734-3.546-2.047V5.46l3.206-1.856V7.55c0 .008 0 .017.009.034 0 .01.009.018.009.035 0 .009.008.018.008.035.01.009.01.018.018.026.008.009.008.018.017.026.009.01.018.018.018.026.008.01.017.018.026.027.008.008.017.017.026.017.009.009.017.017.026.017l.009.01 3.38 1.95zM15.89 1.164l3.205 1.856-3.205 1.855-3.206-1.855zm-7.78 0 3.206 1.856L8.11 4.866 4.905 3.02zM.68 10.337l3.205 1.856v3.702L.68 14.04zM7.77 22.62l-3.205-1.855v-3.703l3.206 1.856zm11.665-1.846-3.206 1.855v-3.702l3.206-1.856zm3.886-6.734-3.206 1.855v-3.702l3.206-1.856Z" />
    </svg>
  );
}

function ClaudeIcon() {
  return (
    <svg className="h-full w-full" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
    </svg>
  );
}

export function ChannelCard({ channel, selected, codexSelected, claudeSelected, onEdit, onDelete, onToggleEnabled, onApplyToTool }: ChannelCardProps) {
  const { t } = useI18n();
  const visibleModels = channel.models.slice(0, 3);

  return (
    <article className={`grid gap-3 rounded-2xl border px-3 py-2.5 transition xl:grid-cols-[minmax(180px,1.1fr)_minmax(220px,1.4fr)_minmax(180px,1fr)_auto] xl:items-center ${selected ? 'border-primary/60 bg-primary/10 shadow-[inset_3px_0_0_var(--color-primary)]' : 'border-base-300 bg-base-100/75 hover:border-primary/30'}`}>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-base-content">{channel.name}</h3>
          <StatusPill channel={channel} />
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-base-content/55">
          <span className="truncate font-mono">{channel.base_url}</span>
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px]">
        <span className="rounded-md bg-base-200 px-2 py-1 font-mono text-base-content/60">{maskSecret(channel.api_key)}</span>
        <span className="rounded-md bg-base-200 px-2 py-1 text-base-content/60">{providerLabel(channel.protocol)}</span>
        <span className="rounded-md bg-base-200 px-2 py-1 text-base-content/60">权重 {channel.weight}</span>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {visibleModels.map((model) => (
          <span key={model} className="max-w-[11rem] truncate rounded-md bg-base-200 px-2 py-1 font-mono text-[11px] text-base-content/70">{model}</span>
        ))}
        {channel.models.length === 0 && <span className="text-xs text-base-content/45">未配置模型</span>}
        {channel.models.length > visibleModels.length && <span className="rounded-md bg-base-200 px-2 py-1 text-[11px] text-base-content/55">+{channel.models.length - visibleModels.length}</span>}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 xl:justify-end">
        <IconButton label={codexSelected ? '已应用到 Codex' : '应用到 Codex'} tone="app" active={codexSelected} onClick={() => onApplyToTool(channel, 'codex')}>
          <CodexIcon />
        </IconButton>
        <IconButton label={claudeSelected ? '已应用到 Claude' : '应用到 Claude'} tone="app" active={claudeSelected} onClick={() => onApplyToTool(channel, 'claude')}>
          <ClaudeIcon />
        </IconButton>
        <IconButton label={t('channel.edit')} onClick={() => onEdit(channel)}>
          <EditIcon />
        </IconButton>
        <IconButton label={channel.enabled ? t('channel.disable') : t('channel.enable')} tone={channel.enabled ? 'ghost' : 'success'} onClick={() => onToggleEnabled(channel)}>
          <PowerIcon />
        </IconButton>
        <IconButton label={t('channel.delete')} tone="danger" onClick={() => onDelete(channel)}>
          <TrashIcon />
        </IconButton>
      </div>
    </article>
  );
}

