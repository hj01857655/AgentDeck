export const languages = ['en-US', 'zh-CN'] as const;

export type Language = (typeof languages)[number];

export type TranslationKey =
  | 'app.title'
  | 'app.subtitle'
  | 'app.status'
  | 'language.label'
  | 'language.en'
  | 'language.zh'
  | 'sidebar.scope'
  | 'sidebar.providers'
  | 'sidebar.allProviders'
  | 'sidebar.globalHint'
  | 'sidebar.models'
  | 'sidebar.weight'
  | 'overview.eyebrow'
  | 'overview.title'
  | 'overview.description'
  | 'overview.ready'
  | 'overview.providers'
  | 'overview.channels'
  | 'overview.enabled'
  | 'overview.models'
  | 'overview.routeWeight'
  | 'overview.activeGroups'
  | 'overview.healthyKeys'
  | 'overview.eligibleRouting'
  | 'overview.uniqueModels'
  | 'overview.capacity'
  | 'providerMatrix.channels'
  | 'dashboard.allProviders'
  | 'dashboard.allDescription'
  | 'dashboard.providerDescription'
  | 'dashboard.refresh'
  | 'dashboard.refreshing'
  | 'dashboard.addChannel'
  | 'dashboard.noCredentials'
  | 'dashboard.noProviderChannels'
  | 'dashboard.noCredentialsDescription'
  | 'dashboard.noProviderChannelsDescription'
  | 'channel.edit'
  | 'channel.delete'
  | 'channel.enable'
  | 'channel.disable'
  | 'channel.healthy'
  | 'channel.unhealthy'
  | 'channel.enabled'
  | 'channel.disabled'
  | 'channel.weight'
  | 'channel.models'
  | 'channel.protocol'
  | 'editor.new'
  | 'editor.edit'
  | 'editor.addCredential'
  | 'editor.close'
  | 'editor.name'
  | 'editor.protocol'
  | 'editor.baseUrl'
  | 'editor.weight'
  | 'editor.weightHint'
  | 'editor.apiKey'
  | 'editor.models'
  | 'editor.modelsHint'
  | 'editor.cancel'
  | 'editor.save'
  | 'editor.add'
  | 'editor.saving'
  | 'editor.nameRequired'
  | 'editor.baseUrlRequired'
  | 'editor.apiKeyRequired'
  | 'editor.modelsRequired';

type Dictionary = Record<TranslationKey, string>;

const en: Dictionary = {
  'app.title': 'AgentDeck',
  'app.subtitle': '提供商控制台',
  'app.status': 'Tauri 本地控制平面 · v0.1.0',
  'language.label': '语言',
  'language.en': 'English',
  'language.zh': '中文',
  'sidebar.scope': '提供商管理',
  'sidebar.providers': '提供商',
  'sidebar.allProviders': '提供商管理',
  'sidebar.globalHint': '全局路由与健康概览',
  'sidebar.models': '模型',
  'sidebar.weight': '权重',
  'overview.eyebrow': '网关控制台',
  'overview.title': '多提供商控制平面',
  'overview.description': '提供商配置按协议聚合。先检查健康状态和模型覆盖，再管理具体配置。',
  'overview.ready': '本地网关就绪',
  'overview.providers': '提供商',
  'overview.channels': '配置',
  'overview.enabled': '已启用',
  'overview.models': '模型',
  'overview.routeWeight': '路由权重',
  'overview.activeGroups': '活跃协议分组',
  'overview.healthyKeys': '健康上游密钥',
  'overview.eligibleRouting': '可参与路由',
  'overview.uniqueModels': '唯一模型 ID',
  'overview.capacity': '已配置容量',
  'providerMatrix.channels': '配置',
  'dashboard.allProviders': '提供商管理',
  'dashboard.allDescription': '提供商配置按协议聚合：先检查分组状态，再操作下面的配置行。',
  'dashboard.providerDescription': '把凭证作为提供商配置管理，网关会按模型和权重选择可用配置。',
  'dashboard.refresh': '刷新',
  'dashboard.refreshing': '刷新中...',
  'dashboard.addChannel': '添加提供商',
  'dashboard.noCredentials': '还没有提供商配置',
  'dashboard.noProviderChannels': '没有 {provider} 配置',
  'dashboard.noCredentialsDescription': '添加服务地址、API Key、协议、模型和权重后开始路由请求。',
  'dashboard.noProviderChannelsDescription': '切换页面，或为这个协议添加提供商配置。',
  'channel.edit': '编辑',
  'channel.delete': '删除',
  'channel.enable': '启用',
  'channel.disable': '禁用',
  'channel.healthy': '健康',
  'channel.unhealthy': '异常',
  'channel.enabled': '已启用',
  'channel.disabled': '已禁用',
  'channel.weight': '权重',
  'channel.models': '模型',
  'channel.protocol': '协议',
  'editor.new': '新建提供商配置',
  'editor.edit': '编辑提供商配置',
  'editor.addCredential': '添加提供商',
  'editor.close': '关闭',
  'editor.name': '名称',
  'editor.protocol': '协议',
  'editor.baseUrl': 'Base URL',
  'editor.weight': '权重',
  'editor.weightHint': '用于路由优先级和 fallback 选择。',
  'editor.apiKey': 'API Key',
  'editor.models': '模型',
  'editor.modelsHint': '从下拉框选择一个或多个模型；可先点击“获取模型”刷新可选项。',
  'editor.cancel': '取消',
  'editor.save': '保存修改',
  'editor.add': '添加提供商',
  'editor.saving': '保存中...',
  'editor.nameRequired': '名称必填。',
  'editor.baseUrlRequired': 'Base URL 必填。',
  'editor.apiKeyRequired': 'API key 必填。',
  'editor.modelsRequired': '至少需要一个模型。',
};

