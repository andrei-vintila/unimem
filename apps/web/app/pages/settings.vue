<script setup lang="ts">
import type { ThemePreference } from '~/composables/useTheme';

definePageMeta({
  title: 'Settings',
});

const config = useRuntimeConfig();
const { stats, refreshStats } = useMemory();
const { preference, setPreference } = useTheme();

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

/**
 * The desktop shell injects `window.unimem`; on web it is absent. Everything
 * below degrades to the browser answer rather than pretending to know a path.
 */
const bridge = computed(() =>
  typeof window === 'undefined' ? undefined : window.unimem
);

const surface = computed(() => (bridge.value ? 'Desktop' : 'Browser'));
const platform = computed(() => bridge.value?.platform ?? 'web');
const version = computed(
  () => bridge.value?.appVersion ?? config.public.appVersion
);

const storageLocation = ref('Loading...');
const vaultLocation = ref<string | null>(null);

onMounted(async () => {
  storageLocation.value = bridge.value
    ? await bridge.value.getDatabasePath()
    : 'IndexedDB (idb://unimem)';

  // The vault is the store; the database above it is only a derived index.
  // On web there is no filesystem to hold one.
  vaultLocation.value = bridge.value ? await bridge.value.bundle.root() : null;
});

const isRefreshing = ref(false);

