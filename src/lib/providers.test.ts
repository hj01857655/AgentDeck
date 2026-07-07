import { describe, expect, test } from 'bun:test';
import type { Channel } from './tauri';
import {
  apiKeyFormatHint,
  buildModelRoutes,
  buildProviderGroups,
  providerDefaults,
  providerFamily,
  providerProtocolsForFamily,
  maskSecret,
  modelCoverage,
  providerLabel,
  providerStatus,
  serviceProviderOption,
  serviceProviderProtocols,
  validateApiKey,
} from './providers';

const channel = (overrides: Partial<Channel>): Channel => ({
  id: 'id',
  name: 'Channel',
  service_provider: 'custom',
  base_url: 'https://api.example.com',
  api_key: 'sk-test-secret-value',
  models: [],
  protocol: 'openai-chat-completions',
  weight: 1,
  enabled: true,
  healthy: true,
  ...overrides,
});

describe('provider presentation helpers', () => {
  test('groups channels by provider with summary counts', () => {
    const groups = buildProviderGroups([
      channel({ id: 'openai-1', protocol: 'openai-chat-completions', models: ['model-alpha', 'model-beta'] }),
      channel({ id: 'responses-1', protocol: 'openai-responses', models: ['model-responses'] }),
      channel({ id: 'openai-2', protocol: 'openai-chat-completions', models: ['model-alpha'], healthy: false }),
      channel({ id: 'anthropic-1', protocol: 'anthropic-messages', models: ['claude-sonnet'] }),
    ]);

    expect(groups.map((group) => group.protocol)).toEqual(['openai-responses', 'openai-chat-completions', 'anthropic-messages']);
    expect(groups[1].totalChannels).toBe(2);
    expect(groups[1].healthyChannels).toBe(1);
    expect(groups[1].models).toEqual(['model-alpha', 'model-beta']);
  });

  test('formats provider labels and masks secrets', () => {
    expect(providerLabel('anthropic-messages')).toBe('Anthropic Messages');
    expect(providerLabel('openai-chat-completions')).toBe('OpenAI Chat Completions');
    expect(providerLabel('openai-responses')).toBe('OpenAI Responses');
    expect(maskSecret('sk-1234567890abcdef')).toBe('sk-••••••••••••cdef');
    expect(maskSecret('short')).toBe('•••••');
  });

  test('builds provider status copy for provider groups', () => {
    const groups = buildProviderGroups([
      channel({ id: 'openai-1', protocol: 'openai-chat-completions', enabled: true, healthy: true, weight: 10, models: ['model-alpha'] }),
      channel({ id: 'openai-2', protocol: 'openai-chat-completions', enabled: false, healthy: false, weight: 5, models: ['model-beta'] }),
      channel({ id: 'responses-1', protocol: 'openai-responses', enabled: true, healthy: true, weight: 2, models: ['model-responses'] }),
    ]);

    expect(providerStatus(groups[0])).toEqual({ tone: 'good', label: '健康', detail: '1 健康 · 1 已启用' });
    expect(providerStatus(groups[1])).toEqual({ tone: 'warn', label: '降级', detail: '1 健康 · 1 已禁用' });
    expect(modelCoverage(groups[1])).toBe('model-alpha, model-beta');
  });

  test('builds model routes from healthy enabled channels first', () => {
    const routes = buildModelRoutes([
      channel({ id: 'a', name: 'openai-primary', protocol: 'openai-chat-completions', weight: 10, models: ['model-alpha', 'shared'] }),
      channel({ id: 'b', name: 'responses-backup', protocol: 'openai-responses', weight: 2, models: ['shared'] }),
      channel({ id: 'c', name: 'anthropic-offline', protocol: 'anthropic-messages', healthy: false, weight: 9, models: ['claude-basic'] }),
      channel({ id: 'd', name: 'disabled-openai', protocol: 'openai-chat-completions', enabled: false, weight: 99, models: ['shared'] }),
    ]);

    expect(routes.map((route) => route.model)).toEqual(['claude-basic', 'model-alpha', 'shared']);
    expect(routes[0].status).toBe('blocked');
    expect(routes[2].status).toBe('degraded');
    expect(routes[2].providers).toEqual(['OpenAI Chat Completions', 'OpenAI Responses']);
    expect(routes[2].primaryChannelName).toBe('openai-primary');
    expect(routes[2].readyChannels).toBe(2);
    expect(routes[2].totalChannels).toBe(3);
  });

  test('returns useful channel defaults per provider', () => {
    expect(providerDefaults('openai-chat-completions')).toMatchObject({ base_url: 'https://api.openai.com', models: [] });
    expect(providerDefaults('openai-responses')).toMatchObject({ base_url: 'https://api.openai.com', models: [] });
    expect(providerDefaults('anthropic-messages')).toMatchObject({ base_url: 'https://api.anthropic.com', models: [] });
  });

  test('maps protocols to provider pages', () => {
    expect(providerFamily('openai-responses')).toBe('openai');
    expect(providerFamily('anthropic-messages')).toBe('anthropic');
    expect(providerProtocolsForFamily('openai')).toEqual([
      'openai-responses',
      'openai-chat-completions',
    ]);
    expect(providerProtocolsForFamily('anthropic')).toEqual(['anthropic-messages']);
  });



  test('ships official OpenAI compatible service provider base URLs', () => {
    expect(serviceProviderOption('xai').defaultBaseUrl).toBe('https://api.x.ai/v1');
    expect(serviceProviderOption('google-gemini').defaultBaseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(serviceProviderOption('deepseek').defaultBaseUrl).toBe('https://api.deepseek.com');
    expect(serviceProviderOption('mistral').defaultBaseUrl).toBe('https://api.mistral.ai/v1');
    expect(serviceProviderOption('openrouter').defaultBaseUrl).toBe('https://openrouter.ai/api/v1');
    expect(serviceProviderOption('moonshot').defaultBaseUrl).toBe('https://api.moonshot.cn/v1');
    expect(serviceProviderOption('groq').defaultBaseUrl).toBe('https://api.groq.com/openai/v1');
    expect(serviceProviderOption('together').defaultBaseUrl).toBe('https://api.together.ai/v1');
    expect(serviceProviderOption('fireworks').defaultBaseUrl).toBe('https://api.fireworks.ai/inference/v1');
    expect(serviceProviderOption('cerebras').defaultBaseUrl).toBe('https://api.cerebras.ai/v1');
    expect(serviceProviderOption('siliconflow').defaultBaseUrl).toBe('https://api.siliconflow.cn/v1');
    expect(serviceProviderOption('custom').defaultProtocol).toBe('openai-chat-completions');
    expect(serviceProviderProtocols('custom')).toEqual(['openai-responses', 'openai-chat-completions', 'anthropic-messages']);
    expect(serviceProviderProtocols('openai')).toEqual(['openai-responses', 'openai-chat-completions']);
    expect(serviceProviderProtocols('anthropic')).toEqual(['anthropic-messages']);
  });

  test('validates provider-specific API key shapes without hard-coding exact lengths', () => {
    expect(validateApiKey('openai-chat-completions', 'sk-proj-abcdefghijklmnopqrstuvwxyz', 'openai')).toBeNull();
    expect(validateApiKey('openai-responses', 'sk-abcdefghijklmnopqrstuvwxyz', 'openai')).toBeNull();
    expect(validateApiKey('openai-responses', 'any-key-or-token', 'custom')).toBeNull();
    expect(validateApiKey('openai-chat-completions', 'any-key-or-token', 'custom')).toBeNull();
    expect(validateApiKey('anthropic-messages', 'any-anthropic-key-without-fixed-prefix', 'custom')).toBeNull();
    expect(validateApiKey('anthropic-messages', 'any-anthropic-key-without-fixed-prefix', 'anthropic')).toBeNull();

    expect(validateApiKey('openai-chat-completions', 'pk-abc', 'openai')).toContain('sk-');
    expect(validateApiKey('openai-chat-completions', 'pk-abc', 'custom')).toBeNull();
    expect(validateApiKey('anthropic-messages', 'sk-abc', 'anthropic')).toBeNull();
    expect(apiKeyFormatHint('openai-responses', 'openai')).toContain('没有固定长度');
    expect(apiKeyFormatHint('openai-responses', 'custom')).toContain('兼容接口不校验');
  });
});
