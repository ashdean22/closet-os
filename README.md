# Closet OS

> Your AI-powered wardrobe — so you stop re-buying clothes you already own and forgot about.

---

## The Problem

The average person owns ~77 garments but regularly wears ~20% of them. The rest drifts to the back of the closet — out of sight, out of mind, out of outfit decisions. Closet OS makes the invisible visible: photograph anything once, and the app tags it, embeds it semantically, and surfaces it whenever a query matches — even if you've forgotten you own it.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     React Native (Expo)                      │
│   Add Item · Closet Grid · Outfit Search · Auth · RLS       │
└───────────────────┬─────────────────────┬───────────────────┘
                    │  supabase-js SDK    │  supabase.functions.invoke
                    ▼                     ▼
┌───────────────────────────────────────────────────────────── ┐
│                        Supabase                              │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Postgres    │  │   Storage    │  │  Edge Functions  │  │
│  │  + pgvector  │  │ wardrobe-    │  │  (Deno / TS)     │  │
│  │  items table │  │   items      │  │                  │  │
│  │  RLS per uid │  │  bucket      │  │  tag-item        │  │
│  └──────────────┘  └──────────────┘  │  embed-item      │  │
│                                      │  find-outfit     │  │
│  ┌──────────────┐                    └──────────────────┘  │
│  │  Auth (JWT)  │                                           │
│  │  per-user    │                                           │
│  │  RLS scoping │                                           │
│  └──────────────┘                                           │
└─────────────────────────────────────────────────────────────┘
                    │                    │
           Anthropic API          Google AI API
      claude-sonnet-4-6         gemini-embedding-001
     (Vision + Reasoning)         (768-dim vectors)
```

**Client:** React Native + Expo SDK 54, NativeWind (Tailwind), Expo Go + EAS Build for Android APK distribution.

**Backend:** Supabase hosts Postgres (with the `pgvector` extension for ANN search), object Storage, three Deno Edge Functions, and JWT-based Auth. Row-Level Security policies scope every DB read and write to the authenticated user's `uid`, including the `match_items` RPC.

**AI layer:** Two models, two roles.
- **Claude `claude-sonnet-4-6` (Vision):** tags each uploaded photo into a strict JSON schema — `color`, `category`, `formality`, `season`, `material`, `description`.
- **Claude `claude-sonnet-4-6` (Reasoning):** assembles a complete outfit from semantically retrieved candidates, constrained via tool-use so it can only reference item IDs that exist in the retrieved set.
- **Gemini `gemini-embedding-001`:** embeds the Claude-generated description into a 768-dimensional vector for semantic retrieval.

---

## Image-RAG Pipeline

```
User uploads photo
        │
        ▼
  ┌─────────────────────────────────────────────────┐
  │  tag-item  (Edge Function)                      │
  │                                                 │
  │  1. Fetch image bytes from Storage              │
  │  2. claude-sonnet-4-6 Vision + tool-use →       │
  │     { color, category, formality, season,       │
  │       material, description }                   │
  │  3. INSERT row into items (user_id, tags, url)  │
  └─────────────────────────────────────────────────┘
        │
        ▼
  ┌─────────────────────────────────────────────────┐
  │  embed-item  (Edge Function)                    │
  │                                                 │
  │  1. Read description from items                 │
  │  2. gemini-embedding-001 (outputDimensionality: │
  │     768) → float[768], L2-normalised            │
  │  3. UPDATE items SET embedding = vector         │
  └─────────────────────────────────────────────────┘
        │
  (later, on outfit query)
        │
        ▼
  ┌─────────────────────────────────────────────────┐
  │  find-outfit  (Edge Function)                   │
  │                                                 │
  │  1. Verify caller JWT → get user_id             │
  │  2. Embed query text with gemini-embedding-001  │
  │     (same model + dims as stored vectors)       │
  │  3. match_items RPC → pgvector HNSW (cosine)    │
  │     → top-10 semantically nearest items         │
  │     filtered to this user's wardrobe            │
  │  4. claude-sonnet-4-6 + tool_choice: forced →  │
  │     build_outfit({ item_id, role, reason }[])   │
  │  5. Anti-hallucination guard: reject any        │
  │     item_id not in the retrieved set            │
  │  6. Return outfit + rationale + missing roles   │
  └─────────────────────────────────────────────────┘
