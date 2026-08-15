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

onMounted(async () => {
  storageLocation.value = bridge.value
    ? await bridge.value.getDatabasePath()
    : 'IndexedDB (idb://unimem)';
});

const syncServer = computed(
  () => config.public.syncServerUrl || 'Not configured'
);

const isRefreshing = ref(false);

async function refresh() {
  isRefreshing.value = true;
  try {
    await refreshStats();
  } finally {
    isRefreshing.value = false;
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
          <div class="flex gap-4">
            <dt class="w-40 shrink-0 text-sm text-[var(--color-muted)]">
              Database
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
        <dl class="space-y-3">
          <div class="flex gap-4">
            <dt class="w-40 shrink-0 text-sm text-[var(--color-muted)]">
              Server
            </dt>
            <dd class="text-sm font-mono break-all">{{ syncServer }}</dd>
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
