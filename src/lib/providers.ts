import type { Channel } from './tauri';

export type ProviderProtocol = Channel['protocol'];
export type ProviderFamily = 'openai' | 'anthropic';
export type ProviderStatusTone = 'good' | 'warn' | 'bad' | 'neutral';
export type ServiceProviderId =
  | 'openai'
  | 'anthropic'
  | 'xai'
  | 'google-gemini'
  | 'deepseek'
  | 'mistral'
  | 'openrouter'
  | 'moonshot'
  | 'groq'
  | 'together'
  | 'fireworks'
  | 'cerebras'
  | 'siliconflow'
  | 'custom';

export interface ServiceProviderOption {
  id: ServiceProviderId;
  label: string;
  description: string;
  defaultProtocol: ProviderProtocol;
  defaultBaseUrl: string;
  placeholderName: string;
}

export interface ProviderGroup {
  protocol: ProviderProtocol;
  label: string;
  channels: Channel[];
  totalChannels: number;
  healthyChannels: number;
  enabledChannels: number;
  models: string[];
  totalWeight: number;
}

export interface ProviderStatus {
  tone: ProviderStatusTone;
  label: string;
  detail: string;
}

const PROVIDER_ORDER: ProviderProtocol[] = ['openai-responses', 'openai-chat-completions', 'anthropic-messages'];

const PROVIDER_LABELS: Record<ProviderProtocol, string> = {
  'openai-chat-completions': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic Messages',
};

const PROVIDER_FAMILY: Record<ProviderProtocol, ProviderFamily> = {
  'openai-chat-completions': 'openai',
  'openai-responses': 'openai',
  'anthropic-messages': 'anthropic',
};

export const SERVICE_PROVIDERS: ServiceProviderOption[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    description: '官方 OpenAI API',
    defaultProtocol: 'openai-responses',
    defaultBaseUrl: 'https://api.openai.com',
    placeholderName: 'openai-main',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Claude / Messages API',
    defaultProtocol: 'anthropic-messages',
    defaultBaseUrl: 'https://api.anthropic.com',
    placeholderName: 'anthropic-main',
  },
  {
    id: 'xai',
    label: 'xAI / Grok',
    description: 'Grok 模型，OpenAI 兼容接口',
    defaultProtocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.x.ai/v1',
    placeholderName: 'xai-grok',
  },
  {
    id: 'google-gemini',
    label: 'Google Gemini',
    description: 'Gemini OpenAI 兼容接口',
    defaultProtocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    placeholderName: 'google-gemini',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek OpenAI 兼容接口',
    defaultProtocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.deepseek.com',
    placeholderName: 'deepseek',
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    description: 'Mistral Chat Completions',
    defaultProtocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    placeholderName: 'mistral',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: '多模型聚合，OpenAI 兼容接口',
    defaultProtocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    placeholderName: 'openrouter',
  },
  {
    id: 'moonshot',
    label: 'Moonshot / Kimi',
    description: 'Moonshot OpenAI 兼容接口',
    defaultProtocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    placeholderName: 'moonshot-kimi',
  },

  {
    id: 'groq',
    label: 'Groq',
    description: 'Groq OpenAI 兼容接口',
    defaultProtocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    placeholderName: 'groq',
  },
  {
    id: 'together',
    label: 'Together AI',
    description: 'Together OpenAI 兼容接口',
    defaultProtocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.together.ai/v1',
    placeholderName: 'together-ai',
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    description: 'Fireworks OpenAI 兼容接口',
    defaultProtocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.fireworks.ai/inference/v1',
    placeholderName: 'fireworks-ai',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    description: 'Cerebras OpenAI 兼容接口',
    defaultProtocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.cerebras.ai/v1',
    placeholderName: 'cerebras',
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    description: '硅基流动 OpenAI 兼容接口',
    defaultProtocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    placeholderName: 'siliconflow',
  },
  {
    id: 'custom',
    label: 'OpenAI Compatible',
    description: '中转、聚合或任意 OpenAI 兼容接口',
    defaultProtocol: 'openai-chat-completions',
    defaultBaseUrl: '',
    placeholderName: 'openai-compatible',
  },
];

