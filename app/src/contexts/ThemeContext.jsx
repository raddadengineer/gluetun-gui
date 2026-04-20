import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'gluetun_gui_theme_v1';

/** @type {{ id: string, label: string, description: string, swatch: { bg: string, accent: string, fg: string } }[]} */
export const THEMES = [
  { id: 'dark', label: 'Dark', description: 'Neutral default; balanced contrast.', swatch: { bg: '#0d0f14', accent: '#3b82f6', fg: '#f0f2f5' } },
  { id: 'charcoal', label: 'Charcoal', description: 'Deep gray background; very readable body text.', swatch: { bg: '#161616', accent: '#60a5fa', fg: '#fafafa' } },
  { id: 'ocean', label: 'Ocean', description: 'Cool blues and cyan accent.', swatch: { bg: '#051a24', accent: '#22d3ee', fg: '#e8f4fc' } },
  { id: 'midnight', label: 'Midnight', description: 'Deep indigo night tones.', swatch: { bg: '#070a12', accent: '#60a5fa', fg: '#eef2ff' } },
  { id: 'slate', label: 'Slate', description: 'Blue-gray panels; green accent.', swatch: { bg: '#0b1220', accent: '#22c55e', fg: '#f8fafc' } },
  { id: 'sunset', label: 'Sunset', description: 'Warm dark plum with rose highlights.', swatch: { bg: '#1a1018', accent: '#fb7185', fg: '#fdf2f8' } },
  { id: 'aurora', label: 'Aurora', description: 'Violet dark with soft purple accent.', swatch: { bg: '#0f0a18', accent: '#a78bfa', fg: '#f5f3ff' } },
  { id: 'high-contrast', label: 'High contrast', description: 'Maximum separation; accessibility.', swatch: { bg: '#000000', accent: '#fbbf24', fg: '#ffffff' } },
  { id: 'light', label: 'Light', description: 'Bright workspace; cool grays.', swatch: { bg: '#f4f6f8', accent: '#0ea5e9', fg: '#1e293b' } },
  { id: 'paper', label: 'Paper', description: 'Crisp light; stronger text contrast.', swatch: { bg: '#fafbfc', accent: '#2563eb', fg: '#0f172a' } },
  { id: 'sepia', label: 'Sepia', description: 'Warm cream; easier long reading.', swatch: { bg: '#f4ecd8', accent: '#92400e', fg: '#3d3428' } },
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
