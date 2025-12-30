// =============================================================================
// Embedding Providers - Vector embedding generation
// =============================================================================

import type { EmbeddingProvider } from './memory-engine';

// -----------------------------------------------------------------------------
// Embedding Provider Factory
// -----------------------------------------------------------------------------

export type EmbeddingProviderType = 'openai' | 'local' | 'mock';

export interface EmbeddingProviderConfig {
  type: EmbeddingProviderType;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export function createEmbeddingProvider(
  config: EmbeddingProviderConfig
): EmbeddingProvider {
  switch (config.type) {
    case 'openai':
      return new OpenAIEmbeddingProvider(config);
    case 'local':
      return new LocalEmbeddingProvider(config);
    case 'mock':
      return new MockEmbeddingProvider();
    default:
      throw new Error(`Unknown embedding provider type: ${config.type}`);
  }
}

// -----------------------------------------------------------------------------
// OpenAI Embedding Provider
// -----------------------------------------------------------------------------

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private dimensions: number;

  constructor(config: EmbeddingProviderConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    this.apiKey = config.apiKey;
    this.model = config.model ?? 'text-embedding-3-small';
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';

    // Dimensions based on model
    this.dimensions = this.model.includes('3-large') ? 3072 : 1536;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding failed: ${error}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI batch embedding failed: ${error}`);
    }

    const data = await response.json();
    return data.data.map((item: { embedding: number[] }) => item.embedding);
  }

  getDimensions(): number {
    return this.dimensions;
  }
}

// -----------------------------------------------------------------------------
// Local Embedding Provider (Placeholder for ONNX/Transformers.js)
// -----------------------------------------------------------------------------

export class LocalEmbeddingProvider implements EmbeddingProvider {
  private dimensions: number;

  constructor(_config: EmbeddingProviderConfig) {
    // TODO: Initialize local model (e.g., via transformers.js or ONNX runtime)
    this.dimensions = 384; // all-MiniLM-L6-v2 default
  }

  async embed(_text: string): Promise<number[]> {
    // TODO: Implement local embedding
    // This would use transformers.js or similar for browser-compatible embedding
    throw new Error('Local embedding not yet implemented');
  }

  async embedBatch(_texts: string[]): Promise<number[][]> {
    throw new Error('Local embedding not yet implemented');
  }

  getDimensions(): number {
    return this.dimensions;
  }
}

// -----------------------------------------------------------------------------
// Mock Embedding Provider (For Testing)
// -----------------------------------------------------------------------------

export class MockEmbeddingProvider implements EmbeddingProvider {
  private dimensions = 384;

  async embed(text: string): Promise<number[]> {
    // Generate deterministic mock embedding based on text hash
    const hash = this.simpleHash(text);
    return this.generateFromSeed(hash);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }

  getDimensions(): number {
    return this.dimensions;
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private generateFromSeed(seed: number): number[] {
    const embedding: number[] = [];
    let current = seed;

    for (let i = 0; i < this.dimensions; i++) {
      // Simple PRNG
      current = (current * 1103515245 + 12345) & 0x7fffffff;
      // Normalize to [-1, 1]
      embedding.push((current / 0x7fffffff) * 2 - 1);
    }

    // Normalize to unit vector
    const magnitude = Math.sqrt(
      embedding.reduce((sum, val) => sum + val * val, 0)
    );
    return embedding.map((val) => val / magnitude);
  }
}
