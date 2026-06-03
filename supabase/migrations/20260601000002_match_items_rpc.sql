-- ============================================================
-- match_items: cosine-similarity semantic search via pgvector
-- Called by the outfit-search flow.
-- ============================================================

CREATE OR REPLACE FUNCTION public.match_items(
  query_embedding extensions.vector(768),
  match_count      int DEFAULT 10
)
RETURNS TABLE (
  id          uuid,
  image_url   text,
  color       text,
  category    text,
  formality   text,
  season      text,
  material    text,
  description text,
  similarity  float
)
LANGUAGE sql
STABLE
-- extensions must be on the search_path so the <=> operator is visible;
-- schema-qualifying the operator below is a belt-and-suspenders guarantee.
SET search_path = public, extensions
AS $$
  SELECT
    id,
    image_url,
    color,
    category,
    formality,
    season,
    material,
    description,
    1 - (embedding OPERATOR(extensions.<=>) query_embedding) AS similarity
  FROM public.items
  WHERE embedding IS NOT NULL
  ORDER BY embedding OPERATOR(extensions.<=>) query_embedding
  LIMIT match_count;
$$;

-- Allow the anon and authenticated roles to call the RPC.
GRANT EXECUTE ON FUNCTION public.match_items(extensions.vector, int)
  TO anon, authenticated;