export function serviceProviderOption(id?: string | null): ServiceProviderOption {
  return SERVICE_PROVIDERS.find((item) => item.id === id) ?? SERVICE_PROVIDERS[SERVICE_PROVIDERS.length - 1];
}

export function serviceProviderLabel(id?: string | null): string {
  return serviceProviderOption(id).label;
}

export function serviceProviderProtocols(serviceProviderId?: string | null): ProviderProtocol[] {
  const provider = serviceProviderOption(serviceProviderId);
  if (provider.id === 'openai') return ['openai-responses', 'openai-chat-completions'];
  if (provider.id === 'anthropic') return ['anthropic-messages'];
  return ['openai-responses', 'openai-chat-completions', 'anthropic-messages'];
}

export function providerLabel(protocol: ProviderProtocol): string {
  return PROVIDER_LABELS[protocol] ?? protocol;
}

export function providerFamily(protocol: ProviderProtocol): ProviderFamily {
  return PROVIDER_FAMILY[protocol] ?? 'openai';
}

export function providerProtocolsForFamily(family: ProviderFamily): ProviderProtocol[] {
  return PROVIDER_ORDER.filter((protocol) => providerFamily(protocol) === family);
}

export function defaultProtocolForFamily(family: ProviderFamily): ProviderProtocol {
  return family === 'anthropic' ? 'anthropic-messages' : 'openai-chat-completions';
}

export function buildProviderGroups(channels: Channel[]): ProviderGroup[] {
  const byProtocol = new Map<ProviderProtocol, Channel[]>();

  for (const channel of channels) {
    const list = byProtocol.get(channel.protocol) ?? [];
    list.push(channel);
    byProtocol.set(channel.protocol, list);
  }

  return PROVIDER_ORDER
    .filter((protocol) => byProtocol.has(protocol))
    .map((protocol) => {
      const providerChannels = byProtocol.get(protocol) ?? [];
      const models = Array.from(new Set(providerChannels.flatMap((channel) => channel.models))).sort();

      return {
        protocol,
        label: providerLabel(protocol),
        channels: providerChannels,
        totalChannels: providerChannels.length,
        healthyChannels: providerChannels.filter((channel) => channel.healthy).length,
        enabledChannels: providerChannels.filter((channel) => channel.enabled).length,
        models,
        totalWeight: providerChannels.reduce((sum, channel) => sum + channel.weight, 0),
      };
    });
}

export function providerStatus(group: ProviderGroup): ProviderStatus {
  const disabled = group.totalChannels - group.enabledChannels;
  const healthText = `${group.healthyChannels} 健康`;
  const availabilityText = disabled > 0 ? `${disabled} 已禁用` : `${group.enabledChannels} 已启用`;

  if (group.totalChannels === 0) {
    return { tone: 'neutral', label: '空', detail: '没有提供商配置' };
  }

  if (group.healthyChannels === 0 || group.enabledChannels === 0) {
    return { tone: 'bad', label: '不可用', detail: `${healthText} · ${availabilityText}` };
  }

  if (group.healthyChannels < group.totalChannels || disabled > 0) {
    return { tone: 'warn', label: '降级', detail: `${healthText} · ${availabilityText}` };
  }

  return { tone: 'good', label: '健康', detail: `${healthText} · ${availabilityText}` };
}

export function modelCoverage(group: ProviderGroup, limit = 4): string {
  if (group.models.length === 0) return '未声明模型';
  const visible = group.models.slice(0, limit).join(', ');
  const hidden = group.models.length - limit;
  return hidden > 0 ? `${visible}，另 ${hidden} 个` : visible;
}

export function maskSecret(secret: string): string {
  if (!secret) return '未设置';
  if (secret.length <= 8) return '•'.repeat(secret.length);
  return `${secret.slice(0, 3)}${'•'.repeat(12)}${secret.slice(-4)}`;
}