const zh: Dictionary = {
  ...en,
  'app.title': 'AgentDeck',
  'app.subtitle': '提供商控制台',
  'app.status': 'Tauri 本地控制平面 · v0.1.0',
  'language.label': '语言',
  'language.en': 'English',
  'language.zh': '中文',
  'sidebar.scope': '提供商管理',
  'sidebar.providers': '提供商',
  'sidebar.allProviders': '提供商管理',
  'sidebar.globalHint': '全局路由与健康概览',
  'sidebar.models': '模型',
  'sidebar.weight': '权重',
  'overview.eyebrow': '网关控制台',
  'overview.title': '多提供商控制平面',
  'overview.description': '提供商配置按协议聚合。先检查健康状态和模型覆盖，再管理具体配置。',
  'overview.ready': '本地网关就绪',
  'overview.providers': '提供商',
  'overview.channels': '配置',
  'overview.enabled': '已启用',
  'overview.models': '模型',
  'overview.routeWeight': '路由权重',
  'overview.activeGroups': '活跃协议分组',
  'overview.healthyKeys': '健康上游密钥',
  'overview.eligibleRouting': '可参与路由',
  'overview.uniqueModels': '唯一模型 ID',
  'overview.capacity': '已配置容量',
  'providerMatrix.channels': '配置',
  'dashboard.allProviders': '提供商管理',
  'dashboard.allDescription': '提供商配置按协议聚合：先检查分组状态，再操作下面的配置行。',
  'dashboard.providerDescription': '把凭证作为提供商配置管理，网关会按模型和权重选择可用配置。',
  'dashboard.refresh': '刷新',
  'dashboard.refreshing': '刷新中...',
  'dashboard.addChannel': '添加提供商',
  'dashboard.noCredentials': '还没有提供商配置',
  'dashboard.noProviderChannels': '没有 {provider} 配置',
  'dashboard.noCredentialsDescription': '添加服务地址、API Key、协议、模型和权重后开始路由请求。',
  'dashboard.noProviderChannelsDescription': '切换页面，或为这个协议添加提供商配置。',
  'channel.edit': '编辑',
  'channel.delete': '删除',
  'channel.enable': '启用',
  'channel.disable': '禁用',
  'channel.healthy': '健康',
  'channel.unhealthy': '异常',
  'channel.enabled': '已启用',
  'channel.disabled': '已禁用',
  'channel.weight': '权重',
  'channel.models': '模型',
  'channel.protocol': '协议',
  'editor.new': '新建提供商配置',
  'editor.edit': '编辑提供商配置',
  'editor.addCredential': '添加提供商',
  'editor.close': '关闭',
  'editor.name': '名称',
  'editor.protocol': '协议',
  'editor.baseUrl': 'Base URL',
  'editor.weight': '权重',
  'editor.weightHint': '用于路由优先级和 fallback 选择。',
  'editor.apiKey': 'API Key',
  'editor.models': '模型',
  'editor.modelsHint': '从下拉框选择一个或多个模型；可先点击“获取模型”刷新可选项。',
  'editor.cancel': '取消',
  'editor.save': '保存修改',
  'editor.add': '添加提供商',
  'editor.saving': '保存中...',
  'editor.nameRequired': '名称必填。',
  'editor.baseUrlRequired': 'Base URL 必填。',
  'editor.apiKeyRequired': 'API key 必填。',
  'editor.modelsRequired': '至少需要一个模型。',
};

const dictionaries: Record<Language, Dictionary> = {
  'en-US': en,
  'zh-CN': zh,
};

export function isLanguage(value: string): value is Language {
  return languages.includes(value as Language);
}

export function normalizeLanguage(value?: string | null): Language {
  if (!value) return 'en-US';
  if (value.toLowerCase().startsWith('zh')) return 'zh-CN';
  if (value.toLowerCase().startsWith('en')) return 'en-US';
  return 'en-US';
}

export function createTranslator(language: Language) {
  return (key: TranslationKey, params?: Record<string, string | number>) => {
    let value = dictionaries[language][key] ?? dictionaries['en-US'][key] ?? key;
    if (params) {
      for (const [name, replacement] of Object.entries(params)) {
        value = value.replaceAll(`{${name}}`, String(replacement));
      }
    }
    return value;
  };
}

export function dictionaryKeys(): Record<Language, Dictionary> {
  return dictionaries;
}


