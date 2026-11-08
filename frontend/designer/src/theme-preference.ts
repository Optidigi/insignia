export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | null;
export const themePreferenceKey = 'insignia-theme';
export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : null;
}
export function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(themePreferenceKey));
  } catch {
    return null;
  }
}
export function resolveThemePreference(preference: ThemePreference, systemDark: boolean): Theme {
  return preference ?? (systemDark ? 'dark' : 'light');
}
