/**
 * Shared Gemini embedding config used by embed-item AND find-outfit.
 *
 * CRITICAL: query vectors (find-outfit) and stored vectors (embed-item) MUST
 * use the exact same model, outputDimensionality, and normalisation — or
 * cosine distances returned by match_items will be meaningless.
 *
 * If you ever change any constant here, redeploy BOTH functions and re-run
 * the backfill script to rebuild all stored vectors.
 */

export const GEMINI_MODEL = "gemini-embedding-001";
export const EMBED_DIMS   = 768; // Matryoshka truncation from 3072-dim model.
                                 // Must match items.embedding vector(768).

/** L2-normalise a vector to unit length. */
export function l2normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return norm === 0 ? vec : vec.map((v) => v / norm);
}

/**
 * Embed a single text string and return a 768-dim L2-normalised vector.
 * Throws on any API or dimension error — let the caller handle it.
 */
export async function embedText(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:embedContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // AQ-format Gemini keys require header auth — ?key= query-param
        // only works with legacy AIza-format keys.
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model: `models/${GEMINI_MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: EMBED_DIMS,
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API ${res.status}: ${body}`);
  }

  const { embedding: { values } } = await res.json() as {
    embedding: { values: number[] };
  };

  if (!Array.isArray(values) || values.length !== EMBED_DIMS) {
    throw new Error(`Unexpected embedding dimensions: ${values?.length}`);
  }

  // The API returns L2-normalised values at reduced dims, but we normalise
  // again defensively to guarantee unit-length after any floating-point drift.
  return l2normalize(values);
}
