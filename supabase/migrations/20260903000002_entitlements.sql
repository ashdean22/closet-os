-- ============================================================
-- Paid plans.
--
-- Three products, one active entitlement per user:
--   monthly   $4.99   renewing
--   yearly    $29.99  renewing
--   lifetime  $49.99  one-time
--
-- The table is the source of truth for what someone is allowed
-- to do, and only the service role writes to it. Whatever
-- verifies the purchase — an App Store receipt checked by an
-- Edge Function, or a webhook from a purchase platform — writes
-- here, so the enforcement below never has to care which.
--
-- Deliberately NOT trusted from the client. A phone claiming to
-- be subscribed is a claim, not a fact.
-- ============================================================

CREATE TYPE public.entitlement_product AS ENUM ('monthly', 'yearly', 'lifetime');

CREATE TABLE public.entitlements (
  user_id                 uuid PRIMARY KEY
                            REFERENCES auth.users(id) ON DELETE CASCADE,
  product                 public.entitlement_product NOT NULL,
  -- NULL means it never lapses. That is the lifetime purchase, and
  -- it is why this is nullable rather than a far-future date: a
  -- sentinel year would eventually arrive.
  expires_at              timestamptz,
  -- Apple's stable identifier for a subscription across every
  -- renewal. Unique so a restore on a second device updates the
  -- existing row instead of creating a second entitlement.
  original_transaction_id text UNIQUE,
  latest_transaction_id   text,
  -- 'production' or 'sandbox'. Kept so a TestFlight purchase is
  -- distinguishable from a real one when reading the table.
  environment             text NOT NULL DEFAULT 'production',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX entitlements_expiry_idx ON public.entitlements (expires_at);

ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.entitlements FROM anon;
GRANT SELECT ON public.entitlements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entitlements TO service_role;

-- Readable by its owner so the app can show which plan is active.
-- No insert or update policy: purchases are written by the service
-- role after verification, never by the phone that made them.
CREATE POLICY "entitlements_select_own" ON public.entitlements
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- ============================================================
-- Exemptions.
--
-- A table rather than a hardcoded address so the list can change
-- without a migration, and so it survives the owner deleting and
-- recreating their account — which is exactly what testing the
-- paywall involves.
-- ============================================================

CREATE TABLE public.exempt_emails (
  email text PRIMARY KEY,
  note  text
);

REVOKE ALL ON public.exempt_emails FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exempt_emails TO service_role;

INSERT INTO public.exempt_emails (email, note)
VALUES ('gabedean822@gmail.com', 'Owner');

ALTER TABLE public.profiles
  ADD COLUMN is_exempt boolean NOT NULL DEFAULT false;

-- Recomputed on every signup and email change, so the exemption
-- follows the address rather than the row.
CREATE OR REPLACE FUNCTION public.sync_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exempt boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.exempt_emails e
    WHERE lower(e.email) = lower(NEW.email)
  ) INTO v_exempt;

  INSERT INTO public.profiles (id, email, created_at, is_exempt)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.created_at, now()), v_exempt)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email, is_exempt = EXCLUDED.is_exempt;
  RETURN NEW;
END;
$$;

UPDATE public.profiles p
SET is_exempt = true
WHERE EXISTS (
  SELECT 1 FROM public.exempt_emails e WHERE lower(e.email) = lower(p.email)
);

-- ============================================================
-- What a given user is allowed to do today.
--
-- Two budgets, because the two things cost the same to run but
-- mean very different things to the person using the app:
--
--   searches — a look the user asked for. This is the number the
--     paywall is about, and it is deliberately small and visible.
--
--   extras — the background prefetch that makes Refresh instant,
--     and the "that's in the laundry" swaps. Charging a search
--     for swapping one dirty shirt would make the feature feel
--     like a punishment, so these have their own, looser budget.
--     Paid plans get the prefetch; free plans do not, which is
--     both a real cost saving and a real reason to upgrade.
--
-- The ceilings on a paid plan are abuse limits, not product
-- limits. Nobody styling outfits by hand reaches sixty a day.
-- ============================================================

