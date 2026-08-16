// =============================================================================
// Change requests
// =============================================================================
//
// A write into a folder you cannot write is kept by the server as a proposal
// rather than thrown away, and anyone who can write there decides. This is the
// client's view of both halves: what is waiting on you, and what you are
// waiting on.

export interface ChangeRequestSummary {
  id: string;
  entityId: string;
  path: string;
  title: string;
  proposedBy: string;
  proposedAt: string;
  status: 'open' | 'accepted' | 'declined';
  reason: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

const toReview = ref<ChangeRequestSummary[]>([]);
const mine = ref<ChangeRequestSummary[]>([]);
const isLoading = ref(false);
const error = ref<string | null>(null);

export function useChangeRequests() {
  const settings = useSyncSettings();

  function headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${settings.authToken.value}`,
      'Content-Type': 'application/json',
    };
  }

  async function refresh(): Promise<void> {
    if (!settings.isConfigured.value) {
      toReview.value = [];
      mine.value = [];
      return;
    }

    isLoading.value = true;
    error.value = null;

    try {
      const response = await fetch(`${settings.serverUrl.value}/api/vault/requests`, {
        headers: headers(),
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      const result = (await response.json()) as {
        toReview: ChangeRequestSummary[];
        mine: ChangeRequestSummary[];
      };
      toReview.value = result.toReview;
      mine.value = result.mine;
    } catch (cause) {
      error.value = (cause as Error).message;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Accept or decline, then sync.
   *
   * An accepted proposal becomes an ordinary write on the server, so it
   * reaches this device the same way any other change does - by being pulled.
   */
  async function review(id: string, action: 'accept' | 'decline'): Promise<void> {
    const response = await fetch(`${settings.serverUrl.value}/api/vault/requests`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ id, action }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? `${response.status} ${response.statusText}`);
    }

    await refresh();
    await useSync().syncNow();
  }

  return {
    toReview: readonly(toReview),
    mine: readonly(mine),
    isLoading: readonly(isLoading),
    error: readonly(error),
    refresh,
    review,
  };
}
