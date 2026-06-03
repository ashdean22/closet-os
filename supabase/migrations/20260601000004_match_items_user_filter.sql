-- ============================================================
-- Update match_items to filter by user_id.
-- The old signature (vector, int) had no user scope — every
-- outfit search returned items from ALL users.
-- New signature requires filter_user_id so the RPC is always
-- user-scoped; find-outfit passes the verified caller's uid.
-- ============================================================

-- Drop the old signature first. CREATE OR REPLACE cannot change
-- the parameter list; it would create a second overload instead.
DROP FUNCTION IF EXISTS public.match_items(extensions.vector, int);

CREATE FUNCTION public.match_items(
  query_embedding  extensions.vector(768),
  filter_user_id   uuid,
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
    AND user_id = filter_user_id
  ORDER BY embedding OPERATOR(extensions.<=>) query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_items(extensions.vector, uuid, int)
  TO anon, authenticated;
