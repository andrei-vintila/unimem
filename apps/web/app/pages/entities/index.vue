<script setup lang="ts">
import type { Entity, EntityType } from '@unimem/types';

definePageMeta({
  title: 'Entities',
});

const { queryEntities } = useMemory();
const { ENTITY_TYPES, labelFor } = useEntityTypes();

const entities = ref<Entity[]>([]);
const isLoading = ref(true);
const error = ref<string | null>(null);

/** `null` means "all types". */
const activeType = ref<EntityType | null>(null);

async function load() {
  isLoading.value = true;
  error.value = null;

  try {
    const filter = activeType.value ? { types: [activeType.value] } : {};
    const result = await queryEntities<Entity>(filter);
    entities.value = result.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load entities';
  } finally {
    isLoading.value = false;
  }
}

onMounted(load);
watch(activeType, load);
</script>

<template>
  <div class="p-8">
    <header class="mb-8 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-3xl font-bold">Entities</h1>
        <p class="text-[var(--color-muted)]">
          Everything in your memory, newest first
        </p>
      </div>

      <NuxtLink to="/entities/new" class="btn-primary whitespace-nowrap">
        New Entity
      </NuxtLink>
    </header>

    <div class="flex flex-wrap gap-2 mb-6">
      <button
        type="button"
        class="text-sm px-3 py-1 rounded-full border border-[var(--color-border)]"
        :class="activeType === null ? 'bg-blue-600 text-white border-blue-600' : ''"
        @click="activeType = null"
      >
        All
      </button>
      <button
        v-for="meta in ENTITY_TYPES"
        :key="meta.type"
        type="button"
        class="text-sm px-3 py-1 rounded-full border border-[var(--color-border)]"
        :class="activeType === meta.type ? 'bg-blue-600 text-white border-blue-600' : ''"
        @click="activeType = meta.type"
      >
        {{ meta.label }}
      </button>
    </div>

    <div v-if="isLoading" class="flex justify-center py-12">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>

    <p v-else-if="error" class="card p-4 text-red-600">{{ error }}</p>

    <div v-else-if="entities.length" class="space-y-4">
      <p class="text-sm text-[var(--color-muted)]">
        {{ entities.length }} {{ entities.length === 1 ? 'entity' : 'entities' }}
      </p>

      <EntityCard v-for="entity in entities" :key="entity.id" :entity="entity" />
    </div>

    <div v-else class="text-center py-12 text-[var(--color-muted)]">
      {{
        activeType
          ? `No ${labelFor(activeType).toLowerCase()} entities yet.`
          : 'No entities yet. Create one to get started.'
      }}
    </div>
  </div>
</template>
