// =============================================================================
// Unimem Analytics - Event Catalog
// =============================================================================
//
// This file is the single source of truth for every event Unimem may emit.
//
// PRIVACY CONTRACT
// ----------------
// Unimem stores private notes. Entity titles, note content, search queries,
// tags, vault names and filesystem paths must NEVER leave the device.
//
// To make that structural rather than aspirational, every string-typed
// property below is a *literal union* - a closed set of values known at
// compile time. The only exceptions are `version` (a semver string) and
// values bounded by `ErrorCode`, both of which are enumerable by us.
//
// If you find yourself wanting to add `title: string` or `query: string`,
// the answer is a count, a bucket, or a boolean instead.
// =============================================================================

import type { EntityType, MemoryLayerType } from '@unimem/types';

// -----------------------------------------------------------------------------
// Shared Enums
// -----------------------------------------------------------------------------

/** Which Unimem client produced the event. Attached automatically as a super property. */
export type Surface = 'web' | 'desktop' | 'obsidian' | 'server';

/**
 * Bounded error identifiers. Raw error messages are forbidden - they routinely
 * embed filesystem paths, note titles and stack frames.
 */
export type ErrorCode =
  | 'network'
  | 'timeout'
  | 'auth'
  | 'storage-init'
  | 'storage-quota'
  | 'vector-unavailable'
  | 'embedding-provider'
  | 'conflict'
  | 'rate-limited'
  | 'unknown';

/** How an entity came to exist. */
export type CreationMethod = 'manual' | 'template' | 'auto-detected' | 'import';

/** Which retrieval path served a search. */
export type SearchType = 'vector' | 'keyword' | 'hybrid';

/** What kicked off a background operation. */
export type Trigger = 'manual' | 'scheduled' | 'startup';

export type SyncDirection = 'push' | 'pull';

/** Where in the sync pipeline a failure occurred. */
export type SyncStage = 'auth' | 'request' | 'conflict-resolution' | 'apply' | 'network';

/** Named features, for coarse "is anyone using this?" measurement. */
export type Feature =
  | 'daily-note'
  | 'entity-detection'
  | 'consolidation'
  | 'search'
  | 'graph-view'
  | 'sync'
  | 'export';

/**
 * Settings whose changes are worth knowing about. String-valued settings are
 * included by key only - see the note on `setting_changed` below.
 */
export type SettingKey =
  | 'auto-create-entities'
  | 'enable-consolidation'
  | 'enable-telemetry'
  | 'sync-enabled'
  | 'embedding-provider'
  | 'folder-layout';

/** Feature flags resolved through PostHog. */
export type FeatureFlag =
  | 'sync-server-enabled'
  | 'consolidation-v2'
  | 'vector-search'
  | 'error-tracking';

// -----------------------------------------------------------------------------
// Event Catalog
// -----------------------------------------------------------------------------
//
// `surface`, `app_version` and `platform` are attached automatically by each
// adapter as super properties. Do not repeat them here.

export type UnimemEvent =
  // --- Activation ---------------------------------------------------------
  | {
      name: 'app_installed';
      properties: {
        version: string;
      };
    }
  | {
      name: 'session_started';
      properties: {
        days_since_install: number;
      };
    }
  | {
      name: 'memory_initialized';
      properties: {
        duration_ms: number;
        success: boolean;
        error_code?: ErrorCode;
      };
    }
  | {
      name: 'entity_created';
      properties: {
        entity_type: EntityType;
        memory_layer: MemoryLayerType;
        creation_method: CreationMethod;
      };
    }
  | {
      name: 'search_performed';
      properties: {
        result_count: number;
        duration_ms: number;
        has_results: boolean;
        search_type: SearchType;
      };
    }
  | {
      name: 'consolidation_run';
      properties: {
        entities_processed: number;
        duration_ms: number;
        trigger: Trigger;
      };
    }

  | {
      /**
       * Server-side embedding proxy. `text_count` is how many strings were
       * submitted - never their length, which correlates with note size, and
       * obviously never the text.
       */
      name: 'embedding_requested';
      properties: {
        text_count: number;
        duration_ms: number;
        success: boolean;
        error_code?: ErrorCode;
      };
    }

  // --- Sync health --------------------------------------------------------
  | {
      name: 'sync_started';
      properties: {
        direction: SyncDirection;
        entity_count: number;
      };
    }
  | {
      name: 'sync_completed';
      properties: {
        direction: SyncDirection;
        entity_count: number;
        duration_ms: number;
        conflict_count: number;
      };
    }
  | {
      name: 'sync_failed';
      properties: {
        direction: SyncDirection;
        error_code: ErrorCode;
        stage: SyncStage;
      };
    }

  // --- Retention ----------------------------------------------------------
  | {
      name: 'feature_used';
      properties: {
        feature: Feature;
      };
    }
  | {
      /**
       * `new_value` is deliberately `boolean | number | null`. Several settings
       * hold folder names (see the Obsidian plugin's folder settings), and a
       * folder name is user data - it is frequently a person's real name or
       * employer. String-valued settings report `null` plus `is_default`.
       */
      name: 'setting_changed';
      properties: {
        setting_key: SettingKey;
        new_value: boolean | number | null;
        is_default: boolean;
      };
    };

export type UnimemEventName = UnimemEvent['name'];

/** Narrow the catalog to a single event's property shape. */
export type PropertiesOf<N extends UnimemEventName> = Extract<
  UnimemEvent,
  { name: N }
>['properties'];

// -----------------------------------------------------------------------------
// Person Properties
// -----------------------------------------------------------------------------

/**
 * Attached to identified users only. Kept intentionally thin - there is no
 * account system yet (see apps/server/utils/auth.ts).
 */
export interface PersonProps {
  surfaces_used?: number;
  days_since_install?: number;
  entity_count_bucket?: '0' | '1-10' | '11-100' | '101-1000' | '1000+';
}

/** Bucket a raw count so exact vault sizes are not fingerprintable. */
export function bucketEntityCount(count: number): NonNullable<PersonProps['entity_count_bucket']> {
  if (count <= 0) return '0';
  if (count <= 10) return '1-10';
  if (count <= 100) return '11-100';
  if (count <= 1000) return '101-1000';
  return '1000+';
}
