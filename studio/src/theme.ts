export type Theme = 'system' | 'light' | 'dark';

export function isTheme(value: string): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark';
}

// `system` means "no opinion": the attribute is removed so the
// prefers-color-scheme rule in tokens.css takes over. Anything else pins it.
export function applyTheme(theme: string): void {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
}
