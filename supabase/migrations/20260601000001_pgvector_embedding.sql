-- ============================================================
-- pgvector: extension + embedding column + HNSW index
-- ============================================================

-- Extension lives in the extensions schema (Supabase default).
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Add embedding column (768 dims = Gemini text-embedding-004 output).
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS embedding extensions.vector(768);

-- HNSW index with cosine distance for ANN search.
-- m=16 (connections per node) and ef_construction=64 are the
-- pgvector defaults and work well for a small-to-mid wardrobe.
CREATE INDEX IF NOT EXISTS items_embedding_hnsw_idx
  ON public.items
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
