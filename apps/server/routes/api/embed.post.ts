// Embedding endpoint - proxies to OpenAI
interface EmbedRequest {
  texts: string[];
}

interface EmbedResponse {
  embeddings: number[][];
  dimensions: number;
}

export default defineEventHandler(async (event): Promise<EmbedResponse> => {
  const body = await readBody<EmbedRequest>(event);
  const config = useRuntimeConfig();

  if (!body.texts || body.texts.length === 0) {
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

    return {
      embeddings,
      dimensions: embeddings[0]?.length ?? 0,
    };
  } catch (error) {
    console.error('Embedding error:', error);
    throw createError({
      statusCode: 500,
      message: 'Failed to generate embeddings',
    });
  }
});
