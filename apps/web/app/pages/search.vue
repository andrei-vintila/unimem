<script setup lang="ts">
import type { Entity, SearchResult } from '@unimem/types';

definePageMeta({
  title: 'Search',
});

const query = ref('');
const results = ref<SearchResult<Entity>[]>([]);
const isSearching = ref(false);

const { search } = useMemory();

const debouncedSearch = useDebounceFn(async () => {
  if (!query.value.trim()) {
    results.value = [];
    return;
  }

  isSearching.value = true;
  try {
    const response = await search(query.value);
    results.value = response.results;
  } catch (error) {
    console.error('Search error:', error);
    results.value = [];
  } finally {
    isSearching.value = false;
  }
}, 300);

watch(query, debouncedSearch);
</script>

<template>
  <div class="p-8">
    <header class="mb-8">
      <h1 class="text-3xl font-bold">Search</h1>
      <p class="text-[var(--color-muted)]">Find memories using vector similarity</p>
    </header>

    <!-- Search Input -->
    <div class="mb-8">
      <div class="relative">
        <input
          v-model="query"
          type="text"
          class="input pl-10 text-lg"
          placeholder="Search your memories..."
        >
        <svg
          class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--color-muted)]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <div
          v-if="isSearching"
          class="absolute right-3 top-1/2 -translate-y-1/2"
        >
          <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
        </div>
      </div>
    </div>

    <!-- Results -->
    <div v-if="results.length > 0" class="space-y-4">
      <p class="text-sm text-[var(--color-muted)]">
        Found {{ results.length }} results
      </p>

      <div
        v-for="result in results"
        :key="result.entity.id"
        class="card p-4 hover:shadow-md transition-shadow cursor-pointer"
      >
        <div class="flex items-start justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">
                {{ result.entity.type }}
              </span>
              <span class="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                {{ result.entity.memoryLayer }}
              </span>
            </div>
            <h3 class="text-lg font-medium mt-2">{{ result.entity.title }}</h3>
            <p class="text-[var(--color-muted)] line-clamp-2 mt-1">
              {{ result.entity.content }}
            </p>
          </div>

          <div class="text-right">
            <p class="text-sm font-medium text-blue-600">
              {{ (result.score * 100).toFixed(1) }}%
            </p>
            <p class="text-xs text-[var(--color-muted)]">match</p>
          </div>
        </div>

        <div v-if="result.entity.tags?.length" class="mt-3 flex gap-1">
          <span
            v-for="tag in result.entity.tags"
            :key="tag"
            class="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800"
          >
            {{ tag }}
          </span>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="query && !isSearching"
      class="text-center py-12 text-[var(--color-muted)]"
    >
      No results found for "{{ query }}"
    </div>

    <div
      v-else-if="!query"
      class="text-center py-12 text-[var(--color-muted)]"
    >
      Start typing to search your memories
    </div>
  </div>
</template>
