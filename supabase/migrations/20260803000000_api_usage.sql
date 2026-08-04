-- ============================================================
-- Per-user daily API usage tracking (cost guardrails).
-- tag-item and find-outfit call increment_usage() with the
-- service-role client BEFORE spending any Anthropic/Gemini
-- credits; over-limit calls return 429 reason "daily_limit".
-- Clients never touch this table directly.
-- ============================================================

CREATE TABLE public.api_usage (
  user_id uuid NOT NULL,
  day     date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  action  text NOT NULL CHECK (action IN ('tag', 'outfit')),
  count   int  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, action)
);

-- Service-role only. RLS with no policies blocks anon/authenticated even if a
-- future grant slips through; the explicit grants cover the new no-auto-expose
-- cloud default (service_role gets nothing implicitly since 2026-05-30).
ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_usage FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_usage TO service_role;

-- Atomically bump today's counter and report whether the call is still within
-- the limit. The counter keeps incrementing past the limit (harmless — it just
-- records attempts), but returns false for every call beyond p_limit.
CREATE OR REPLACE FUNCTION public.increment_usage(
  p_user_id uuid,
  p_action  text,
  p_limit   int
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  new_count int;
BEGIN
  INSERT INTO public.api_usage (user_id, day, action, count)
  VALUES (p_user_id, (now() AT TIME ZONE 'utc')::date, p_action, 1)
  ON CONFLICT (user_id, day, action)
  DO UPDATE SET count = api_usage.count + 1
  RETURNING count INTO new_count;

  RETURN new_count <= p_limit;
END;
$$;

-- Only the Edge Functions (service role) may call this.
REVOKE EXECUTE ON FUNCTION public.increment_usage(uuid, text, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_usage(uuid, text, int)
  TO service_role;