CREATE OR REPLACE FUNCTION public.outfit_limits(p_user_id uuid)
RETURNS TABLE (plan text, unlimited boolean, searches int, extras int)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH standing AS (
    SELECT
      CASE
        WHEN p.is_exempt THEN 'exempt'
        WHEN e.user_id IS NOT NULL
             AND (e.expires_at IS NULL OR e.expires_at > now())
          THEN e.product::text
        ELSE 'free'
      END AS plan
    FROM public.profiles p
    LEFT JOIN public.entitlements e ON e.user_id = p.id
    WHERE p.id = p_user_id
  )
  SELECT
    COALESCE(s.plan, 'free'),
    COALESCE(s.plan, 'free') <> 'free',
    CASE WHEN COALESCE(s.plan, 'free') = 'free' THEN 2  ELSE 60 END,
    CASE WHEN COALESCE(s.plan, 'free') = 'free' THEN 4  ELSE 60 END
  FROM (SELECT 1) AS one
  LEFT JOIN standing s ON true;
$$;

GRANT EXECUTE ON FUNCTION public.outfit_limits(uuid) TO service_role;

-- ============================================================
-- The same numbers, for the caller, with today's usage folded in.
--
-- SECURITY DEFINER because authenticated has no rights on
-- api_usage and should not get any — the only row it may learn
-- about is its own count, which is what this returns.
-- ============================================================

CREATE OR REPLACE FUNCTION public.my_outfit_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := (SELECT auth.uid());
  v_limits record;
  v_used   int;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'my_outfit_status requires an authenticated caller';
  END IF;

  SELECT * INTO v_limits FROM public.outfit_limits(v_user);

  SELECT COALESCE(count, 0) INTO v_used
  FROM public.api_usage
  WHERE user_id = v_user
    AND action = 'outfit'
    AND day = (now() AT TIME ZONE 'utc')::date;

  RETURN jsonb_build_object(
    'plan',      v_limits.plan,
    'unlimited', v_limits.unlimited,
    'limit',     v_limits.searches,
    'used',      LEAST(COALESCE(v_used, 0), v_limits.searches),
    'left',      GREATEST(v_limits.searches - COALESCE(v_used, 0), 0),
    -- Counters roll over at UTC midnight, which is what the app
    -- should say rather than guessing at the device's timezone.
    'resets_at', ((now() AT TIME ZONE 'utc')::date + 1)::timestamptz
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.my_outfit_status() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_outfit_status() TO authenticated;

-- ============================================================
-- api_usage gains the extras bucket.
-- ============================================================

ALTER TABLE public.api_usage DROP CONSTRAINT api_usage_action_check;
ALTER TABLE public.api_usage ADD CONSTRAINT api_usage_action_check
  CHECK (action IN ('tag', 'outfit', 'outfit_extra'));

-- ============================================================
-- user_overview, now with the plan on it.
-- ============================================================

-- Dropped and recreated rather than replaced: CREATE OR REPLACE VIEW
-- can only append columns, and `plan` belongs next to the email
-- rather than tacked on the end where it would go unread.
DROP VIEW public.user_overview;

CREATE VIEW public.user_overview
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.email,
  CASE
    WHEN p.is_exempt THEN 'exempt'
    WHEN e.user_id IS NOT NULL AND (e.expires_at IS NULL OR e.expires_at > now())
      THEN e.product::text
    WHEN e.user_id IS NOT NULL THEN 'lapsed'
    ELSE 'free'
  END AS plan,
  e.expires_at AS plan_expires,
  p.created_at AS signed_up,
  (SELECT count(*) FROM public.items i WHERE i.user_id = p.id)
    AS items,
  -- Below `items` means photos are still being tagged, or tagging
  -- failed for some of them.
  (SELECT count(*) FROM public.items i
    WHERE i.user_id = p.id AND i.embedding IS NOT NULL)
    AS items_ready,
  (SELECT count(*) FROM public.saved_outfits o WHERE o.user_id = p.id)
    AS saved_outfits,
  COALESCE((
    SELECT a.count FROM public.api_usage a
    WHERE a.user_id = p.id
      AND a.action = 'outfit'
      AND a.day = (now() AT TIME ZONE 'utc')::date
  ), 0) AS searches_today,
  COALESCE((
    SELECT sum(a.count)::int FROM public.api_usage a
    WHERE a.user_id = p.id AND a.action IN ('outfit', 'outfit_extra')
  ), 0) AS model_calls_all_time,
  (SELECT max(i.created_at) FROM public.items i WHERE i.user_id = p.id)
    AS last_item_added
FROM public.profiles p
LEFT JOIN public.entitlements e ON e.user_id = p.id;

REVOKE ALL ON public.user_overview FROM anon, authenticated;
GRANT SELECT ON public.user_overview TO service_role;
