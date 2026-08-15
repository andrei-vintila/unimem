import { createError, defineEventHandler, readBody } from 'h3';
import { useRuntimeConfig } from 'nitro/runtime-config';

import { toErrorCode, trackEvents } from '~/utils/analytics';
import { getAuthToken } from '~/utils/auth';

// Embedding endpoint - proxies to OpenAI
interface EmbedRequest {
  texts: string[];
}

interface EmbedResponse {
  embeddings: number[][];
  dimensions: number;
}

export default defineEventHandler(async (event): Promise<EmbedResponse> => {
  const startedAt = Date.now();
  const body = await readBody<EmbedRequest>(event);
  const config = useRuntimeConfig();

  // No account system yet, so the bearer token is the only stable actor here.
  // `trackEvents` hashes it before anything leaves the Worker.
  const actor = getAuthToken(event) ?? 'anonymous';

  // h3 v2 resolves `readBody` to `T | undefined` - a request with no body at
  // all reaches here as undefined, and used to fault on the property access
  // below and surface as a 500 instead of this 400.
  if (!body?.texts || body.texts.length === 0) {
    throw createError({
      statusCode: 400,
      message: 'texts array is required',
    });
  }

  if (!config.openaiApiKey) {
    throw createError({
      statusCode: 500,
      message: 'OpenAI API key not configured',
    });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: body.texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw createError({
        statusCode: response.status,
        message: `OpenAI API error: ${error}`,
      });
    }

    const data = await response.json();
    const embeddings = data.data.map(
      (item: { embedding: number[] }) => item.embedding
    );

    trackEvents(event, actor, {
      name: 'embedding_requested',
      properties: {
        text_count: body.texts.length,
        duration_ms: Math.round(Date.now() - startedAt),
        success: true,
      },
    });

    return {
      embeddings,
      dimensions: embeddings[0]?.length ?? 0,
    };
  } catch (error) {
    console.error('Embedding error:', error);

    trackEvents(event, actor, {
      name: 'embedding_requested',
      properties: {
        text_count: body.texts.length,
        duration_ms: Math.round(Date.now() - startedAt),
        success: false,
        error_code: toErrorCode(error),
      },
    });

    throw createError({
      statusCode: 500,
      message: 'Failed to generate embeddings',
    });
  }
});
