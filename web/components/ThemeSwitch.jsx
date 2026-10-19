'use client';
import { useEffect, useState } from 'react';
import { Monitor, Sun, Moon } from 'lucide-react';

export const THEME_KEY = 'dl_theme';
// Runs before first paint (see app/layout.jsx) so a saved choice never flashes.
export const THEME_BOOT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}`;

const OPTIONS = [['system', 'System', Monitor], ['light', 'Light', Sun], ['dark', 'Dark', Moon]];

// System follows the OS (prefers-color-scheme); Light/Dark force a theme.
// The choice is a per-browser convenience, so localStorage is enough.
export function ThemeSwitch() {
  const [theme, setTheme] = useState('system');
  useEffect(() => { try { setTheme(localStorage.getItem(THEME_KEY) || 'system'); } catch {} }, []);
  const choose = (value) => {
    setTheme(value);
    if (value === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
    try { if (value === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, value); } catch {}
  };
  return (
    <div className="theme-switch" role="group" aria-label="Colour theme">
      {OPTIONS.map(([value, label, Icon]) => (
        <button key={value} type="button" aria-pressed={theme === value} onClick={() => choose(value)} title={`${label} theme`}>
          <Icon size={12} aria-hidden />{label}
        </button>
      ))}
    </div>
  );
}
