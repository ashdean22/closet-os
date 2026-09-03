-- ============================================================
-- profiles: one row per signed-up user, in a schema you can
-- actually look at.
--
-- auth.users already holds this, but it lives in the auth schema
-- where the Table Editor won't show it and PostgREST won't join
-- against it. This mirrors the handful of columns worth seeing
-- and gives every later feature (entitlements, exemptions) a
-- public-schema row to hang off.
--
-- The mirror is maintained by trigger rather than by the app, so
-- a profile cannot be missing for a user who signed up while the
-- client was on an old build.
-- ============================================================

CREATE TABLE public.profiles (
  id         uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Explicit grants: the cloud default changed 2026-05-30 to stop
-- auto-exposing new public tables to the Data API roles.
REVOKE ALL ON public.profiles FROM anon;
GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO service_role;

-- A user may read their own row and nothing else. There is no
-- insert/update policy on purpose: the trigger below owns every
-- write, so the client cannot forge or edit a profile.
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated USING (id = (SELECT auth.uid()));

-- ============================================================
-- Mirror auth.users -> profiles.
--
-- SECURITY DEFINER because the trigger runs as the auth admin
-- role during signup, which has no rights on public.profiles.
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, created_at)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.created_at, now()))
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$;

-- Fires on email changes too, so the mirror cannot drift.
CREATE TRIGGER sync_profile_on_auth_user
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile();

-- Backfill everyone who signed up before this migration.
INSERT INTO public.profiles (id, email, created_at)
SELECT u.id, u.email, u.created_at FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- user_overview: the table to actually open in Supabase.
--
-- One row per user with the numbers worth knowing at a glance —
-- how much wardrobe they have uploaded, whether the tagging
-- pipeline kept up, and how hard they are leaning on the daily
-- search budget today.
--
-- security_invoker = true so the view is not a hole around the
-- RLS on the tables underneath it: it returns what the caller is
-- allowed to see. Only service_role is granted, so in practice
-- that means you (the Table Editor connects as a superuser) and
-- the Edge Functions.
-- ============================================================

CREATE VIEW public.user_overview
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.email,
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
    WHERE a.user_id = p.id AND a.action = 'outfit'
  ), 0) AS searches_all_time,
  (SELECT max(i.created_at) FROM public.items i WHERE i.user_id = p.id)
    AS last_item_added
FROM public.profiles p;

REVOKE ALL ON public.user_overview FROM anon, authenticated;
GRANT SELECT ON public.user_overview TO service_role;
