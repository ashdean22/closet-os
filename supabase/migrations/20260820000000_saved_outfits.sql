-- ============================================================
-- Saved outfits.
--
-- A generated look is expensive (one Claude call against a
-- retrieved candidate set) and currently evaporates the moment
-- the user searches again. Saving one costs nothing, and it
-- takes direct pressure off the 20/day outfit cap — someone who
-- keeps five looks stops regenerating them.
--
-- Design note: pieces REFERENCE items rather than snapshotting
-- them. Snapshotting image_url would leave a saved outfit
-- showing a photo of a jumper the user deleted weeks ago,
-- pointing at a storage object that may no longer exist. With a
-- real FK and ON DELETE CASCADE, deleting an item removes it
-- from every saved outfit automatically and the UI can honestly
-- report "3 of 4 pieces still in your closet" — self-healing,
-- with no orphan cleanup job to run.
-- ============================================================

CREATE TABLE public.saved_outfits (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL,
  -- Defaulted from the variation name the stylist already returns
  -- ("The Quiet Interview"), then editable. Never blank.
  name       text        NOT NULL,
  -- What was asked for, kept so a saved look still makes sense
  -- months later: "65 and rainy, job interview".
  query      text,
  rationale  text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.saved_outfit_pieces (
  id        uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  outfit_id uuid    NOT NULL REFERENCES public.saved_outfits(id) ON DELETE CASCADE,
  item_id   uuid    NOT NULL REFERENCES public.items(id)         ON DELETE CASCADE,
  role      text,
  -- Claude's one-line justification for this piece, frozen at save
  -- time. Regenerating it later would cost a model call and could
  -- contradict what the user actually saved.
  reason    text,
  is_anchor boolean NOT NULL DEFAULT false,
  position  int     NOT NULL DEFAULT 0
);

CREATE INDEX saved_outfits_user_created_idx
  ON public.saved_outfits (user_id, created_at DESC);
CREATE INDEX saved_outfit_pieces_outfit_idx
  ON public.saved_outfit_pieces (outfit_id, position);
-- Supports the CASCADE when an item is deleted.
CREATE INDEX saved_outfit_pieces_item_idx
  ON public.saved_outfit_pieces (item_id);

-- Explicit grants: the cloud default changed 2026-05-30 to stop
-- auto-exposing new public tables to the Data API roles.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_outfits       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_outfit_pieces TO authenticated;

-- ============================================================
-- RLS — each user sees and mutates only their own saved outfits
-- ============================================================

ALTER TABLE public.saved_outfits       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_outfit_pieces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_outfits_select_own" ON public.saved_outfits
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE POLICY "saved_outfits_insert_own" ON public.saved_outfits
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));

-- UPDATE is the rename path; WITH CHECK stops a row being reassigned
-- to another user on the way out.
CREATE POLICY "saved_outfits_update_own" ON public.saved_outfits
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "saved_outfits_delete_own" ON public.saved_outfits
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- Pieces inherit ownership from their parent outfit rather than
-- carrying a duplicate user_id, so the two can never disagree.
CREATE POLICY "saved_outfit_pieces_select_own" ON public.saved_outfit_pieces
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.saved_outfits o
    WHERE o.id = outfit_id AND o.user_id = (SELECT auth.uid())
  ));

CREATE POLICY "saved_outfit_pieces_insert_own" ON public.saved_outfit_pieces
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.saved_outfits o
    WHERE o.id = outfit_id AND o.user_id = (SELECT auth.uid())
  ));

CREATE POLICY "saved_outfit_pieces_delete_own" ON public.saved_outfit_pieces
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.saved_outfits o
    WHERE o.id = outfit_id AND o.user_id = (SELECT auth.uid())
  ));

-- ============================================================
-- save_outfit: create the outfit and its pieces in one statement.
--
-- Done as an RPC so a failure part-way through can't leave a
-- named outfit with no clothes in it. SECURITY INVOKER (the
-- default) is deliberate — the policies above still apply, so
-- this cannot be used to write into another user's account.
-- ============================================================

CREATE OR REPLACE FUNCTION public.save_outfit(
  p_name      text,
  p_query     text,
  p_rationale text,
  p_pieces    jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
  v_id   uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'save_outfit requires an authenticated caller';
  END IF;

  INSERT INTO public.saved_outfits (user_id, name, query, rationale)
  VALUES (
    v_user,
    -- Never store a blank name; the list would render an empty row.
    COALESCE(NULLIF(BTRIM(p_name), ''), 'Saved outfit'),
    NULLIF(BTRIM(COALESCE(p_query, '')), ''),
    NULLIF(BTRIM(COALESCE(p_rationale, '')), '')
  )
  RETURNING id INTO v_id;

  INSERT INTO public.saved_outfit_pieces
    (outfit_id, item_id, role, reason, is_anchor, position)
  SELECT
    v_id,
    (piece->>'item_id')::uuid,
    piece->>'role',
    piece->>'reason',
    COALESCE((piece->>'is_anchor')::boolean, false),
    (ord - 1)::int
  FROM jsonb_array_elements(COALESCE(p_pieces, '[]'::jsonb))
       WITH ORDINALITY AS t(piece, ord)
  -- Only pieces the caller actually owns. Without this a crafted
  -- request could pin someone else's item into a saved outfit and
  -- read its details back through the join.
  WHERE EXISTS (
    SELECT 1 FROM public.items i
    WHERE i.id = (piece->>'item_id')::uuid
      AND i.user_id = v_user
  );

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_outfit(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.save_outfit(text, text, text, jsonb) TO authenticated;