```

**Why tool-use for outfit assembly?** Claude's `tool_choice: { type: "tool" }` forces it to call `build_outfit` on every invocation, returning a typed object rather than prose. This eliminates JSON parse errors and — combined with passing only retrieved item IDs to the prompt — makes hallucinated items structurally impossible rather than just unlikely.

---

## Duplicate Detection

After every add, `find_similar_items` runs a cosine similarity search against the user's existing wardrobe. If any item exceeds the threshold, a side-by-side comparison card appears with Keep / Remove options.

**Threshold reasoning:**

| Similarity | Meaning | Action |
|---|---|---|
| ≥ 0.94–0.95 | Near-identical item (same garment, different photo) | Almost always a true duplicate |
| 0.85–0.93 | Same category + colour, different cut or brand | Warn user, let them decide |
| < 0.85 | Clearly different item | No warning |

The default threshold (0.85) favours recall — it surfaces more warnings and trusts the user to dismiss false positives — rather than precision. A production calibration pass on real wardrobe data would push this threshold up or introduce a two-tier hard/soft warning.

---

## Key Technical Decisions

**Edge Functions for key isolation.** `ANTHROPIC_API_KEY` and `GEMINI_API_KEY` live in Supabase secrets and are read only by Deno Edge Functions at runtime. They are never in the app bundle, never in source control, and never sent to the client. Only the `EXPO_PUBLIC_SUPABASE_ANON_KEY` (which is intentionally public) leaves the server.

**Matryoshka 768-dim truncation.** `gemini-embedding-001` outputs 3072 dimensions natively. We request `outputDimensionality: 768` to exploit the model's Matryoshka Representation Learning — high-level semantic structure is preserved in the first N dimensions, reducing storage and HNSW index size by 4× with negligible retrieval quality loss at wardrobe scale. Query and stored vectors must use the same model and dimension; both are L2-normalised before storage.

**RLS scoped into vector search.** `match_items` and `find_similar_items` are Postgres RPC functions with `SET search_path = public, extensions`. `match_items` receives `filter_user_id` (the JWT-verified caller ID, never the client-supplied value) and applies it as a hard `WHERE` clause. `find_similar_items` uses `auth.uid()` directly. Neither relies on RLS alone — the user filter is in the query predicate, making cross-user data leakage structurally impossible even if RLS were misconfigured.

**HNSW over IVFFlat.** For a small, append-only wardrobe table, HNSW (Hierarchical Navigable Small World) has lower query latency and doesn't require a periodic `VACUUM` + rebuild cycle the way IVFFlat does. The index uses `vector_cosine_ops` to match the `<=>` distance operator used in queries.

**`tool_choice: { type: "tool" }` for all structured AI output.** Both `tag-item` and `find-outfit` use forced tool-use, not free-text parsing. The Anthropic SDK guarantees `content[0].type === "tool_use"`, so the response is a typed JS object — no regex, no `JSON.parse`, no error handling for malformed prose.

**No re-embedding on description edit.** Description edits update the text column but not the `embedding` column — the vector silently drifts from the current description. This is a known, documented trade-off (see below).

---

## Known Limitations

| Limitation | Why it exists now |
|---|---|
| Public Storage bucket | Simplest setup for solo development; signed URLs require per-request server work |
| Email confirmation off | Friction reduction during development; must be re-enabled before sharing |
| Embedding not refreshed on edit | Re-embedding is async and costs an API call; not wired to description saves yet |
| Gemini key unrestricted | No API-key restriction or allowed-referrer set; fine for dev, not for launch |
| Android-only APK | iOS requires a paid Apple Developer account for TestFlight distribution |
| No outfit history | Saved outfits aren't persisted; every session starts fresh |
| Single-image items | Multi-angle photos would improve vision accuracy for accessories |

---

## What I'd Do Next

1. **Re-embed on description edit.** When a user corrects a Claude tag, queue an `embed-item` call so the semantic vector stays in sync. Could be a Postgres trigger that writes to a `pending_embeds` table, drained by a cron Edge Function.

2. **Fine-tune a smaller vision model on user corrections.** Every tag the user edits is a labelled training example. Fine-tune a lightweight vision classifier on `{ image, corrected_tags }` pairs to reduce Claude Vision API costs and latency.

3. **Private bucket + signed URLs.** Move `wardrobe-items` to a private bucket. Generate short-lived signed URLs server-side (Edge Function or Postgres RPC) so photos are never publicly guessable by URL.

4. **iOS + TestFlight.** Build with EAS for iOS, submit to TestFlight for internal testing.

5. **Restrict the Gemini API key.** Add an allowed-referrer or IP restriction in Google Cloud Console before any public distribution.

6. **Outfit history + re-wear tracking.** Persist `find-outfit` results as `outfits` rows. Surface "you haven't worn this pairing in 60 days" nudges using the existing `last_worn` column.

7. **Realtime closet sync.** Subscribe to Supabase Realtime on the `items` table so the closet grid updates across devices without a pull-to-refresh.

8. **Threshold calibration.** Collect accept/dismiss signals from the duplicate warning card and tune the 0.85 cosine threshold per-user via a simple logistic model.

---

## Links

| | |
|---|---|
| **GitHub** | _[link]_ |
| **Android APK (preview build)** | _[EAS install link]_ |
| **Demo video** | _[link]_ |

---

## Stack Summary

| Layer | Technology |
|---|---|
| Mobile client | React Native, Expo SDK 54, NativeWind v4 |
| Navigation | Custom tab bar (zero-dependency, Expo Go compatible) |
| Backend / DB | Supabase (Postgres 17, pgvector, Storage, Auth, Edge Functions) |
| Vector index | HNSW (`vector_cosine_ops`), 768-dim |
| Vision tagging | Anthropic `claude-sonnet-4-6` + forced tool-use |
| Outfit reasoning | Anthropic `claude-sonnet-4-6` + constrained tool-use |
| Embeddings | Google `gemini-embedding-001`, Matryoshka 768-dim |
| Edge runtime | Deno 2 (Supabase Edge Functions) |
| Distribution | EAS Update (OTA) + EAS Build (Android APK, internal) |
