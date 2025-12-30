<script setup lang="ts">
// TODO: Connect to actual sync manager
const syncStatus = ref<'synced' | 'pending' | 'error'>('synced');
const lastSync = ref<Date | null>(null);

const statusConfig = computed(() => {
  switch (syncStatus.value) {
    case 'synced':
      return {
        color: 'text-green-600',
        bg: 'bg-green-100 dark:bg-green-900',
        label: 'Synced',
        icon: 'check',
      };
    case 'pending':
      return {
        color: 'text-yellow-600',
        bg: 'bg-yellow-100 dark:bg-yellow-900',
        label: 'Syncing...',
        icon: 'refresh',
      };
    case 'error':
      return {
        color: 'text-red-600',
        bg: 'bg-red-100 dark:bg-red-900',
        label: 'Sync Error',
        icon: 'x',
      };
  }
});
</script>

<template>
  <div
    class="flex items-center gap-2 p-2 rounded-lg text-sm"
    :class="statusConfig.bg"
  >
    <span
      class="w-2 h-2 rounded-full"
      :class="[
        syncStatus === 'synced' ? 'bg-green-500' : '',
        syncStatus === 'pending' ? 'bg-yellow-500 animate-pulse' : '',
        syncStatus === 'error' ? 'bg-red-500' : '',
      ]"
    />
    <span :class="statusConfig.color">{{ statusConfig.label }}</span>
  </div>
</template>
