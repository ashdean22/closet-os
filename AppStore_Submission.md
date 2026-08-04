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

> You already own more outfits than you think — you just can't see them. Most
> of us wear the same few pieces on rotation, forget what's in the back of the
> closet, and end up buying something nearly identical to what's already
> hanging there.
>
> Capsule fixes that. Photograph each piece once and it's automatically
> tagged by color, category, material, formality, and season. Then just ask in
> plain English — "something for a rainy casual Friday" — and get a complete
> outfit assembled from your own clothes, with the reasoning behind every
> piece. No generic style advice: every suggestion is something you actually
> own.
>
> And before you buy that next shirt, Capsule has your back. When you add a
> new item, it checks your closet for near-identical pieces you already own
> and warns you before the duplicate sneaks in. Your closet, finally
> searchable — and your money staying in your pocket.

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

Remaining:

- [ ] Re-test account deletion **with items attached** — the first pass had an
      empty closet, so storage cleanup and item-row deletion never executed.
      Add 1–2 items to a throwaway, delete it, then confirm the
      `wardrobe-items` bucket has no leftovers. Storage failures log as
      warnings, so a broken path fails silently while still claiming success.
- [ ] Attach **build 4** (the rename build) to version 1.0, not build 3
- [ ] Rename the app record in App Store Connect to `Capsule Digital Closet`
- [ ] Screenshots at 6.7″ size: closet grid, outfit result with reasoning,
      add/tag flow, duplicate warning
- [ ] Paste listing copy, privacy labels, review notes + demo credentials,
      category (Lifestyle) / price (Free)
- [ ] Submit for review (1–3 day turnaround typical)

## Naming notes

The old name collided with a live Lifestyle app: "Closet OS" by Gengus
Sanborn, https://apps.apple.com/us/app/closet-os/id6760578149 — shipping under
it would have meant competing for our own name in search.

What did **not** change, deliberately: the bundle identifier
(`com.gabe822.closetos`) is tied to the certificates, the App Store Connect
record, and TestFlight — it is invisible to users and changing it would mean
starting a new app record. The Expo `slug` and the GitHub repo/Pages URL are
likewise internal.
