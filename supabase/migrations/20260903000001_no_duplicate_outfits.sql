-- ============================================================
-- One saved copy per outfit.
--
-- The client already greys out Save for a look it saved this
-- session, but that state dies with the screen: search the same
-- thing tomorrow, get the same look back, and it saves again.
-- The rule belongs in the database, where it survives restarts,
-- races between two taps, and a future second client.
--
-- "The same outfit" means the same SET of garments, regardless
-- of order, name, or the query that produced it. Two looks built
-- from the same four pieces are one outfit whatever they were
-- called on the way in.
-- ============================================================

-- Stored, not computed on read: it is the identity of the outfit
-- AT SAVE TIME. Recomputing it later would let a look become
-- re-saveable simply because one of its garments was deleted
-- from the closet (item_id goes NULL under the tombstone rule in
-- 20260820000001).
ALTER TABLE public.saved_outfits ADD COLUMN signature text;

CREATE OR REPLACE FUNCTION public.outfit_signature(p_pieces jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT md5(string_agg(DISTINCT t.piece->>'item_id', '|'
                        ORDER BY t.piece->>'item_id'))
  FROM jsonb_array_elements(COALESCE(p_pieces, '[]'::jsonb)) AS t(piece)
  WHERE t.piece->>'item_id' IS NOT NULL;
$$;

-- ── Backfill ────────────────────────────────────────────────
-- Existing rows may already contain duplicates, and deleting a
-- user's saved outfit to satisfy a new constraint would be the
-- wrong trade. So the earliest copy of each duplicate group gets
-- the signature and the later copies keep NULL: they survive
-- untouched, and the partial index below simply ignores them.
-- The rule binds from here forward.
WITH sigs AS (
  SELECT
    o.id,
    o.user_id,
    o.created_at,
    md5(string_agg(DISTINCT pc.item_id::text, '|' ORDER BY pc.item_id::text)) AS sig
  FROM public.saved_outfits o
  JOIN public.saved_outfit_pieces pc ON pc.outfit_id = o.id
  WHERE pc.item_id IS NOT NULL
  GROUP BY o.id, o.user_id, o.created_at
),
first_of_each AS (
  SELECT id, sig,
         row_number() OVER (
           PARTITION BY user_id, sig ORDER BY created_at, id
         ) AS rn
  FROM sigs
)
UPDATE public.saved_outfits o
SET signature = f.sig
FROM first_of_each f
WHERE o.id = f.id AND f.rn = 1;

-- Partial so the NULL-signature rows above (and any outfit whose
-- garments have all been deleted) are exempt rather than
-- colliding with each other.
CREATE UNIQUE INDEX saved_outfits_user_signature_idx
  ON public.saved_outfits (user_id, signature)
  WHERE signature IS NOT NULL;

-- ============================================================
-- save_outfit, now duplicate-aware.
--
-- The signature is computed from the pieces that SURVIVE the
-- ownership filter, not from what was sent, so a request padded
-- with someone else's item ids cannot produce a different
-- signature for the same real outfit.
--
-- The explicit check exists to raise a sentence a person can
-- read; the unique index behind it is what actually holds under
-- two simultaneous taps.
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
  v_user      uuid := (SELECT auth.uid());
  v_id        uuid;
  v_owned     jsonb;
  v_signature text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'save_outfit requires an authenticated caller';
  END IF;

  -- Only pieces the caller actually owns. Without this a crafted
  -- request could pin someone else's item into a saved outfit and
  -- read its details back through the join.
  SELECT COALESCE(jsonb_agg(t.piece ORDER BY t.ord), '[]'::jsonb)
    INTO v_owned
  FROM jsonb_array_elements(COALESCE(p_pieces, '[]'::jsonb))
       WITH ORDINALITY AS t(piece, ord)
  WHERE EXISTS (
    SELECT 1 FROM public.items i
    WHERE i.id = (t.piece->>'item_id')::uuid
      AND i.user_id = v_user
  );

  IF jsonb_array_length(v_owned) = 0 THEN
    RAISE EXCEPTION 'None of those pieces are in your closet.';
  END IF;

  v_signature := public.outfit_signature(v_owned);

  IF EXISTS (
    SELECT 1 FROM public.saved_outfits o
    WHERE o.user_id = v_user AND o.signature = v_signature
  ) THEN
    RAISE EXCEPTION 'You have already saved this outfit.'
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO public.saved_outfits (user_id, name, query, rationale, signature)
  VALUES (
    v_user,
    -- Never store a blank name; the list would render an empty row.
    COALESCE(NULLIF(BTRIM(p_name), ''), 'Saved outfit'),
    NULLIF(BTRIM(COALESCE(p_query, '')), ''),
    NULLIF(BTRIM(COALESCE(p_rationale, '')), ''),
    v_signature
  )
  RETURNING id INTO v_id;

  INSERT INTO public.saved_outfit_pieces
    (outfit_id, item_id, role, reason, is_anchor, position)
  SELECT
    v_id,
    (t.piece->>'item_id')::uuid,
    t.piece->>'role',
    t.piece->>'reason',
    COALESCE((t.piece->>'is_anchor')::boolean, false),
    (t.ord - 1)::int
  FROM jsonb_array_elements(v_owned) WITH ORDINALITY AS t(piece, ord);

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_outfit(text, text, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.save_outfit(text, text, text, jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.outfit_signature(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.outfit_signature(jsonb) TO authenticated, service_role;
