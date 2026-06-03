-- ============================================================
-- find_similar_items: cosine similarity duplicate detection
-- Returns the caller's OTHER items whose embedding is within
-- `threshold` cosine similarity of the given item.
-- auth.uid() scopes results to the calling user automatically
-- (works with the anon key + user JWT via PostgREST).
-- ============================================================

CREATE OR REPLACE FUNCTION public.find_similar_items(
  item_id   uuid,
  threshold float DEFAULT 0.85,
  max_count int   DEFAULT 3
)
RETURNS TABLE (
  id         uuid,
  image_url  text,
  category   text,
  color      text,
  formality  text,
  similarity float
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT
    other.id,
    other.image_url,
    other.category,
    other.color,
    other.formality,
    1 - (other.embedding OPERATOR(extensions.<=>) target.embedding) AS similarity
  FROM public.items AS other
  -- self-join to pull the target item's embedding once
  JOIN public.items AS target
    ON target.id = item_id
  WHERE other.user_id   = auth.uid()
    AND other.id       != item_id
    AND other.embedding IS NOT NULL
    AND target.embedding IS NOT NULL
    AND 1 - (other.embedding OPERATOR(extensions.<=>) target.embedding) >= threshold
  ORDER BY other.embedding OPERATOR(extensions.<=>) target.embedding
  LIMIT max_count;
$$;

-- Only authenticated users call this; auth.uid() will be null for anon.
GRANT EXECUTE ON FUNCTION public.find_similar_items(uuid, float, int)
  TO authenticated;
