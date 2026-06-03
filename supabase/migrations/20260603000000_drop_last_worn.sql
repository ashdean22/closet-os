-- Remove wear-tracking feature.
-- last_worn is not referenced by match_items, find_similar_items,
-- tag-item, embed-item, or find-outfit, so no RPC changes are needed.
ALTER TABLE public.items DROP COLUMN IF EXISTS last_worn;
