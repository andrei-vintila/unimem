<script setup lang="ts">
const { stats } = useMemory();

definePageMeta({
  title: 'Dashboard',
});

const memoryLayers = [
  { type: 'working', label: 'Working Memory', color: 'working' },
  { type: 'episodic', label: 'Episodic Memory', color: 'episodic' },
  { type: 'semantic', label: 'Semantic Memory', color: 'semantic' },
  { type: 'procedural', label: 'Procedural Memory', color: 'procedural' },
] as const;
</script>

<template>
  <div class="p-8">
    <header class="mb-8">
      <h1 class="text-3xl font-bold">Dashboard</h1>
      <p class="text-[var(--color-muted)]">Your neural memory at a glance</p>
    </header>

    <!-- Stats Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <div class="card p-4">
        <p class="text-sm text-[var(--color-muted)]">Total Entities</p>
        <p class="text-3xl font-bold">{{ stats?.totalEntities ?? 0 }}</p>
      </div>

      <div class="card p-4">
        <p class="text-sm text-[var(--color-muted)]">Vectors</p>
        <p class="text-3xl font-bold">{{ stats?.vectorCount ?? 0 }}</p>
      </div>

      <div class="card p-4">
        <p class="text-sm text-[var(--color-muted)]">Storage</p>
        <p class="text-3xl font-bold">{{ formatBytes(stats?.storageSize ?? 0) }}</p>
      </div>

      <div class="card p-4">
        <p class="text-sm text-[var(--color-muted)]">Last Sync</p>
        <p class="text-xl font-bold">{{ formatRelative(stats?.lastSync) }}</p>
      </div>
    </div>

    <!-- Memory Layers -->
    <section class="mb-8">
      <h2 class="text-xl font-semibold mb-4">Memory Layers</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div
          v-for="layer in memoryLayers"
          :key="layer.type"
          class="card p-4 flex items-center gap-4"
        >
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center"
            :class="`bg-${layer.color}-100 text-${layer.color}-600`"
          >
            <span class="text-xl font-bold">
              {{ stats?.byLayer?.[layer.type] ?? 0 }}
            </span>
          </div>
          <div>
            <p class="font-medium">{{ layer.label }}</p>
            <p class="text-sm text-[var(--color-muted)]">
              {{ getLayerDescription(layer.type) }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Quick Actions -->
    <section>
      <h2 class="text-xl font-semibold mb-4">Quick Actions</h2>
      <div class="flex gap-4">
        <NuxtLink to="/daily/new" class="btn-primary">
          New Daily Note
        </NuxtLink>
        <NuxtLink to="/entities/new" class="btn-secondary">
          New Entity
        </NuxtLink>
        <button class="btn-secondary" @click="runConsolidation">
          Run Consolidation
        </button>
      </div>
    </section>
  </div>
</template>

<script lang="ts">
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatRelative(date?: Date | string): string {
  if (!date) return 'Never';
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return d.toLocaleDateString();
}

function getLayerDescription(type: string): string {
  const descriptions: Record<string, string> = {
    working: 'Daily notes, current context',
    episodic: 'People, companies, projects',
    semantic: 'Areas, resources, concepts',
    procedural: 'Tasks, workflows, habits',
  };
  return descriptions[type] ?? '';
}

function runConsolidation() {
  // TODO: Implement consolidation trigger
  console.log('Running consolidation...');
}
</script>
