<script setup lang="ts">
const { syncState, syncNow } = useSync();

const statusConfig = computed(() => {
  switch (syncState.value.status) {
    case 'synced':
      return {
        color: 'text-green-600',
        bg: 'bg-green-100 dark:bg-green-900',
        label: 'Synced',
        dotClass: 'bg-green-500',
      };
    case 'syncing':
      return {
        color: 'text-yellow-600',
        bg: 'bg-yellow-100 dark:bg-yellow-900',
        label: 'Syncing…',
        dotClass: 'bg-yellow-500 animate-pulse',
      };
    case 'conflict':
      return {
        color: 'text-orange-600',
        bg: 'bg-orange-100 dark:bg-orange-900',
        label: `${syncState.value.conflictCount} conflict${syncState.value.conflictCount !== 1 ? 's' : ''}`,
        dotClass: 'bg-orange-500',
      };
    case 'error':
      return {
        color: 'text-red-600',
        bg: 'bg-red-100 dark:bg-red-900',
        label: 'Sync error',
        dotClass: 'bg-red-500',
      };
    default:
      return {
        color: 'text-gray-600',
        bg: 'bg-gray-100 dark:bg-gray-800',
        label: 'Pending',
        dotClass: 'bg-gray-400 animate-pulse',
      };
  }
});

const lastSyncLabel = computed(() => {
  const d = syncState.value.lastSyncedAt;
  if (!d) return null;
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
    Math.round((new Date(d).getTime() - Date.now()) / 1000),
    'second'
  );
});
</script>

<template>
  <div
    class="flex items-center gap-2 p-2 rounded-lg text-sm cursor-pointer select-none"
    :class="statusConfig.bg"
    :title="lastSyncLabel ? `Last synced ${lastSyncLabel}` : 'Not yet synced'"
    @click="syncNow"
  >
    <span class="w-2 h-2 rounded-full flex-shrink-0" :class="statusConfig.dotClass" />
    <span :class="statusConfig.color">{{ statusConfig.label }}</span>
    <span
      v-if="syncState.pendingChanges > 0"
      class="ml-1 text-xs opacity-70"
      :class="statusConfig.color"
    >
      ({{ syncState.pendingChanges }} pending)
    </span>
  </div>
</template>