async function refresh() {
  isRefreshing.value = true;
  try {
    await refreshStats();
  } finally {
    isRefreshing.value = false;
  }
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

const { serverUrl, authToken, isConfigured, save } = useSyncSettings();
const { syncState, rejections, reconfigure, syncNow } = useSync();

const serverUrlDraft = ref(serverUrl.value);
const authTokenDraft = ref(authToken.value);
const isApplying = ref(false);

const isDirty = computed(
  () =>
    serverUrlDraft.value.trim().replace(/\/+$/, '') !== serverUrl.value ||
    authTokenDraft.value.trim() !== authToken.value
);

async function applySyncSettings() {
  isApplying.value = true;
  try {
    save({
      serverUrl: serverUrlDraft.value,
      authToken: authTokenDraft.value,
    });
    serverUrlDraft.value = serverUrl.value;
    authTokenDraft.value = authToken.value;
    await reconfigure();
  } finally {
    isApplying.value = false;
  }
}
</script>

<template>
  <div class="p-8 max-w-2xl">
    <header class="mb-8">
      <h1 class="text-3xl font-bold">Settings</h1>
      <p class="text-[var(--color-muted)]">
        How this vault is stored and displayed
      </p>
    </header>

    <section class="mb-8">
      <h2 class="text-xl font-semibold mb-4">Appearance</h2>
      <div class="card p-4">
        <p class="text-sm font-medium mb-3">Theme</p>
        <div class="flex gap-2">
          <button
            v-for="theme in THEMES"
            :key="theme.value"
            type="button"
            class="text-sm px-3 py-1.5 rounded-lg border border-[var(--color-border)]"
            :class="
              preference === theme.value
                ? 'bg-blue-600 text-white border-blue-600'
                : ''
            "
            @click="setPreference(theme.value)"
          >
            {{ theme.label }}
          </button>
        </div>
      </div>
    </section>

    <section class="mb-8">
      <h2 class="text-xl font-semibold mb-4">Storage</h2>
      <div class="card p-4">
        <dl class="space-y-3">
          <div v-if="vaultLocation" class="flex gap-4">
            <dt class="w-40 shrink-0 text-sm text-[var(--color-muted)]">
              Vault
            </dt>
            <dd class="text-sm font-mono break-all">
              {{ vaultLocation }}
              <p class="font-sans text-[var(--color-muted)] mt-1">
                Markdown files, one per entity. This is the store — open it in
                Obsidian, track it in git, edit it by hand.
              </p>
            </dd>
          </div>
          <div class="flex gap-4">
            <dt class="w-40 shrink-0 text-sm text-[var(--color-muted)]">
              {{ vaultLocation ? 'Index' : 'Database' }}
            </dt>
            <dd class="text-sm font-mono break-all">{{ storageLocation }}</dd>
          </div>
          <div class="flex gap-4">
            <dt class="w-40 shrink-0 text-sm text-[var(--color-muted)]">
              Entities
            </dt>
            <dd class="text-sm">{{ stats?.totalEntities ?? 0 }}</dd>
          </div>
          <div class="flex gap-4">
            <dt class="w-40 shrink-0 text-sm text-[var(--color-muted)]">
              Vectors
            </dt>
            <dd class="text-sm">{{ stats?.vectorCount ?? 0 }}</dd>
          </div>
        </dl>

        <button
          type="button"
          class="btn-secondary mt-4 text-sm"
          :disabled="isRefreshing"
          @click="refresh"
        >
          {{ isRefreshing ? 'Refreshing...' : 'Refresh stats' }}
        </button>
      </div>
    </section>

    <section class="mb-8">
      <h2 class="text-xl font-semibold mb-4">Sync</h2>
      <div class="card p-4">
        <p class="text-sm text-[var(--color-muted)] mb-4">
          Your token identifies you, not just your devices — use the same one
          on each of your machines, and ask the vault owner for a token of your
          own if you are joining someone else's. Treat it like a password.
        </p>

        <form class="space-y-4" @submit.prevent="applySyncSettings">
          <div>
            <label
              for="sync-server"
              class="block text-sm font-medium mb-1"
            >Server URL</label>
            <input
              id="sync-server"
              v-model="serverUrlDraft"
              type="url"
              inputmode="url"
              autocomplete="off"
              placeholder="https://sync.example.com"
              class="w-full text-sm font-mono rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2"
            >
          </div>

          <div>
            <label
              for="sync-token"
              class="block text-sm font-medium mb-1"
            >Sync token</label>
            <input
              id="sync-token"
              v-model="authTokenDraft"
              type="password"
              autocomplete="off"
              placeholder="Paste the same token on every device"
              class="w-full text-sm font-mono rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2"
            >
          </div>

          <div class="flex items-center gap-2">
            <button
              type="submit"
              class="btn-secondary text-sm"
              :disabled="isApplying || !isDirty"
            >
              {{ isApplying ? 'Applying…' : 'Save and reconnect' }}
            </button>
            <button
              type="button"
              class="btn-secondary text-sm"
              :disabled="!isConfigured || syncState.status === 'syncing'"
              @click="syncNow"
            >
              Sync now
            </button>
          </div>
        </form>

        <div
          v-if="rejections.length > 0"
          class="mt-4 p-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-800"
        >
          <p class="text-sm font-medium">
            {{ rejections.length }}
            {{ rejections.length === 1 ? 'change was' : 'changes were' }}
            sent for review
          </p>
          <p class="text-sm text-[var(--color-muted)] mt-1">
            You do not have write access to those folders, so these were kept
            as change requests. They stay here either way — someone who can
            write there decides whether they land.
          </p>
          <ul class="mt-2 space-y-1">
            <li
              v-for="rejection in rejections"
              :key="rejection.entityId"
              class="text-sm font-mono break-all"
            >
              {{ rejection.reason }}
            </li>
          </ul>
        </div>

        <dl class="space-y-3 mt-6 pt-4 border-t border-[var(--color-border)]">
          <div class="flex gap-4">
            <dt class="w-40 shrink-0 text-sm text-[var(--color-muted)]">
              Status
            </dt>
            <dd class="text-sm">
              {{ isConfigured ? syncState.status : 'Not configured' }}
            </dd>
          </div>
          <div class="flex gap-4">
            <dt class="w-40 shrink-0 text-sm text-[var(--color-muted)]">
              Last sync
            </dt>
            <dd class="text-sm">
              {{
                stats?.lastSync
                  ? new Date(stats.lastSync).toLocaleString()
                  : 'Never'
              }}
            </dd>
          </div>
        </dl>
      </div>
    </section>

    <VaultMembers />

    <ChangeRequests />

    <section>
      <h2 class="text-xl font-semibold mb-4">About</h2>
      <div class="card p-4">
        <dl class="space-y-3">
          <div class="flex gap-4">
            <dt class="w-40 shrink-0 text-sm text-[var(--color-muted)]">
              Surface
            </dt>
            <dd class="text-sm">{{ surface }}</dd>
          </div>
          <div class="flex gap-4">
            <dt class="w-40 shrink-0 text-sm text-[var(--color-muted)]">
              Platform
            </dt>
            <dd class="text-sm">{{ platform }}</dd>
          </div>
          <div class="flex gap-4">
            <dt class="w-40 shrink-0 text-sm text-[var(--color-muted)]">
              Version
            </dt>
            <dd class="text-sm font-mono">{{ version }}</dd>
          </div>
        </dl>
      </div>
    </section>
  </div>
</template>
