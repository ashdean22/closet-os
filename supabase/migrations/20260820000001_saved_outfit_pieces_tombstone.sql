-- ============================================================
-- Keep a tombstone when a saved outfit's item is deleted.
--
-- 20260820000000 used ON DELETE CASCADE, which removes the piece
-- row outright. A saved outfit would then quietly shrink from
-- four pieces to three with nothing to explain the gap.
--
-- SET NULL keeps the row — and with it the role and Claude's
-- reason — so the outfit can say "Shoes — no longer in your
-- closet" instead of silently losing them. The user can then
-- re-add the piece or delete the outfit, as a decision rather
-- than a mystery.
-- ============================================================

ALTER TABLE public.saved_outfit_pieces
  DROP CONSTRAINT saved_outfit_pieces_item_id_fkey;

ALTER TABLE public.saved_outfit_pieces
  ALTER COLUMN item_id DROP NOT NULL;

ALTER TABLE public.saved_outfit_pieces
  ADD CONSTRAINT saved_outfit_pieces_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE SET NULL;
