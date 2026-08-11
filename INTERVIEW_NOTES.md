# Capsule — Interview Notes

Talking points for the data model, auth flow, and a representative bug.
Each section has a plain-English version to open with and the technical
detail to go to when they push.

---

## 1. Data model

**Plain English.** Every garment is one row. A photo goes to an AI model that
writes structured tags — color, category, fabric, formality, season — plus a
one-sentence description. That description gets turned into a vector, a list of
numbers representing its meaning. Searching the closet means comparing vectors
instead of matching keywords, so "something for a rainy interview" can surface a
wool coat that never uses either word.

**Technical.** Postgres on Supabase, one primary table:

```
items
  id              uuid  PK, default gen_random_uuid()
  user_id         uuid            -- owner; every query scopes on this
  image_url       text            -- public URL into the storage bucket
  color, secondary_color, category, formality, season, material,
  description     text            -- model-written, the text that gets embedded
  embedding       vector(768)     -- pgvector
  created_at      timestamptz
```

`embedding` is filled by **gemini-embedding-001** at 768 dimensions
(Matryoshka-truncated from the model's native 3072) and L2-normalised before
storage. Normalising matters: with unit vectors, cosine similarity reduces to a
dot product, so distances are consistent and comparable.

Search runs on an **HNSW index** using cosine distance:

```sql
CREATE INDEX items_embedding_hnsw_idx ON public.items
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

HNSW is approximate nearest neighbour — it trades exactness for speed, which is
the right trade for a wardrobe where "close enough" is the whole point.

Three RPCs do the real work:

| Function | Purpose |
|---|---|
| `match_items(query_embedding, filter_user_id, match_count)` | Semantic search, scoped to one user |
| `find_similar_items(item_id, threshold, max_count)` | Duplicate detection against the caller's own items |
| `increment_usage(p_user_id, p_action, p_limit)` | Atomically bumps a daily counter, returns whether the call is still under the cap |

A second table, `api_usage`, is keyed `(user_id, day, action)` and holds a count.
It has RLS enabled with **no policies at all** and grants only to `service_role`,
so it's unreachable from the client no matter what — only Edge Functions touch it.

Photos live in a Supabase Storage bucket rather than the database. Rows store the
URL, not the bytes.

**The one design decision worth volunteering:** `match_items` originally had the
signature `(query_embedding, match_count)` with no user filter, so every search
scanned *all* users' items. I had to drop and recreate the function rather than
`CREATE OR REPLACE` it, because Postgres can't change a function's parameter list
in place — replacing it just creates a second overload and the old, leaky one
keeps answering calls.

---

## 2. Auth flow

**Plain English.** Email and password through Supabase Auth. The user gets a
signed token; the app stores it and attaches it to every request. The database
itself enforces that you can only read your own rows — that rule lives in
Postgres, not in the app, so a bug in my client code can't leak someone else's
closet.

**Technical.** Three layers.

**Client.** `supabase-js` configured with AsyncStorage for persistence,
`autoRefreshToken: true`, and `detectSessionInUrl: false` (that's a browser
concern; there's no URL to parse in React Native). `App.tsx` calls `getSession()`
once on mount and subscribes to `onAuthStateChange` for sign-in and sign-out.
Token refresh is paused while the app is backgrounded and resumed on foreground
via an `AppState` listener — otherwise the refresh timer fires while the process
is suspended and produces stale-token errors.

**Row Level Security.** RLS is on for `items`, with four policies, all the same
shape:

```sql
CREATE POLICY "items_select_own" ON public.items
  FOR SELECT TO authenticated USING (user_id = auth.uid());
```

`auth.uid()` reads the verified JWT claim, so the database decides ownership. The
`INSERT` policy uses `WITH CHECK` so a client can't write a row belonging to
someone else, and `UPDATE` has both `USING` and `WITH CHECK` so a row can't be
reassigned to another user mid-update.

**Edge Functions.** These run with the service-role key, which bypasses RLS
entirely — so they have to re-establish identity themselves. The pattern:

```ts
const authHeader = req.headers.get("Authorization") ?? "";
if (!authHeader.startsWith("Bearer ")) return json({...}, 401);

// Verify the token's signature against Supabase's JWKS.
const { data: { user }, error } = await anonClient.auth.getUser(authHeader.slice(7));
if (error || !user) return json({...}, 401);

// Only now use the privileged client, passing the *verified* id explicitly.
const { data } = await serviceClient.rpc("match_items", {
  filter_user_id: user.id, ...
});
```

**The point to make:** the function never trusts a `user_id` from the request
body. It derives identity from the token and passes that verified value into the
query. When RLS is bypassed, scoping stops being automatic and becomes something
you have to do deliberately on every query.

Account deletion runs as its own function: verify the JWT, delete the user's
storage objects, then their rows, then the auth user via the admin API. Every
step is idempotent so a partial failure is safely retryable.

---

## 3. A bug I fixed

### The AI confidently tagged a blank wall as clothing

**Symptom.** Photograph a bare wall and the app saved a row: "beige, cotton,
casual, top." No error. It looked exactly like a successful scan, and the junk
item then polluted outfit suggestions.

**Root cause.** I was using tool-calling to force structured output — the model
must return an object matching my schema, which guarantees I get parseable JSON
back. The mistake was assuming that a **well-formed response implied a valid
one**. The schema had fields for color, category, and material, so the model
filled them in. It had no way to say "there is no garment here," so it did the
only thing the schema allowed and described the wall.

**Fix, in two parts.**

*Make the decision explicit and first.* I added two required fields to the
front of the tool schema — `item_detected` (boolean) and `confidence`
(high/medium/low) — and rewrote the system prompt so the model's first job is to
decide whether a wearable item is present, listing the failure cases directly:
walls, floors, furniture, empty frames, images too dark or cluttered to read.

*Fail closed on the server.* The gate checks for an explicit `true`:

```ts
if (result.item_detected !== true || result.confidence === "low") {
  return json({ error: "...", reason: "no_item" }, 422);
}
```

Written as `!== true` rather than `=== false` on purpose — a missing field, a
string `"false"`, or `undefined` from a truncated response all take the reject
path. The default is refusal; only an explicit yes proceeds.

I also logged the model's decision on every call, so a wrong outcome is
diagnosable from the function logs instead of guesswork.

**A second problem the fix exposed.** With rejection working, the app showed
"try better lighting" for *every* failure — including 500s and timeouts, which
have nothing to do with the photo. That's dishonest error handling: it blames
the user for the server's problem. So I gave the function a machine-readable
`reason` on every error path (`no_item`, `image_too_large`, `unsupported_format`,
`rate_limited`, `timeout`, `service_config`) and mapped each to an accurate
message. Only a genuine `no_item` mentions lighting.

**The lesson, stated generally.** Structured output guarantees *shape*, not
*truth*. Any place a model makes a decision needs an explicit field to express
"no" and a server-side gate that fails closed. Don't infer validity from the fact
that parsing succeeded.

**The embarrassing part, worth telling.** My first fix appeared to do nothing. I
re-read the prompt, adjusted wording, retested — still broken. I had edited the
Edge Function locally and never run `supabase functions deploy`. The old code was
still serving every request. It happened twice before I made "confirm it's
actually deployed" the first step of debugging anything that spans local and
remote code.

---

### Backup: the white-screen crash

If they want a second, or a more conventional debugging story.

The Outfit screen went blank white for a tester — no error, no message. In React
Native that means a render-time exception unmounting the tree. Reproduced with
`npx expo start` and read the real stack in Metro: a `TypeError` on `.map` of
`undefined`.

Cause: `supabase.functions.invoke()` only routes **non-2xx** responses to its
error channel. My function was returning HTTP 200 with an `{ error }` body on one
path, so the client treated it as success and tried to render an outfit array
that wasn't there.

Fix was three layers: a `normalizeOutfitResult()` validator that turns any
unexpected shape into a friendly error state instead of a crash, defensive
defaults at every render site (`Array.isArray(x) ? x : []`), and an error
boundary around the screen so a future render bug degrades to a message rather
than a white void.

**Lesson.** A 200 doesn't mean success unless you control both ends and mean it.
Validate the response shape at the boundary — treat your own backend as untrusted
input, because a deploy skew makes it exactly that.
