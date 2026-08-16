<script setup lang="ts">
import type {
  Area,
  Company,
  DailyNote,
  Entity,
  EntityType,
  Person,
  Project,
  Resource,
  Task,
} from '@unimem/types';

definePageMeta({
  title: 'New Entity',
});

const { createEntity, getEngine } = useMemory();
const { canWriteEntity, pathFor, refresh: refreshPolicy } = usePolicy();
const { ENTITY_TYPES, layerFor, layerLabel, layerClass } = useEntityTypes();
const route = useRoute();
const router = useRouter();

/** `/entities/new?type=task` preselects, so the dashboard can deep-link. */
const initialType = ENTITY_TYPES.some((t) => t.type === route.query.type)
  ? (route.query.type as EntityType)
  : 'person';

const type = ref<EntityType>(initialType);
const title = ref('');

/**
 * Where this will land, and whether it lands directly.
 *
 * The folder follows the type, so someone can see before they start writing
 * that a person goes somewhere they do not own - rather than discovering it
 * when the note turns into a change request.
 */
const destination = computed(() => pathFor({ type: type.value, title: title.value }));
const willBeProposed = computed(
  () => !canWriteEntity({ type: type.value, title: title.value })
);

onMounted(() => {
  void refreshPolicy();
});
const content = ref('');
const tagInput = ref('');

// Type-specific fields. Each is only read for the type that declares it, so
// switching types leaves the others harmlessly populated.
const date = ref(new Date().toISOString().slice(0, 10));
const scope = ref('');
const resourceType = ref<Resource['resourceType']>('reference');
const sourceUrl = ref('');
const projectStatus = ref<Project['status']>('active');
const taskStatus = ref<Task['status']>('todo');
const taskPriority = ref<Task['priority']>('medium');
const email = ref('');
const company = ref('');
const role = ref('');
const industry = ref('');
const website = ref('');

const isSaving = ref(false);
const error = ref<string | null>(null);

const tags = computed(() =>
  tagInput.value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
);

const canSave = computed(() => {
  if (!title.value.trim() || isSaving.value) return false;
  if (type.value === 'area' && !scope.value.trim()) return false;
  return true;
});

/**
 * Built per type rather than by spreading one loose object: `Entity` is a
 * discriminated union whose members each require different fields, and a single
 * `createEntity<Entity>` call would only accept the fields common to all of
 * them - silently dropping a Task's priority or an Area's scope.
 */
async function create(): Promise<Entity> {
  const base = {
    title: title.value.trim(),
    content: content.value.trim(),
    links: [],
    tags: tags.value,
  };
  const memoryLayer = getEngine().getLayerForEntityType(type.value);

  switch (type.value) {
    case 'daily-note':
      return createEntity<DailyNote>({
        ...base,
        type: 'daily-note',
        memoryLayer,
        date: date.value,
      });

    case 'person':
      return createEntity<Person>({
        ...base,
        type: 'person',
        memoryLayer,
        ...(email.value.trim() ? { email: email.value.trim() } : {}),
        ...(company.value.trim() ? { company: company.value.trim() } : {}),
        ...(role.value.trim() ? { role: role.value.trim() } : {}),
      });

    case 'company':
      return createEntity<Company>({
        ...base,
        type: 'company',
        memoryLayer,
        ...(industry.value.trim() ? { industry: industry.value.trim() } : {}),
        ...(website.value.trim() ? { website: website.value.trim() } : {}),
      });

    case 'project':
      return createEntity<Project>({
        ...base,
        type: 'project',
        memoryLayer,
        status: projectStatus.value,
      });

    case 'task':
      return createEntity<Task>({
        ...base,
        type: 'task',
        memoryLayer,
        status: taskStatus.value,
        priority: taskPriority.value,
      });

    case 'area':
      return createEntity<Area>({
        ...base,
        type: 'area',
        memoryLayer,
        scope: scope.value.trim(),
      });

    case 'resource':
      return createEntity<Resource>({
        ...base,
        type: 'resource',
        memoryLayer,
        resourceType: resourceType.value,
        ...(sourceUrl.value.trim() ? { sourceUrl: sourceUrl.value.trim() } : {}),
      });
  }
}

