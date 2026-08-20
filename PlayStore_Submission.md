# Capsule — Google Play Submission Package

Working doc for the Play Console listing. Copy is ready to paste; checklists
mark what only you can do. Field limits are Play's, not Apple's — the App
Store copy in `AppStore_Submission.md` doesn't fit here unmodified.

## Account setup (blocking — nothing else can start until this is done)

- [ ] Create the account at play.google.com/console, **$25 one-time**
- [ ] Choose **"Yourself"** (personal). Organization accounts skip the closed
      test below, but need a D-U-N-S number that can take 30 days to issue —
      slower than just running the test.
- [ ] Complete identity verification (government ID). Takes hours to days.
      This is the real starting gun.
- [ ] Create app: name `Capsule`, English (US), App, Free
- [ ] Create a Google Cloud service account and download the JSON key to
      `credentials/play-service-account.json` (gitignored). After that,
      `eas submit` runs unattended forever.

**The closed-test clock.** Personal accounts created after 13 Nov 2023 must
run a closed test with **12 testers opted in continuously for 14 days** before
applying for production access. The 14 days start only once Google approves
the first closed-testing release *and* 12 people have opted in — not when the
account is created. Budget 3–4 weeks to public launch.

- [ ] Collect 12 Gmail addresses (they must be Google accounts, and each
      person has to actually accept the opt-in link)

## Listing copy

**App name** (30 chars max):
`Capsule: Digital Closet` (23)

**Short description** (80 chars max) — this is the line shown in search
results, and Play indexes it:
`Outfits built from the clothes you already own. Photograph once, ask anytime.` (76)

**Full description** (4000 chars max) — Play indexes this for search, unlike
the App Store, so it's worth being a little more explicit about what it does:

> The clothes you actually wear are a fraction of what you own. The rest isn't
> bad — it's just out of sight, so it never makes the rotation, and "I have
> nothing to wear" ends up being cheaper to solve by buying something than by
> digging through the closet.
>
> Capsule is for getting more out of what's already hanging there.
>
> **Photograph once, and it tags itself**
> Take a photo of each piece and Capsule works out the colour, category,
> fabric, formality and season on its own. No forms, no dropdowns, no naming
> things. A closet of fifty pieces takes about twenty minutes, once.
>
> **Ask the way you'd say it out loud**
> "Smart casual dinner." "Something for a cold rainy Tuesday." "65 degrees and
> I have an interview." You get a full outfit built only from clothes you own,
> with a line on why each piece works — often a pairing you wouldn't have
> reached for, out of something you'd stopped seeing.
>
> **Style around one piece**
> Pick a jacket you want to wear and Capsule builds the rest of the outfit
> around it, instead of starting from scratch every time.
>
> **Browse the closet properly**
> Filter by type and colour, sort by newest, dressiness, or shade. It's a
> catalogue of what you own, which turns out to be useful on its own.
>
> **It'll tell you when you're repeating yourself**
> Add a piece close enough to something already in there and Capsule shows you
> both, side by side, before it joins the pile — so if you keep it, that's a
> decision instead of an accident.
>
> No ads. No shopping links. Nothing you have to buy first. Your closet stays
> yours.

**Category:** Lifestyle · **Tags:** Fashion, Shopping · **Price:** Free
**Contact email:** (your support address)
**Privacy policy:** https://ashdean22.github.io/closet-os/ (reused from iOS)

## Graphics required

| Asset | Spec | Status |
|---|---|---|
| App icon | 512×512 PNG, 32-bit, alpha allowed | derive from `assets/icon.png` |
| Feature graphic | 1024×500, JPG or 24-bit PNG, **no alpha** | to generate |
| Phone screenshots | 2–8, 9:16, 1080×1920 or larger | to capture on emulator |
| Tablet screenshots | not needed — `supportsTablet: false` | n/a |

## Data safety form

Play's version of Apple's privacy labels. Answers that match reality:

| Question | Answer |
|---|---|
| Does your app collect or share user data? | Yes |
| Is data encrypted in transit? | Yes (HTTPS/TLS everywhere) |
| Can users request deletion? | Yes — Settings → Delete Account (`delete-account` Edge Function) |
| **Personal info → Email address** | Collected, not shared. Required. Purpose: Account management |
| **Photos and videos → Photos** | Collected, not shared. Required. Purpose: App functionality |
| Data used for advertising? | No |
| Data used for tracking across apps? | No |
| Is data processed ephemerally? | No — photos and tags are stored |
| Third-party data processors | Supabase (storage/auth/DB), Anthropic and Google Gemini (image tagging and outfit generation). These are processors, not recipients — declare as "not shared" since the data isn't transferred for the third party's own use. |

## Photo & video permissions declaration

Triggered by `READ_MEDIA_IMAGES`. Justification to paste:

> Capsule's core function is building outfits from the user's own clothing.
> Users photograph garments with the camera or select existing photos of
> garments from their library; those images are the app's primary input and
> there is no alternative flow that delivers the feature. The app reads images
> only — it never writes to the media library.

Permissions the app deliberately does **not** request, worth knowing if
review asks: `RECORD_AUDIO` and `WRITE_EXTERNAL_STORAGE` are both removed from
the merged manifest (see `app.json` → `android.blockedPermissions` and
`microphonePermission: false`), even though expo-image-picker declares them by
default.

## Content rating questionnaire

Category: **Utility, Productivity, Communication, or Other**. Everything is
No — no violence, sexuality, profanity, drugs, gambling, or user-to-user
communication. There is no social feed and no way for users to see each
other's content. Expected outcome: **Everyone / PEGI 3**.

Note: the iOS listing is rated 17+, which was an over-cautious call. Nothing
in the app justifies it and it suppresses discovery. Worth correcting on both
stores.

## Target audience and content

- Target age group: **18+** (simplest — anything including under-13 triggers
  Families Policy requirements and a second review)
- Appeals to children: **No**
- Ads: **No**
- Contains news: **No**
- COVID-19 contact tracing: **No**
- Data safety, government app, financial features: **No**

## Release checklist

- [ ] App entry created in Play Console
- [ ] Service account key at `credentials/play-service-account.json`
- [ ] `eas build --platform android --profile production` (AAB, versionCode auto-increments)
- [ ] `eas submit --platform android --profile production` → internal track
- [ ] Promote internal → closed test, add 12 testers
- [ ] **Wait 14 days** with 12 testers opted in
- [ ] Apply for production access
- [ ] Promote to production

## Signing

EAS holds the upload keystore (`Build Credentials tyYxOa5Z35`), the same one
that signed the August 5 preview APK. Play Signing will bind to whatever key
signs the first upload, so the keystore must not be regenerated after that
point. Back it up: `eas credentials --platform android` → download keystore.
