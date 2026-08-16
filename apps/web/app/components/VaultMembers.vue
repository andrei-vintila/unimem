<script setup lang="ts">
import type { Invitation } from '~/composables/useVaultMembers';

const { members, you, isOwner, isLoading, error, refresh, invite, revoke } =
  useVaultMembers();
const { isConfigured } = useSyncSettings();

const actor = ref('');
const writeGrants = ref('');
const readGrants = ref('');
const busy = ref(false);
const failure = ref<string | null>(null);

/**
 * The token, shown once. The server keeps only a hash, so navigating away
 * without copying it means minting a new one.
 */
const issued = ref<Invitation | null>(null);
const copied = ref(false);

const canInvite = computed(() => actor.value.trim().length > 0 && !busy.value);

async function submit() {
  busy.value = true;
  failure.value = null;
  copied.value = false;

  try {
    const name = actor.value.trim();
    issued.value = await invite({
      // Actors follow OKF's convention, so a bare name becomes `human:name`
      // rather than something no other tool would recognise.
      actor: name.includes(':') ? name : `human:${name}`,
      write: parseGrants(writeGrants.value),
      read: parseGrants(readGrants.value),
    });
    actor.value = '';
    writeGrants.value = '';
    readGrants.value = '';
  } catch (cause) {
    failure.value = (cause as Error).message;
  } finally {
    busy.value = false;
  }
}

async function remove(who: string) {
  busy.value = true;
  failure.value = null;
  try {
    await revoke(who);
  } catch (cause) {
    failure.value = (cause as Error).message;
  } finally {
    busy.value = false;
  }
}

async function copyToken() {
  if (!issued.value) return;
  try {
    await navigator.clipboard.writeText(issued.value.token);
    copied.value = true;
  } catch {
    // Clipboard access can be refused; the field is selectable either way.
    copied.value = false;
  }
}

onMounted(refresh);
</script>

<template>
  <section v-if="isConfigured" class="mb-8">
    <div class="flex items-baseline justify-between mb-4">
      <h2 class="text-xl font-semibold">People</h2>
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
      <p v-if="error" class="text-sm text-red-600 mb-4">Could not load: {{ error }}</p>
      <p v-if="failure" class="text-sm text-red-600 mb-4">{{ failure }}</p>

      <!-- Who you are -->
      <dl v-if="you" class="space-y-3 mb-6">
        <div class="flex gap-4">
          <dt class="w-40 shrink-0 text-sm text-[var(--color-muted)]">You</dt>
          <dd class="text-sm">
            <span class="font-mono">{{ you.actor }}</span>
            <span class="text-[var(--color-muted)]"> · {{ you.role }}</span>
          </dd>
        </div>
        <div class="flex gap-4">
          <dt class="w-40 shrink-0 text-sm text-[var(--color-muted)]">You can edit</dt>
          <dd class="text-sm font-mono break-all">{{ describeGrants(you.write) }}</dd>
        </div>
        <div class="flex gap-4">
          <dt class="w-40 shrink-0 text-sm text-[var(--color-muted)]">You can see</dt>
          <dd class="text-sm font-mono break-all">{{ describeGrants(you.read) }}</dd>
        </div>
      </dl>

      <!-- Everyone -->
      <h3 class="text-sm font-medium mb-2 pt-4 border-t border-[var(--color-border)]">
        In this vault
      </h3>
      <ul class="space-y-2 mb-6">
        <li
          v-for="member in members"
          :key="member.actor"
          class="flex items-start justify-between gap-4"
        >
          <div class="text-sm">
            <span class="font-mono">{{ member.actor }}</span>
            <span class="text-[var(--color-muted)]"> · {{ member.role }}</span>
            <p v-if="isOwner" class="text-[var(--color-muted)] font-mono break-all">
              edits {{ describeGrants(member.write) }} · sees
              {{ describeGrants(member.read) }}
            </p>
          </div>
          <button
            v-if="isOwner && member.role !== 'owner'"
            type="button"
            class="text-sm text-red-700 hover:underline shrink-0"
            :disabled="busy"
            @click="remove(member.actor)"
          >
            Revoke
          </button>
        </li>
      </ul>

      <!-- Invite -->
      <template v-if="isOwner">
        <h3 class="text-sm font-medium mb-2 pt-4 border-t border-[var(--color-border)]">
          Invite someone
        </h3>
        <p class="text-sm text-[var(--color-muted)] mb-3">
          Folders, comma separated — <span class="font-mono">project/</span> covers
          every project. Leave editing empty for someone who can read and propose
          changes but not make them.
        </p>

        <form class="space-y-3" @submit.prevent="submit">
          <div>
            <label for="member-actor" class="block text-sm font-medium mb-1">Name</label>
            <input
              id="member-actor"
              v-model="actor"
              type="text"
              autocomplete="off"
              placeholder="sam"
              class="w-full text-sm rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2"
            >
          </div>
          <div>
            <label for="member-write" class="block text-sm font-medium mb-1">Can edit</label>
            <input
              id="member-write"
              v-model="writeGrants"
              type="text"
              autocomplete="off"
              placeholder="project/, task/"
              class="w-full text-sm font-mono rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2"
            >
          </div>
          <div>
            <label for="member-read" class="block text-sm font-medium mb-1">Can also see</label>
            <input
              id="member-read"
              v-model="readGrants"
              type="text"
              autocomplete="off"
              placeholder="person/"
              class="w-full text-sm font-mono rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2"
            >
          </div>
          <button type="submit" class="btn-secondary text-sm" :disabled="!canInvite">
            {{ busy ? 'Working…' : 'Create token' }}
          </button>
        </form>

        <!-- The one sighting of the token -->
        <div
          v-if="issued"
          class="mt-4 p-3 rounded-lg border border-[var(--color-border)]"
        >
          <p class="text-sm font-medium">Token for {{ issued.actor }}</p>
          <p class="text-sm text-[var(--color-muted)] mt-1">
            Copy it now — only a hash is stored, so this cannot be shown again.
            Send it to them the way you would a password.
          </p>
          <div class="flex gap-2 mt-2">
            <input
              :value="issued.token"
              readonly
              class="flex-1 text-sm font-mono rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2"
              @focus="(event) => (event.target as HTMLInputElement).select()"
            >
            <button type="button" class="btn-secondary text-sm" @click="copyToken">
              {{ copied ? 'Copied' : 'Copy' }}
            </button>
          </div>
          <button
            type="button"
            class="text-sm text-[var(--color-muted)] hover:underline mt-2"
            @click="issued = null"
          >
            Done
          </button>
        </div>
      </template>

      <p v-else class="text-sm text-[var(--color-muted)]">
        Only the vault owner can invite or revoke people.
      </p>
    </div>
  </section>
</template>
