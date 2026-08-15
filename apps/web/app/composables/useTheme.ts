export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'unimem:theme';

// Module-level so every caller shares one preference rather than each component
// tracking its own copy.
const preference = ref<ThemePreference>('system');
const systemPrefersDark = ref(false);

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

/**
 * Resolved appearance. `system` defers to the OS, which is what the app did
 * before a preference existed - so an untouched install behaves identically.
 */
const isDark = computed(
  () =>
    preference.value === 'dark' ||
    (preference.value === 'system' && systemPrefersDark.value)
);

function applyToDocument(): void {
  document.documentElement.classList.toggle('dark', isDark.value);
}

/**
 * Called once from the client plugin. Safe to call again; re-running only
 * re-reads storage.
 */
export function initTheme(): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  systemPrefersDark.value = media.matches;
  media.addEventListener('change', (event) => {
    systemPrefersDark.value = event.matches;
  });

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isThemePreference(stored)) preference.value = stored;
  } catch {
    // Blocked storage (private mode, hardened settings) - stay on `system`.
  }

  watch(isDark, applyToDocument, { immediate: true });
}

export function useTheme() {
  function setPreference(value: ThemePreference): void {
    preference.value = value;

    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // The preference still applies for this session.
    }
  }

  return {
    preference: readonly(preference),
    isDark: readonly(isDark),
    setPreference,
  };
}
