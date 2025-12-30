import { defineStore } from 'pinia';
import type { Entity, MemoryStats, EntityFilter } from '@unimem/types';

interface MemoryState {
  entities: Map<string, Entity>;
  stats: MemoryStats | null;
  isLoading: boolean;
  error: string | null;
}

export const useMemoryStore = defineStore('memory', {
  state: (): MemoryState => ({
    entities: new Map(),
    stats: null,
    isLoading: false,
    error: null,
  }),

  getters: {
    allEntities: (state) => Array.from(state.entities.values()),

    entitiesByType: (state) => (type: Entity['type']) =>
      Array.from(state.entities.values()).filter((e) => e.type === type),

    entitiesByLayer: (state) => (layer: Entity['memoryLayer']) =>
      Array.from(state.entities.values()).filter((e) => e.memoryLayer === layer),

    recentEntities: (state) =>
      Array.from(state.entities.values())
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, 10),
  },

  actions: {
    setEntity(entity: Entity) {
      this.entities.set(entity.id, entity);
    },

    removeEntity(id: string) {
      this.entities.delete(id);
    },

    setStats(stats: MemoryStats) {
      this.stats = stats;
    },

    setLoading(loading: boolean) {
      this.isLoading = loading;
    },

    setError(error: string | null) {
      this.error = error;
    },

    clearEntities() {
      this.entities.clear();
    },
  },
});
