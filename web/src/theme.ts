export type Theme = 'light' | 'dark';

export const THEME_KEY = 'pos-gres-v2-theme';

export function getStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch (_error: unknown) {
    return null;
  }
}

export function preferredTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch (_error: unknown) {
    return 'light';
  }
}

/** Tema actualmente aplicado al documento (lo fija el script inline de index.html al arrancar). */
export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (_error: unknown) {
    // localStorage puede estar bloqueado; el tema sigue aplicado en memoria.
  }
}
