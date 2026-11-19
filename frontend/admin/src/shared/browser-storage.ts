/**
 * Web Storage for the embedded admin, with an in-memory fallback.
 *
 * Shopify loads the admin in a cross-site iframe. When the browser blocks third-party cookies (Chrome's
 * default in incognito), reading `window.sessionStorage` or `window.localStorage` there throws a
 * `SecurityError`. Shopify requires embedded apps to keep working in that mode (App Store requirement
 * 1.1.1), so callers use these accessors instead of the globals. The fallback lives for the current page
 * only: state that would have survived a reload (draft selections, pending-write journals) is simply
 * not resumed after one.
 */
export function sessionStore(): Storage {
  return resolve('sessionStorage');
}

export function localStore(): Storage {
  return resolve('localStorage');
}

const fallbacks = new Map<string, Storage>();
const probeKey = 'insignia:storage-probe';

function resolve(name: 'sessionStorage' | 'localStorage'): Storage {
  try {
    const storage = window[name];
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return storage;
  } catch {
    let fallback = fallbacks.get(name);
    if (!fallback) fallbacks.set(name, (fallback = memoryStorage()));
    return fallback;
  }
}

export function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(String(key)) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(String(key)),
    setItem: (key, value) => void values.set(String(key), String(value)),
  };
}
