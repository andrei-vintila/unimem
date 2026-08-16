<script setup lang="ts">
import type { Entity } from '@unimem/types';

definePageMeta({
  title: 'Entity',
});

const { getEntity, deleteEntity } = useMemory();
const { labelFor, layerLabel, layerClass } = useEntityTypes();
const { canWriteEntity, pathFor, refresh: refreshPolicy } = usePolicy();
const route = useRoute();
const router = useRouter();

const entity = ref<Entity | null>(null);
const isLoading = ref(true);
const error = ref<string | null>(null);
const isDeleting = ref(false);
const confirmingDelete = ref(false);

/**
 * Whether changes here would be applied or proposed.
 *
 * Advisory: the server decides, and a change to a folder this person does not
 * own is kept as a change request rather than refused. Saying so up front is
 * kinder than letting them write and explaining afterwards.
 */
const canEdit = computed(() => !entity.value || canWriteEntity(entity.value));
const documentPath = computed(() => (entity.value ? pathFor(entity.value) : ''));

onMounted(async () => {
  void refreshPolicy();

  try {
    entity.value = await getEntity<Entity>(String(route.params.id));
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load entity';
  } finally {
    isLoading.value = false;
  }
});

/**
 * Fields beyond the shared ones are type-specific and stored in metadata, so
 * they are rendered generically rather than with a branch per entity type.
 */
const BASE_FIELDS = new Set([
  'id',
  'type',
  'memoryLayer',
  'title',
  'content',
  'embedding',
  'links',
  'tags',
  'createdAt',
  'updatedAt',
]);

const extraFields = computed(() => {
  if (!entity.value) return [];

  return Object.entries(entity.value)
    .filter(([key, value]) => !BASE_FIELDS.has(key) && value !== undefined)
    .map(([key, value]) => ({
      key,
      label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
      value: value instanceof Date ? value.toLocaleString() : String(value),
    }));
});

async function remove() {
  if (!entity.value) return;

  isDeleting.value = true;
  try {
    await deleteEntity(entity.value.id);
    await router.push('/entities');
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to delete entity';
    isDeleting.value = false;
  }
}
</script>

<template>
  <div class="p-8 max-w-3xl">
    <div v-if="isLoading" class="flex justify-center py-12">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>

    <template v-else-if="entity">
      <header class="mb-8">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800">
            {{ labelFor(entity.type) }}
          </span>
          <span
            class="text-xs px-2 py-1 rounded"
            :class="layerClass(entity.memoryLayer)"
          >
            {{ layerLabel(entity.memoryLayer) }} memory
          </span>
        </div>

        <h1 class="text-3xl font-bold">{{ entity.title }}</h1>
        <p class="text-sm text-[var(--color-muted)] mt-1">
          Created {{ new Date(entity.createdAt).toLocaleString() }} ·
          Updated {{ new Date(entity.updatedAt).toLocaleString() }}
        </p>
      </header>

      <section v-if="entity.content" class="card p-4 mb-6">
        <p class="whitespace-pre-wrap">{{ entity.content }}</p>
      </section>

      <section v-if="extraFields.length" class="card p-4 mb-6">
        <h2 class="text-sm font-semibold mb-3">Details</h2>
        <dl class="space-y-2">
          <div v-for="field in extraFields" :key="field.key" class="flex gap-4">
            <dt class="w-40 shrink-0 text-sm text-[var(--color-muted)]">
              {{ field.label }}
            </dt>
            <dd class="text-sm break-words">{{ field.value }}</dd>
          </div>
        </dl>
      </section>

      <section v-if="entity.tags?.length" class="mb-6 flex flex-wrap gap-1">
        <span
          v-for="tag in entity.tags"
          :key="tag"
          class="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800"
        >
          {{ tag }}
        </span>
      </section>

      <section v-if="entity.links?.length" class="card p-4 mb-6">
        <h2 class="text-sm font-semibold mb-3">
          Linked memories ({{ entity.links.length }})
        </h2>
        <ul class="space-y-1">
          <li v-for="link in entity.links" :key="link.targetId">
            <NuxtLink
              :to="`/entities/${link.targetId}`"
              class="text-blue-600 hover:underline text-sm"
            >
              {{ link.relationship }} → {{ link.targetType }}
            </NuxtLink>
          </li>
        </ul>
      </section>

      <p v-if="error" class="text-red-600 mb-4">{{ error }}</p>

      <p
        v-if="!canEdit"
        class="text-sm text-[var(--color-muted)] mb-4 p-3 rounded-lg border border-[var(--color-border)]"
      >
        You do not own <span class="font-mono">{{ documentPath }}</span>. You can
        still change it — your edits are sent to whoever does, as a change
        request, rather than applied directly.
      </p>

      <div class="flex gap-4">
        <NuxtLink to="/entities" class="btn-secondary">Back</NuxtLink>

        <button
          v-if="!confirmingDelete"
          type="button"
          class="btn bg-red-50 text-red-700 hover:bg-red-100"
          @click="confirmingDelete = true"
        >
          Delete
        </button>

        <template v-else>
          <button
            type="button"
            class="btn bg-red-600 text-white hover:bg-red-700"
            :disabled="isDeleting"
            @click="remove"
          >
            {{ isDeleting ? 'Deleting...' : 'Confirm delete' }}
          </button>
          <button
            type="button"
            class="btn-secondary"
            @click="confirmingDelete = false"
          >
            Keep
          </button>
        </template>
      </div>
    </template>

    <div v-else class="text-center py-12">
      <p class="text-[var(--color-muted)] mb-4">
        {{ error ?? 'That memory does not exist.' }}
      </p>
      <NuxtLink to="/entities" class="btn-secondary">Back to entities</NuxtLink>
    </div>
  </div>
</template>
