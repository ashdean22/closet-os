# Capsule Digital Closet — App Store Submission Package

Working doc for the App Store Connect listing + submission. Copy is ready to
paste; checklists mark what only you can do.

## Listing copy

**App name** (30 chars max):
`Capsule Digital Closet` (22 — 8 spare if you want another keyword)

**Subtitle** (30 chars max):
`Outfits from clothes you own` (28)

**Home-screen label** (in the binary): `Capsule` — iOS truncates around 12
characters, so the icon carries the short brand while the listing carries the
full name. Same pattern as "Whering: Your Digital Closet".

**Description:**

> The clothes you actually wear are a fraction of what you own. The rest isn't
> bad — it's just out of sight, so it never makes the rotation, and "I have
> nothing to wear" ends up being cheaper to solve by buying something than by
> digging through the closet.
>
> Capsule is for getting more out of what's already hanging there. Photograph
> each piece once and it gets tagged on its own: color, category, fabric,
> formality, season. Then ask for what you need the way you'd say it out loud
> — "smart casual dinner," "something for a cold rainy Tuesday" — and get a
> full outfit built only from clothes you own, with a line on why each piece
> works. Often it's a pairing you wouldn't have reached for, out of something
> you'd stopped seeing. No mood boards, no shopping links, nothing you have to
> buy first.
>
> It'll also tell you when you're about to repeat yourself. Add a piece close
> enough to something already in there and Capsule shows you both, side by
> side, before it joins the pile — so if you keep it, that's a decision
> instead of an accident.
>
> Free, no ads, and your closet stays yours.

**Keywords** (100 chars max, 94 used) — no repeats of words already in the
name or subtitle, since those are indexed separately:
`wardrobe,stylist,fashion,style,planner,organizer,lookbook,ootd,mix,match,duplicate,scan,resale`

**Category:** Lifestyle · **Price:** Free

## App Privacy labels (match reality exactly)

| Data | Collected? | Linked to identity? | Purpose |
|---|---|---|---|
| Email address | Yes (account) | Yes | App functionality (auth) |
| Photos / user content | Yes (clothing photos, tags) | Yes | App functionality |
| Tracking | No | — | — |

Privacy policy URL: https://ashdean22.github.io/closet-os/

## App Review Information

- Demo account: create a throwaway account with a **populated closet** (8–10
  items covering top/bottom/shoes/outerwear so Find Outfit demos well) and put
  its credentials in the Review notes.
- Reviewer notes (paste + adjust):

> Capsule requires an account (Supabase auth; email + password only). A demo
> account with a pre-populated closet is provided above. Core flow: Add Item →
> photograph clothing → AI auto-tags it → Closet tab shows the wardrobe →
> Outfit tab answers plain-English outfit requests using only the user's own
> items. Account deletion is in Settings → Delete Account. Camera and photo
> library are used solely to photograph clothing items.

- Export compliance: standard HTTPS only → `ITSAppUsesNonExemptEncryption`
  is already `false` in app.json (no dialog at submission).

## Submission checklist

Done:

- [x] Supabase project restored; `db push` + `functions deploy` applied
- [x] Blank-wall rejection verified (422 + scan tips, no DB row)
- [x] Real-photo tagging verified against the JWT-gated `tag-item`
- [x] Settings screen: version + privacy policy link verified
- [x] Android APK rebuilt and the stale share link replaced
- [x] Build 3 uploaded to App Store Connect (superseded by build 4 — see below)
- [x] Account deletion re-tested **with items attached**, gap found and fixed,
      function redeployed and re-tested clean — see below

Remaining:

- [ ] Attach **build 4** (the rename build) to version 1.0, not build 3
- [ ] Rename the app record in App Store Connect to `Capsule Digital Closet`
- [ ] Screenshots at 6.7″ size: closet grid, outfit result with reasoning,
      add/tag flow, duplicate warning
- [ ] Paste listing copy, privacy labels, review notes + demo credentials,
      category (Lifestyle) / price (Free)
- [ ] Submit for review (1–3 day turnaround typical)

## Account deletion, re-tested with items attached

Throwaway account, two items with real storage objects, one saved outfit
through the `save_outfit` RPC, then `delete-account` with that user's JWT.
Result was `{"success": true}` — and it was not telling the whole truth.

Gone as claimed: both `items` rows, both storage objects, the auth user
(password sign-in afterwards returns 400).

**Left behind: the saved outfit.** `saved_outfits.user_id` is a bare uuid
column with no FK to `auth.users`, so deleting the auth user cascades nothing,
and the function never touched the table — it was written before saved outfits
existed. The orphaned row keeps the outfit name, the free-text query ("65 and
rainy, job interview") and Claude's per-piece reasons: user content, still
readable, after an account deletion that reported success. The pieces survive
too, with `item_id` set to NULL by the tombstone FK.

Fixed by deleting `saved_outfits` for the user before the items rows (pieces
cascade on `outfit_id`). Deployed, and the same test re-run against the
deployed function: items, saved outfit, pieces, storage objects and the auth
user all gone.

One trap for whoever re-tests: a public storage URL fetched **before** the
deletion comes back 200 afterwards on a Cloudflare cache HIT. It is not a
leftover object. Add a cache-busting query param, or read through
`/storage/v1/object/...` with a token — both returned 400, correctly.

## TestFlight "What to Test" — build 5

Paste into TestFlight → Test Information. Testers see this verbatim.

---

The app is now called Capsule. This build adds account controls and makes the
AI's tags editable. Things worth pushing on:

**Settings (new tab)** — your email, log out, privacy policy, version, and
Delete Account. Deletion is permanent and removes your account, items, and
photos, so use a throwaway account if you want to try it.

**Editable tags** — open any item and tap "Edit tags." Category, formality,
and season are pickers; color, material, and description are free text. If the
AI mislabelled something, correct it and tell me what it got wrong — those
corrections are the most useful thing you can send me.

**Photo rejection** — point it at something that isn't clothing: a wall, a
desk, your floor. It should refuse and show framing tips rather than inventing
tags. If it confidently tags something that isn't a garment, that's a bug and
I want to hear about it.

**Outfit quality** — ask for a few different occasions and weather. Are the
picks sensible? Does the reasoning actually justify the choice, or does it
read like it's rationalising a random pull?

**Sign-in errors** — if you mistype a password, the message should be helpful
rather than cryptic.

There are daily limits of 30 tagged items and 20 outfit queries. Normal use
shouldn't come close; let me know if you hit one.

Most useful feedback: where it felt slow, where it felt wrong, and anything
you expected it to do that it didn't.

---

## Naming notes

The old name collided with a live Lifestyle app: "Closet OS" by Gengus
Sanborn, https://apps.apple.com/us/app/closet-os/id6760578149 — shipping under
it would have meant competing for our own name in search.

What did **not** change, deliberately: the bundle identifier
(`com.gabe822.closetos`) is tied to the certificates, the App Store Connect
record, and TestFlight — it is invisible to users and changing it would mean
starting a new app record. The Expo `slug` and the GitHub repo/Pages URL are
likewise internal.
