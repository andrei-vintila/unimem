import type { EntityType, MemoryLayerType } from '@unimem/types';

/**
 * Presentation metadata for the entity types.
 *
 * Deliberately does *not* map a type to its memory layer - that mapping is
 * cognitive architecture, not presentation, and lives on the engine
 * (`getLayerForEntityType`). Duplicating it here would let the UI and the
 * storage layer disagree about which layer a note belongs to.
 */
export interface EntityTypeMeta {
  type: EntityType;
  label: string;
  description: string;
}

export const ENTITY_TYPES: readonly EntityTypeMeta[] = [
  { type: 'daily-note', label: 'Daily Note', description: 'A day of working memory' },
  { type: 'person', label: 'Person', description: 'Someone you interact with' },
  { type: 'company', label: 'Company', description: 'An organization' },
  { type: 'project', label: 'Project', description: 'Ongoing work with a timeline' },
  { type: 'task', label: 'Task', description: 'Something to be done' },
  { type: 'area', label: 'Area', description: 'A domain you maintain' },
  { type: 'resource', label: 'Resource', description: 'Reference material' },
] as const;

const LAYER_LABELS: Record<MemoryLayerType, string> = {
  working: 'Working',
  episodic: 'Episodic',
  semantic: 'Semantic',
  procedural: 'Procedural',
};

/** Tailwind classes per layer; keys match the palette in tailwind.config.ts. */
const LAYER_CLASSES: Record<MemoryLayerType, string> = {
  working: 'bg-working-50 text-working-600',
  episodic: 'bg-episodic-50 text-episodic-600',
  semantic: 'bg-semantic-50 text-semantic-600',
  procedural: 'bg-procedural-50 text-procedural-600',
};

export function useEntityTypes() {
  const { getEngine } = useMemory();

  function labelFor(type: EntityType): string {
    return ENTITY_TYPES.find((t) => t.type === type)?.label ?? type;
  }

  function layerFor(type: EntityType): MemoryLayerType {
    return getEngine().getLayerForEntityType(type);
  }

  function layerLabel(layer: MemoryLayerType): string {
    return LAYER_LABELS[layer];
  }

  function layerClass(layer: MemoryLayerType): string {
    return LAYER_CLASSES[layer];
  }

  return { ENTITY_TYPES, labelFor, layerFor, layerLabel, layerClass };
}
