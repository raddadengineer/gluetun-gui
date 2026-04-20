import { useTheme } from '../contexts/ThemeContext';

export default function ThemePicker() {
  const { theme, setTheme, themes } = useTheme();

  return (
    <div className="theme-picker" role="radiogroup" aria-label="Color theme">
      {themes.map((t) => {
        const active = theme === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={active}
            className={`theme-card${active ? ' theme-card--active' : ''}`}
            onClick={() => setTheme(t.id)}
          >
            <div className="theme-card__swatch" aria-hidden>
              <span style={{ background: t.swatch.bg }} />
              <span style={{ background: t.swatch.accent }} />
              <span style={{ background: t.swatch.fg }} />
            </div>
            <div className="theme-card__text">
              <strong>{t.label}</strong>
              <span>{t.description}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
