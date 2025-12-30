<script setup lang="ts">
const { isInitialized, isLoading } = useMemory();
</script>

<template>
  <div class="min-h-screen flex">
    <!-- Sidebar -->
    <aside class="w-64 border-r border-[var(--color-border)] bg-gray-50 dark:bg-gray-900">
      <div class="p-4">
        <h1 class="text-xl font-bold">Unimem</h1>
        <p class="text-sm text-[var(--color-muted)]">Neural Memory</p>
      </div>

      <nav class="mt-4">
        <NavLink to="/" icon="home">Dashboard</NavLink>
        <NavLink to="/daily" icon="calendar">Daily Notes</NavLink>
        <NavLink to="/entities" icon="users">Entities</NavLink>
        <NavLink to="/search" icon="search">Search</NavLink>
        <NavLink to="/settings" icon="settings">Settings</NavLink>
      </nav>

      <!-- Sync status -->
      <div class="absolute bottom-4 left-4 right-4">
        <SyncStatus />
      </div>
    </aside>

    <!-- Main content -->
    <main class="flex-1 overflow-auto">
      <div v-if="isLoading" class="flex items-center justify-center h-full">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>

      <div v-else-if="!isInitialized" class="flex items-center justify-center h-full">
        <div class="text-center">
          <p class="text-lg mb-4">Initializing database...</p>
          <button class="btn-primary" @click="useMemory().initialize()">
            Retry
          </button>
        </div>
      </div>

      <slot v-else />
    </main>
  </div>
</template>
