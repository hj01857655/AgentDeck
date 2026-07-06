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
  validateApiKey,
} from './providers';

const channel = (overrides: Partial<Channel>): Channel => ({
  id: 'id',
  name: 'Channel',
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
      channel({ id: 'openai-1', protocol: 'openai-chat-completions', models: ['gpt-4o', 'gpt-4o-mini'] }),
      channel({ id: 'responses-1', protocol: 'openai-responses', models: ['gpt-4.1'] }),
      channel({ id: 'openai-2', protocol: 'openai-chat-completions', models: ['gpt-4o'], healthy: false }),
      channel({ id: 'anthropic-1', protocol: 'anthropic-messages', models: ['claude-3-5-sonnet'] }),
    ]);

    expect(groups.map((group) => group.protocol)).toEqual(['openai-chat-completions', 'openai-responses', 'anthropic-messages']);
    expect(groups[0].totalChannels).toBe(2);
    expect(groups[0].healthyChannels).toBe(1);
    expect(groups[0].models).toEqual(['gpt-4o', 'gpt-4o-mini']);
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
      channel({ id: 'openai-1', protocol: 'openai-chat-completions', enabled: true, healthy: true, weight: 10, models: ['gpt-4o'] }),
      channel({ id: 'openai-2', protocol: 'openai-chat-completions', enabled: false, healthy: false, weight: 5, models: ['gpt-4o-mini'] }),
      channel({ id: 'responses-1', protocol: 'openai-responses', enabled: true, healthy: true, weight: 2, models: ['gpt-4.1'] }),
    ]);

    expect(providerStatus(groups[0])).toEqual({ tone: 'warn', label: '降级', detail: '1 健康 · 1 已禁用' });
    expect(providerStatus(groups[1])).toEqual({ tone: 'good', label: '健康', detail: '1 健康 · 1 已启用' });
    expect(modelCoverage(groups[0])).toBe('gpt-4o, gpt-4o-mini');
  });

  test('builds model routes from healthy enabled channels first', () => {
    const routes = buildModelRoutes([
      channel({ id: 'a', name: 'openai-primary', protocol: 'openai-chat-completions', weight: 10, models: ['gpt-4o', 'shared'] }),
      channel({ id: 'b', name: 'responses-backup', protocol: 'openai-responses', weight: 2, models: ['shared'] }),
      channel({ id: 'c', name: 'anthropic-offline', protocol: 'anthropic-messages', healthy: false, weight: 9, models: ['claude-3'] }),
      channel({ id: 'd', name: 'disabled-openai', protocol: 'openai-chat-completions', enabled: false, weight: 99, models: ['shared'] }),
    ]);

    expect(routes.map((route) => route.model)).toEqual(['claude-3', 'gpt-4o', 'shared']);
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
      'openai-chat-completions',
      'openai-responses',
    ]);
    expect(providerProtocolsForFamily('anthropic')).toEqual(['anthropic-messages']);
  });

  test('validates provider-specific API key shapes without hard-coding exact lengths', () => {
    expect(validateApiKey('openai-chat-completions', 'sk-proj-abcdefghijklmnopqrstuvwxyz')).toBeNull();
    expect(validateApiKey('openai-responses', 'sk-abcdefghijklmnopqrstuvwxyz')).toBeNull();
    expect(validateApiKey('anthropic-messages', 'any-anthropic-key-without-fixed-prefix')).toBeNull();

    expect(validateApiKey('openai-chat-completions', 'pk-abc')).toContain('sk-');
    expect(validateApiKey('anthropic-messages', 'sk-abc')).toBeNull();
    expect(apiKeyFormatHint('openai-responses')).toContain('没有固定长度');
  });
});