export function uniqueModels(channels: Channel[]): string[] {
  return Array.from(new Set(channels.flatMap((channel) => channel.models))).sort();
}
export type ModelRouteStatus = 'ready' | 'degraded' | 'blocked';

export interface ModelRoute {
  model: string;
  status: ModelRouteStatus;
  providers: string[];
  channels: Channel[];
  readyChannels: number;
  totalChannels: number;
  totalWeight: number;
  primaryChannelName: string | null;
}

export function buildModelRoutes(channels: Channel[]): ModelRoute[] {
  const byModel = new Map<string, Channel[]>();

  for (const channel of channels) {
    for (const model of channel.models) {
      const name = model.trim();
      if (!name) continue;
      const list = byModel.get(name) ?? [];
      list.push(channel);
      byModel.set(name, list);
    }
  }

  return Array.from(byModel.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, routeChannels]) => {
      const sortedChannels = [...routeChannels].sort((a, b) => {
        const aReady = Number(a.enabled && a.healthy);
        const bReady = Number(b.enabled && b.healthy);
        if (aReady !== bReady) return bReady - aReady;
        return b.weight - a.weight;
      });
      const ready = sortedChannels.filter((channel) => channel.enabled && channel.healthy);
      const providers = Array.from(new Set(sortedChannels.map((channel) => providerLabel(channel.protocol))));
      const totalWeight = ready.reduce((sum, channel) => sum + channel.weight, 0);
      const status: ModelRouteStatus = ready.length === 0 ? 'blocked' : ready.length < sortedChannels.length ? 'degraded' : 'ready';

      return {
        model,
        status,
        providers,
        channels: sortedChannels,
        readyChannels: ready.length,
        totalChannels: sortedChannels.length,
        totalWeight,
        primaryChannelName: ready[0]?.name ?? null,
      };
    });
}

export interface ProviderDefaults {
  base_url: string;
  models: string[];
}

const PROVIDER_DEFAULTS: Record<ProviderProtocol, ProviderDefaults> = {
  'openai-chat-completions': {
    base_url: 'https://api.openai.com',
    models: [],
  },
  'openai-responses': {
    base_url: 'https://api.openai.com',
    models: [],
  },
  'anthropic-messages': {
    base_url: 'https://api.anthropic.com',
    models: [],
  },
};

export function providerDefaults(protocol: ProviderProtocol): ProviderDefaults {
  return PROVIDER_DEFAULTS[protocol];
}

export function apiKeyFormatHint(protocol: ProviderProtocol, serviceProviderId?: string | null): string {
  const serviceProvider = serviceProviderOption(serviceProviderId);
  if (serviceProvider.id !== 'openai' && serviceProvider.id !== 'anthropic') {
    return '兼容接口不校验固定 Key 前缀；按上游实际支持选择 OpenAI Responses、OpenAI Chat Completions 或 Anthropic Messages。';
  }

  switch (protocol) {
    case 'openai-chat-completions':
    case 'openai-responses':
      return '官方 OpenAI API Key 通常以 sk- 或 sk-proj- 开头；公开文档没有固定长度。';
    case 'anthropic-messages':
      return 'Anthropic Messages API Key 不做固定前缀校验；请填写完整密钥。';
  }
}

export function validateApiKey(protocol: ProviderProtocol, apiKey: string, serviceProviderId?: string | null): string | null {
  const key = apiKey.trim();

  if (!key) {
    return 'API Key 必填。';
  }

  if (/\s/.test(key)) {
    return 'API Key 不能包含空白字符。';
  }

  const serviceProvider = serviceProviderOption(serviceProviderId);
  if (serviceProvider.id !== 'openai') return null;

  switch (protocol) {
    case 'openai-chat-completions':
    case 'openai-responses':
      if (!key.startsWith('sk-')) {
        return '官方 OpenAI API Key 应以 sk- 或 sk-proj- 开头。';
      }
      if (key.length < 20) {
        return '官方 OpenAI API Key 看起来太短。';
      }
      return null;
    case 'anthropic-messages':
      return null;
  }
}

