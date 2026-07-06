import { languages, type Language } from '../../i18n';
import { useI18n } from '../../i18n';

export function LanguageToggle() {
  const { language, setLanguage, t } = useI18n();

  return (
    <label className="flex items-center gap-2 rounded-2xl border border-base-300 bg-base-200/70 px-3 py-2 text-xs text-base-content/60">
      <span className="sr-only">{t('language.label')}</span>
      <select
        value={language}
        onChange={(event) => setLanguage(event.target.value as Language)}
        className="cursor-pointer bg-transparent text-base-content outline-none"
        aria-label={t('language.label')}
      >
        {languages.map((item) => (
          <option key={item} value={item} className="bg-base-100 text-base-content">
            {item === 'zh-CN' ? t('language.zh') : t('language.en')}
          </option>
        ))}
      </select>
    </label>
  );
}