async function save() {
  if (!canSave.value) return;

  isSaving.value = true;
  error.value = null;

  try {
    const entity = await create();
    await router.push(`/entities/${entity.id}`);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to create entity';
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <div class="p-8 max-w-2xl">
    <header class="mb-8">
      <h1 class="text-3xl font-bold">New Entity</h1>
      <p class="text-[var(--color-muted)]">
        The type decides which memory layer it lands in
      </p>
    </header>

    <form class="space-y-6" @submit.prevent="save">
      <div>
        <label for="type" class="block text-sm font-medium mb-1">Type</label>
        <div class="flex items-center gap-3">
          <select id="type" v-model="type" class="input">
            <option v-for="meta in ENTITY_TYPES" :key="meta.type" :value="meta.type">
              {{ meta.label }}
            </option>
          </select>
          <span
            class="text-xs px-2 py-1 rounded whitespace-nowrap"
            :class="layerClass(layerFor(type))"
          >
            {{ layerLabel(layerFor(type)) }}
          </span>
        </div>
      </div>

      <div>
        <label for="title" class="block text-sm font-medium mb-1">Title</label>
        <input id="title" v-model="title" type="text" class="input" required>
      </div>

      <!-- Daily note -->
      <div v-if="type === 'daily-note'">
        <label for="date" class="block text-sm font-medium mb-1">Date</label>
        <input id="date" v-model="date" type="date" class="input">
      </div>

      <!-- Person -->
      <template v-if="type === 'person'">
        <div>
          <label for="email" class="block text-sm font-medium mb-1">Email</label>
          <input id="email" v-model="email" type="email" class="input">
        </div>
        <div>
          <label for="company" class="block text-sm font-medium mb-1">Company</label>
          <input id="company" v-model="company" type="text" class="input">
        </div>
        <div>
          <label for="role" class="block text-sm font-medium mb-1">Role</label>
          <input id="role" v-model="role" type="text" class="input">
        </div>
      </template>

      <!-- Company -->
      <template v-if="type === 'company'">
        <div>
          <label for="industry" class="block text-sm font-medium mb-1">Industry</label>
          <input id="industry" v-model="industry" type="text" class="input">
        </div>
        <div>
          <label for="website" class="block text-sm font-medium mb-1">Website</label>
          <input id="website" v-model="website" type="url" class="input">
        </div>
      </template>

      <!-- Project -->
      <div v-if="type === 'project'">
        <label for="projectStatus" class="block text-sm font-medium mb-1">Status</label>
        <select id="projectStatus" v-model="projectStatus" class="input">
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      <!-- Task -->
      <template v-if="type === 'task'">
        <div>
          <label for="taskStatus" class="block text-sm font-medium mb-1">Status</label>
          <select id="taskStatus" v-model="taskStatus" class="input">
            <option value="todo">To do</option>
            <option value="in-progress">In progress</option>
            <option value="done">Done</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div>
          <label for="taskPriority" class="block text-sm font-medium mb-1">Priority</label>
          <select id="taskPriority" v-model="taskPriority" class="input">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
      </template>

      <!-- Area -->
      <div v-if="type === 'area'">
        <label for="scope" class="block text-sm font-medium mb-1">Scope</label>
        <input
          id="scope"
          v-model="scope"
          type="text"
          class="input"
          placeholder="What this area covers"
          required
        >
      </div>

      <!-- Resource -->
      <template v-if="type === 'resource'">
        <div>
          <label for="resourceType" class="block text-sm font-medium mb-1">
            Resource type
          </label>
          <select id="resourceType" v-model="resourceType" class="input">
            <option value="article">Article</option>
            <option value="book">Book</option>
            <option value="video">Video</option>
            <option value="tool">Tool</option>
            <option value="reference">Reference</option>
          </select>
        </div>
        <div>
          <label for="sourceUrl" class="block text-sm font-medium mb-1">Source URL</label>
          <input id="sourceUrl" v-model="sourceUrl" type="url" class="input">
        </div>
      </template>

      <div>
        <label for="content" class="block text-sm font-medium mb-1">Content</label>
        <textarea id="content" v-model="content" rows="8" class="input" />
      </div>

      <div>
        <label for="tags" class="block text-sm font-medium mb-1">
          Tags <span class="text-[var(--color-muted)]">(comma separated)</span>
        </label>
        <input id="tags" v-model="tagInput" type="text" class="input">
      </div>

      <p
        v-if="willBeProposed"
        class="text-sm text-[var(--color-muted)] p-3 rounded-lg border border-[var(--color-border)]"
      >
        This would go to <span class="font-mono">{{ destination }}</span>, which
        you do not own — it will be sent to whoever does, as a change request.
      </p>

      <p v-if="error" class="text-red-600">{{ error }}</p>

      <div class="flex gap-4">
        <button type="submit" class="btn-primary" :disabled="!canSave">
          {{ isSaving ? 'Creating...' : willBeProposed ? 'Propose Entity' : 'Create Entity' }}
        </button>
        <NuxtLink to="/entities" class="btn-secondary">Cancel</NuxtLink>
      </div>
    </form>
  </div>
</template>
