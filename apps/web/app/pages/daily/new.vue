<script setup lang="ts">
import type { DailyNote } from '@unimem/types';

definePageMeta({
  title: 'New Daily Note',
});

const { createEntity, queryEntities, getEngine } = useMemory();
const router = useRouter();

const date = ref(new Date().toISOString().slice(0, 10));
const content = ref('');
const summary = ref('');

const isSaving = ref(false);
const error = ref<string | null>(null);

/**
 * `daily_notes.date` is UNIQUE, so a second note for the same day fails at the
 * database rather than in the form. Checking here turns a constraint violation
 * into an answerable question.
 */
const existing = ref<DailyNote | null>(null);

watch(
  date,
  async (value) => {
    const matches = await queryEntities<DailyNote>({ types: ['daily-note'] });
    existing.value = matches.find((n) => n.date === value) ?? null;
  },
  { immediate: true }
);

const canSave = computed(
  () => content.value.trim().length > 0 && !existing.value && !isSaving.value
);

async function save() {
  if (!canSave.value) return;

  isSaving.value = true;
  error.value = null;

  try {
    const note = await createEntity<DailyNote>({
      type: 'daily-note',
      memoryLayer: getEngine().getLayerForEntityType('daily-note'),
      title: date.value,
      content: content.value.trim(),
      date: date.value,
      ...(summary.value.trim() ? { summary: summary.value.trim() } : {}),
      links: [],
      tags: [],
    });

    await router.push(`/entities/${note.id}`);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to save daily note';
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <div class="p-8 max-w-2xl">
    <header class="mb-8">
      <h1 class="text-3xl font-bold">New Daily Note</h1>
      <p class="text-[var(--color-muted)]">
        Capture the day before it consolidates
      </p>
    </header>

    <form class="space-y-6" @submit.prevent="save">
      <div>
        <label for="date" class="block text-sm font-medium mb-1">Date</label>
        <input id="date" v-model="date" type="date" class="input">

        <p v-if="existing" class="text-sm text-yellow-600 mt-2">
          A note already exists for {{ date }}.
          <NuxtLink :to="`/entities/${existing.id}`" class="underline">
            Open it instead
          </NuxtLink>
        </p>
      </div>

      <div>
        <label for="content" class="block text-sm font-medium mb-1">Notes</label>
        <textarea
          id="content"
          v-model="content"
          rows="12"
          class="input font-mono"
          placeholder="What happened today?"
        />
      </div>

      <div>
        <label for="summary" class="block text-sm font-medium mb-1">
          Summary <span class="text-[var(--color-muted)]">(optional)</span>
        </label>
        <input
          id="summary"
          v-model="summary"
          type="text"
          class="input"
          placeholder="One line for future you"
        >
      </div>

      <p v-if="error" class="text-red-600">{{ error }}</p>

      <div class="flex gap-4">
        <button type="submit" class="btn-primary" :disabled="!canSave">
          {{ isSaving ? 'Saving...' : 'Save Note' }}
        </button>
        <NuxtLink to="/daily" class="btn-secondary">Cancel</NuxtLink>
      </div>
    </form>
  </div>
</template>
