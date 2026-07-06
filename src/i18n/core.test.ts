import { describe, expect, test } from 'bun:test';
import { createTranslator, dictionaryKeys, isLanguage, languages, normalizeLanguage } from './core';

describe('i18n core', () => {
  test('normalizes browser language codes', () => {
    expect(normalizeLanguage('zh-CN')).toBe('zh-CN');
    expect(normalizeLanguage('zh-Hans')).toBe('zh-CN');
    expect(normalizeLanguage('en-US')).toBe('en-US');
    expect(normalizeLanguage('fr-FR')).toBe('en-US');
  });

  test('translates keys and falls back to English', () => {
    const zh = createTranslator('zh-CN');
    const en = createTranslator('en-US');

    expect(zh('app.title')).toBe('AgentDeck');
    expect(en('dashboard.addChannel')).toBe('添加提供商');
    expect(zh('missing.key' as never)).toBe('missing.key');
  });

  test('keeps dictionaries aligned across languages', () => {
    const keys = dictionaryKeys();

    for (const language of languages) {
      expect(isLanguage(language)).toBe(true);
      expect(Object.keys(keys[language]).sort()).toEqual(Object.keys(keys['en-US']).sort());
    }
  });
});

