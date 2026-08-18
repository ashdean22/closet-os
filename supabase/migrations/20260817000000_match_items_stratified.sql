-- ============================================================
-- match_items_stratified: top-N nearest items PER CATEGORY.
--
-- Why this exists: match_items returns a flat top-10 across the
-- whole wardrobe. For a query like "rainy interview" the ten
-- nearest items can all be shirts, leaving the stylist with no
-- bottom and no shoes to pick from — so a "complete" outfit was
-- impossible to assemble no matter how the prompt was worded.
--
-- Partitioning by category guarantees the candidate set contains
-- the best few items for every slot the closet can actually fill,
-- and gives enough breadth (per_category > 1) to build several
-- genuinely different outfits from one retrieval pass.
--
-- exclude_ids drops items the caller has already shown the user
-- (the "refresh for something else" path) and the pinned anchor
-- item, which is added back to every outfit server-side.
-- ============================================================

CREATE OR REPLACE FUNCTION public.match_items_stratified(
  query_embedding extensions.vector(768),
  filter_user_id  uuid,
  per_category    int    DEFAULT 4,
  exclude_ids     uuid[] DEFAULT '{}'
)
RETURNS TABLE (
  id              uuid,
  image_url       text,
  color           text,
  secondary_color text,
  category        text,
  formality       text,
  season          text,
  material        text,
  description     text,
  similarity      float,
  category_rank   int
)
LANGUAGE sql
STABLE
-- extensions on the search_path so the <=> operator resolves; the
-- OPERATOR(...) qualification below is the belt-and-suspenders half.
SET search_path = public, extensions
AS $$
  SELECT
    ranked.id,
    ranked.image_url,
    ranked.color,
    ranked.secondary_color,
    ranked.category,
    ranked.formality,
    ranked.season,
    ranked.material,
    ranked.description,
    ranked.similarity,
    ranked.category_rank
  FROM (
    SELECT
      i.id,
      i.image_url,
      i.color,
      i.secondary_color,
      i.category,
      i.formality,
      i.season,
      i.material,
      i.description,
      1 - (i.embedding OPERATOR(extensions.<=>) query_embedding) AS similarity,
      -- COALESCE so rows tagged before the category enum existed (NULL
      -- category) still form their own partition instead of being dropped.
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(i.category, 'other')
        ORDER BY i.embedding OPERATOR(extensions.<=>) query_embedding
      )::int AS category_rank
    FROM public.items AS i
    WHERE i.embedding IS NOT NULL
      AND i.user_id = filter_user_id
      -- `= ANY('{}')` is false for every row, so an empty array excludes
      -- nothing. COALESCE is load-bearing: `= ANY(NULL)` evaluates to NULL,
      -- which the WHERE treats as false and would silently return zero rows if
      -- a caller ever passed null instead of an empty array.
      AND NOT (i.id = ANY(COALESCE(exclude_ids, '{}'::uuid[])))
  ) AS ranked
  WHERE ranked.category_rank <= GREATEST(per_category, 1)
  ORDER BY ranked.category, ranked.category_rank;
$$;

-- find-outfit calls this with the service-role client (RLS bypassed); user
-- scope is enforced by filter_user_id, exactly as with match_items. The
-- authenticated grant is here so the RPC stays callable from a user JWT
-- without a further migration if the client ever needs it directly.
GRANT EXECUTE ON FUNCTION public.match_items_stratified(
  extensions.vector, uuid, int, uuid[]
) TO authenticated, service_role;

-- ============================================================
-- closet_categories: which slots the wardrobe can fill at all.
--
-- Lets find-outfit tell an honest "you own no shoes" apart from
-- "none of your shoes matched this query" when reporting missing
-- roles, without pulling the whole closet into the function.
-- ============================================================

CREATE OR REPLACE FUNCTION public.closet_categories(filter_user_id uuid)
RETURNS TABLE (category text, item_count int)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE(i.category, 'other') AS category,
    COUNT(*)::int                 AS item_count
  FROM public.items AS i
  WHERE i.user_id = filter_user_id
    AND i.embedding IS NOT NULL
  GROUP BY COALESCE(i.category, 'other');
$$;

GRANT EXECUTE ON FUNCTION public.closet_categories(uuid)
  TO authenticated, service_role;
