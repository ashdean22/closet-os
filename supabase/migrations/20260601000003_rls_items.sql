-- ============================================================
-- Row Level Security on items
-- Each user sees and mutates only their own rows.
-- ============================================================

ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

-- SELECT: only rows the user owns
CREATE POLICY "items_select_own"
  ON public.items
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- INSERT: user_id in the new row must equal the caller's uid.
-- Both USING and WITH CHECK are set so the policy applies to
-- the row both before and after the write.
CREATE POLICY "items_insert_own"
  ON public.items
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- UPDATE: can only touch rows they own, and cannot reassign user_id
CREATE POLICY "items_update_own"
  ON public.items
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- DELETE: only their own rows
CREATE POLICY "items_delete_own"
  ON public.items
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- The service role (used by embed-item) bypasses RLS automatically.
-- No separate policy is needed for it.
