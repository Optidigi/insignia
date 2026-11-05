import { useEffect, useState } from "preact/hooks";
import { IconMoon, IconSun } from "./legacy-icons";
import { useLocale } from "./customer-locale";

type Theme = "light" | "dark";
type ThemePreference = Theme | null;
const preferenceKey = "insignia-theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function parsePreference(value: unknown): ThemePreference {
  // An old stored "system" value is the same as no explicit choice.
  return value === "light" || value === "dark" ? value : null;
}
function readPreference(): ThemePreference {
  try {
    return parsePreference(window.localStorage.getItem(preferenceKey));
  } catch {
    return null;
  }
}

// Keep the explicit choice in memory too, so navigation works without storage.
let preference = readPreference();
let resolvedTheme: Theme = preference ?? (media.matches ? "dark" : "light");

function updateTheme() {
  const next = preference ?? (media.matches ? "dark" : "light");
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", next === "dark" ? "#212121" : "#ffffff");
  if (next === resolvedTheme) return;
  resolvedTheme = next;
  listeners.forEach((listener) => listener());
}
function onStorage(event: StorageEvent) {
  if (event.key !== preferenceKey && event.key !== null) return;
  preference = parsePreference(event.newValue);
  updateTheme();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    media.addEventListener("change", updateTheme);
    window.addEventListener("storage", onStorage);
    updateTheme();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      media.removeEventListener("change", updateTheme);
      window.removeEventListener("storage", onStorage);
    }
  };
}
function getSnapshot() {
  return resolvedTheme;
}
function chooseTheme(theme: Theme) {
  preference = theme;
  try {
    window.localStorage.setItem(preferenceKey, theme);
  } catch {
    // The choice still lasts for this document when storage is denied.
  }
  updateTheme();
}

// The head bootstrap handles first paint; this keeps the runtime in sync.
updateTheme();

export function ThemeControl() {
  const { t } = useLocale();
  const [theme, setTheme] = useState(getSnapshot);
  useEffect(() => {
    const update = () => setTheme(getSnapshot());
    const unsubscribe = subscribe(update);
    update();
    return unsubscribe;
  }, []);
  const dark = theme === "dark";
  const Icon = dark ? IconMoon : IconSun;
  return (
    <button
      type="button"
      className="theme-control"
      role="switch"
      aria-label={t("customer:theme.darkMode")}
      aria-checked={dark}
      title={dark ? t("customer:theme.switchToLight") : t("customer:theme.switchToDark")}
      onClick={() => chooseTheme(dark ? "light" : "dark")}
    >
      <Icon size={20} aria-hidden="true" />
    </button>
  );
}
