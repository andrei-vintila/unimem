<script setup lang="ts">
import type { Entity } from '@unimem/types';

defineProps<{ entity: Entity }>();

const { labelFor, layerLabel, layerClass } = useEntityTypes();
</script>

<template>
  <NuxtLink
    :to="`/entities/${entity.id}`"
    class="card p-4 block hover:shadow-md transition-shadow"
  >
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">
            {{ labelFor(entity.type) }}
          </span>
          <span
            class="text-xs px-2 py-1 rounded"
            :class="layerClass(entity.memoryLayer)"
          >
            {{ layerLabel(entity.memoryLayer) }}
          </span>
        </div>

        <h3 class="text-lg font-medium mt-2 truncate">{{ entity.title }}</h3>
        <p class="text-[var(--color-muted)] line-clamp-2 mt-1">
          {{ entity.content }}
        </p>
      </div>

      <time
        class="text-xs text-[var(--color-muted)] whitespace-nowrap"
        :datetime="new Date(entity.updatedAt).toISOString()"
      >
        {{ new Date(entity.updatedAt).toLocaleDateString() }}
      </time>
    </div>

    <div v-if="entity.tags?.length" class="mt-3 flex flex-wrap gap-1">
      <span
        v-for="tag in entity.tags"
        :key="tag"
        class="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800"
      >
        {{ tag }}
      </span>
    </div>
  </NuxtLink>
</template>
