import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'gluetun_gui_theme_v1';

export const THEMES = [
  { id: 'dark', label: 'Dark (Default)' },
  { id: 'light', label: 'Light' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'slate', label: 'Slate' },
  { id: 'high-contrast', label: 'High Contrast' },
];

const ThemeContext = createContext(null);

function applyTheme(id) {
  document.documentElement.setAttribute('data-theme', id);
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState('dark');

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const id = THEMES.some(t => t.id === saved) ? saved : 'dark';
    setThemeState(id);
    applyTheme(id);
  }, []);

  const setTheme = useCallback((id) => {
    const next = THEMES.some(t => t.id === id) ? id : 'dark';
    setThemeState(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme, themes: THEMES }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

