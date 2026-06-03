-- ============================================================
-- items table
-- RLS deferred to Day 5 — permissive for single-user testing
-- ============================================================
CREATE TABLE public.items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid,
  image_url       text,
  color           text,
  secondary_color text,
  category        text,
  formality       text,
  season          text,
  material        text,
  description     text,
  last_worn       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Explicit grants required: cloud default changed 2026-05-30 to stop
-- auto-exposing new public tables to the Data API roles.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.items TO anon, authenticated;

-- ============================================================
-- Storage bucket: wardrobe-items (public)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wardrobe-items',
  'wardrobe-items',
  true,
  52428800,   -- 50 MB
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- Permissive storage policies for Day 2 testing (tightened Day 5)
CREATE POLICY "wardrobe_items_select"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'wardrobe-items');

CREATE POLICY "wardrobe_items_insert"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'wardrobe-items');

CREATE POLICY "wardrobe_items_update"
  ON storage.objects FOR UPDATE
  TO anon, authenticated
  USING (bucket_id = 'wardrobe-items');

CREATE POLICY "wardrobe_items_delete"
  ON storage.objects FOR DELETE
  TO anon, authenticated
  USING (bucket_id = 'wardrobe-items');
