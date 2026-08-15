<script setup lang="ts">
import type { DailyNote } from '@unimem/types';

definePageMeta({
  title: 'Daily Notes',
});

const { queryEntities } = useMemory();

const notes = ref<DailyNote[]>([]);
const isLoading = ref(true);
const error = ref<string | null>(null);

// The layout only mounts a page once the engine is ready, so this never races
// initialization - and it never runs during prerender, where there is no
// database at all.
onMounted(async () => {
  try {
    const result = await queryEntities<DailyNote>({ types: ['daily-note'] });
    notes.value = result.sort((a, b) => b.date.localeCompare(a.date));
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load daily notes';
  } finally {
    isLoading.value = false;
  }
});

const today = new Date().toISOString().slice(0, 10);
const hasToday = computed(() => notes.value.some((n) => n.date === today));
</script>

<template>
  <div class="p-8">
    <header class="mb-8 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-3xl font-bold">Daily Notes</h1>
        <p class="text-[var(--color-muted)]">
          Working memory - one entry per day
        </p>
      </div>

      <NuxtLink to="/daily/new" class="btn-primary whitespace-nowrap">
        New Daily Note
      </NuxtLink>
    </header>

    <div
      v-if="!isLoading && !hasToday"
      class="card p-4 mb-6 flex items-center justify-between gap-4"
    >
      <p class="text-[var(--color-muted)]">
        Nothing captured for today yet.
      </p>
      <NuxtLink to="/daily/new" class="btn-secondary whitespace-nowrap">
        Write today's note
      </NuxtLink>
    </div>

    <div v-if="isLoading" class="flex justify-center py-12">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>

    <p v-else-if="error" class="card p-4 text-red-600">
      {{ error }}
    </p>

    <div v-else-if="notes.length" class="space-y-4">
      <NuxtLink
        v-for="note in notes"
        :key="note.id"
        :to="`/entities/${note.id}`"
        class="card p-4 block hover:shadow-md transition-shadow"
      >
        <div class="flex items-baseline justify-between gap-4">
          <h2 class="text-lg font-medium">{{ note.title }}</h2>
          <time class="text-sm text-[var(--color-muted)]" :datetime="note.date">
            {{ note.date }}
          </time>
        </div>
        <p class="text-[var(--color-muted)] line-clamp-2 mt-1">
          {{ note.summary || note.content }}
        </p>
      </NuxtLink>
    </div>

    <div v-else class="text-center py-12 text-[var(--color-muted)]">
      No daily notes yet. Your working memory starts here.
    </div>
  </div>
</template>
