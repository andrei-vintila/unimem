<script setup lang="ts">
const { toReview, mine, isLoading, error, refresh, review } = useChangeRequests();
const { isConfigured } = useSyncSettings();

const busy = ref<string | null>(null);
const failure = ref<string | null>(null);

async function decide(id: string, action: 'accept' | 'decline') {
  busy.value = id;
  failure.value = null;
  try {
    await review(id, action);
  } catch (cause) {
    failure.value = (cause as Error).message;
  } finally {
    busy.value = null;
  }
}

const openMine = computed(() => mine.value.filter((r) => r.status === 'open'));
const decidedMine = computed(() => mine.value.filter((r) => r.status !== 'open'));

function when(iso: string) {
  return new Date(iso).toLocaleString();
}

onMounted(refresh);
</script>

<template>
  <section v-if="isConfigured" class="mb-8">
    <div class="flex items-baseline justify-between mb-4">
      <h2 class="text-xl font-semibold">Change requests</h2>
      <button
        type="button"
        class="text-sm text-[var(--color-muted)] hover:underline"
        :disabled="isLoading"
        @click="refresh"
      >
        {{ isLoading ? 'Refreshing…' : 'Refresh' }}
      </button>
    </div>

    <div class="card p-4">
      <p class="text-sm text-[var(--color-muted)] mb-4">
        A change to a folder you cannot write is kept as a proposal rather than
        discarded. Whoever can write there decides.
      </p>

      <p v-if="error" class="text-sm text-red-600 mb-4">
        Could not load: {{ error }}
      </p>
      <p v-if="failure" class="text-sm text-red-600 mb-4">{{ failure }}</p>

      <!-- Waiting on you -->
      <h3 class="text-sm font-medium mb-2">Waiting on you</h3>
      <p v-if="toReview.length === 0" class="text-sm text-[var(--color-muted)] mb-4">
        Nothing to review.
      </p>
      <ul v-else class="space-y-3 mb-6">
        <li
          v-for="request in toReview"
          :key="request.id"
          class="border border-[var(--color-border)] rounded-lg p-3"
        >
          <p class="text-sm font-medium">{{ request.title }}</p>
          <p class="text-sm text-[var(--color-muted)]">
            {{ request.proposedBy }} · {{ when(request.proposedAt) }}
          </p>
          <p class="text-sm font-mono break-all text-[var(--color-muted)] mt-1">
            {{ request.path }}
          </p>
          <div class="flex gap-2 mt-3">
            <button
              type="button"
              class="btn-secondary text-sm"
              :disabled="busy === request.id"
              @click="decide(request.id, 'accept')"
            >
              {{ busy === request.id ? 'Working…' : 'Accept' }}
            </button>
            <button
              type="button"
              class="btn-secondary text-sm"
              :disabled="busy === request.id"
              @click="decide(request.id, 'decline')"
            >
              Decline
            </button>
          </div>
        </li>
      </ul>

      <!-- Yours -->
      <h3 class="text-sm font-medium mb-2 pt-4 border-t border-[var(--color-border)]">
        Yours
      </h3>
      <p
        v-if="openMine.length === 0 && decidedMine.length === 0"
        class="text-sm text-[var(--color-muted)]"
      >
        You have not proposed anything.
      </p>
      <ul class="space-y-2">
        <li v-for="request in openMine" :key="request.id" class="text-sm">
          <span class="font-medium">{{ request.title }}</span>
          <span class="text-[var(--color-muted)]"> — waiting · {{ request.reason }}</span>
        </li>
        <li
          v-for="request in decidedMine"
          :key="request.id"
          class="text-sm text-[var(--color-muted)]"
        >
          <span class="font-medium">{{ request.title }}</span>
          — {{ request.status }}<span v-if="request.reviewedBy"> by {{ request.reviewedBy }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>
