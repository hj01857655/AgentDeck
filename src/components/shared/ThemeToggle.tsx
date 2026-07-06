import { useEffect, useState } from 'react';

type ThemeName = 'light' | 'dark';

const storageKey = 'ai-gateway-theme';

function resolveInitialTheme(): ThemeName {
  if (typeof window === 'undefined') return 'light';
  const saved = window.localStorage.getItem(storageKey);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeName>(resolveInitialTheme);
  const nextTheme: ThemeName = theme === 'dark' ? 'light' : 'dark';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem(storageKey, theme);
  }, [theme]);

  return (
    <button
      type="button"
      className="btn btn-square btn-ghost btn-sm border border-base-300 bg-base-200/70"
      onClick={() => setTheme(nextTheme)}
      aria-label={`当前${theme === 'dark' ? '深色' : '浅色'}主题，点击切换到${nextTheme === 'dark' ? '深色' : '浅色'}主题`}
      title={`当前${theme === 'dark' ? '深色' : '浅色'}主题，点击切换到${nextTheme === 'dark' ? '深色' : '浅色'}主题`}
    >
      {theme === 'dark' ? (
        <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.5 14.5A8.4 8.4 0 0 1 9.5 3.5a7.8 7.8 0 1 0 11 11Z" />
        </svg>
      ) : (
        <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2.2M12 19.8V22M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2 12h2.2M19.8 12H22M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
        </svg>
      )}
    </button>
  );
}
