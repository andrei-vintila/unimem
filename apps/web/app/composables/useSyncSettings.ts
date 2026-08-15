// =============================================================================
// Sync settings - where this device syncs, and as whom
// =============================================================================
//
// Both values are per-device rather than per-build. The server derives the
// vault from the token, so pointing a second device at the same server with
// the same token is the whole of "set up sync on my other machine" - there is
// no account to create and no pairing step.
//
// Stored in localStorage, which means script running on this origin can read
// the token. That is the same exposure as the vault contents sitting in
// IndexedDB next to it, so it buys an attacker nothing they did not already
// have; it is worth knowing before this token is ever reused elsewhere.

const SERVER_URL_KEY = 'unimem:syncServerUrl';
const TOKEN_KEY = 'unimem:syncToken';

const serverUrl = ref('');
const authToken = ref('');
let loaded = false;

export function useSyncSettings() {
  const config = useRuntimeConfig();

  // The build-time URL is a default for a fresh device, not an override - a
  // user who has pointed this device somewhere else keeps their choice.
  if (!loaded && typeof localStorage !== 'undefined') {
    serverUrl.value =
      localStorage.getItem(SERVER_URL_KEY) ??
      ((config.public?.syncServerUrl as string | undefined) || '');
    authToken.value = localStorage.getItem(TOKEN_KEY) ?? '';
    loaded = true;
  }

  function save(next: { serverUrl: string; authToken: string }): void {
    serverUrl.value = next.serverUrl.trim().replace(/\/+$/, '');
    authToken.value = next.authToken.trim();

    if (typeof localStorage === 'undefined') return;

    localStorage.setItem(SERVER_URL_KEY, serverUrl.value);
    localStorage.setItem(TOKEN_KEY, authToken.value);
  }

  const isConfigured = computed(() => Boolean(serverUrl.value && authToken.value));

  return {
    serverUrl: readonly(serverUrl),
    authToken: readonly(authToken),
    isConfigured,
    save,
  };
}
