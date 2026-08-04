# Closet OS — App Store Submission Package

Working doc for the App Store Connect listing + submission. Copy is ready to
paste; checklists mark what only you can do.

## Listing copy

**App name** (30 chars max):
`Closet OS: AI Wardrobe` (22)

**Subtitle** (30 chars max):
`Outfits from clothes you own` (28)

**Description:**

> You already own more outfits than you think — you just can't see them. Most
> of us wear the same few pieces on rotation, forget what's in the back of the
> closet, and end up buying something nearly identical to what's already
> hanging there.
>
> Closet OS fixes that. Photograph each piece once and it's automatically
> tagged by color, category, material, formality, and season. Then just ask in
> plain English — "something for a rainy casual Friday" — and get a complete
> outfit assembled from your own clothes, with the reasoning behind every
> piece. No generic style advice: every suggestion is something you actually
> own.
>
> And before you buy that next shirt, Closet OS has your back. When you add a
> new item, it checks your closet for near-identical pieces you already own
> and warns you before the duplicate sneaks in. Your closet, finally
> searchable — and your money staying in your pocket.

**Keywords** (100 chars max, 94 used):
`stylist,capsule,fashion,style,planner,organizer,lookbook,ootd,mix,match,duplicates,scan,resale`

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

> Closet OS requires an account (Supabase auth; email + password only). A demo
> account with a pre-populated closet is provided above. Core flow: Add Item →
> photograph clothing → AI auto-tags it → Closet tab shows the wardrobe →
> Outfit tab answers plain-English outfit requests using only the user's own
> items. Account deletion is in Settings → Delete Account. Camera and photo
> library are used solely to photograph clothing items.

- Export compliance: standard HTTPS only → `ITSAppUsesNonExemptEncryption`
  is already `false` in app.json (no dialog at submission).

## Submission checklist (user-only steps)

- [ ] **Restore the Supabase project** (currently paused — dashboard →
      project `sdbagkotzmsowvizxdyn` → Restore)
- [ ] `supabase db push` (api_usage migration; prompts for DB password)
- [ ] `supabase functions deploy tag-item find-outfit delete-account`
- [ ] Verify wall fix: photograph a blank wall → expect 422 + in-app scan
      tips + no DB row; photograph a real shirt → expect 200 + normal save
- [ ] Test account deletion with a throwaway account
- [ ] `eas build -p ios --profile production` (buildNumber already bumped to 3)
- [ ] `eas submit -p ios`
- [ ] `eas build -p android --profile preview` (refresh the stale APK link)
- [ ] Screenshots at 6.7″ size: closet grid, outfit result with reasoning,
      add/tag flow, duplicate warning
- [ ] App Store Connect: paste listing copy, privacy labels, review notes +
      demo credentials, category/price
- [ ] Submit for review (1–3 day turnaround typical)
