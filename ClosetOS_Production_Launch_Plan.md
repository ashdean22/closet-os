# Closet OS — Production & Launch Plan

From TestFlight beta to App Store launch and a lucrative project

*Ashton Dean · Reference document · ~4-week horizon · Updated July 2026*

# 1. Where We Are vs. Where We're Going

## Current state (done)

- Full image-RAG pipeline live: photo → Claude Vision auto-tags → Gemini
  embedding (gemini-embedding-001, 768-dim) → pgvector semantic search →
  Claude assembles outfits from owned items only (tool-use,
  anti-hallucination).

- Auth + Row Level Security; per-user data isolation verified with a
  second account, including scoped outfit search.

- Duplicate detection via cosine similarity (threshold tuned on real
  data: true dupes 94–95%, similar-but-different 85%).

- Distribution: Expo Go demo (EAS Update), Android APK install link,
  TestFlight build 2 approved for public beta.

- GitHub repo public with portfolio README; privacy policy hosted on
  GitHub Pages; demo video recorded.

- Bug fixes from first tester round: Outfit-screen white crash (error
  boundary + defensive rendering), honest tag-item error taxonomy
  (413/415/422/429/502/504 with machine-readable reasons), refresh-token
  noise handled.

## Open items (in flight)

- Blank-wall over-detection: decision-first prompt + fail-closed gate
  written; MUST deploy (supabase functions deploy tag-item) and verify
  422 + \[tag-item\] result log.

- Tester polish list: friendlier unregistered-sign-in message, manual
  tag editing, log-out moved to Settings/Account, visible scan tips.

- Android APK is stale (still contains wear-tracking) — rebuild before
  sharing widely.

## End goal (the definition of done for this phase)

- Live, free App Store listing (plus Google Play later if traction) with
  a differentiated pitch: outfits with reasoning + “stop re-buying what
  you own.”

- A launch content push (LinkedIn, short-form video, Reddit) driving the
  first 100+ real users.

- Cost-guarded backend (per-user daily caps) so strangers can't drain
  API credits.

- Monetization groundwork installed: free-tier limits + paywall
  scaffolding (RevenueCat), even if paid tier launches later.

- A Path-3 services pitch (see Section 6) using the live app as proof,
  targeted at boutiques/resellers/agencies — the fastest realistic
  revenue.

|                |                                                                |
|----------------|----------------------------------------------------------------|
| **Dimension**  | **Target**                                                     |
| App status     | Approved + live on the App Store, no known launch blockers     |
| Users          | First 100 real users; 5+ pieces of actionable feedback         |
| Cost safety    | Hard per-user daily caps on tag-item and find-outfit           |
| Revenue motion | Freemium scaffold in app + one services pitch sent per week    |
| Career asset   | Listing link + demo video + case study on portfolio and resume |

# 2. Week 1 — Ship It

*Objective: clear every App Store blocker and submit for review.
Everything else waits.*

## 2.1 Verify the wall fix (30 min)

- [ ] Run: supabase functions deploy tag-item

- [ ] Photograph a blank wall → expect 422 in Invocations, \[tag-item\]
result log line, rejection message in app, no DB row

- [ ] Photograph a real shirt → expect 200 and normal save (confirm the
stricter prompt didn't over-reject)

## 2.2 Tester polish batch

**Claude Code prompt — polish batch:**

```
Use rn-builder. Four UX improvements from tester feedback: 1. Sign-in: when
auth fails because the account doesn't exist, show "No account found for this
email — tap Sign Up to create one" instead of the generic invalid-credentials
message. Keep the generic message for a wrong password on an existing account
(don't leak which emails exist to an attacker — if Supabase doesn't
distinguish, add a friendly hint that covers both: "Check your password, or
sign up if you're new"). 2. Manual tag editing: on the Item Detail view, make
ALL tags editable (category via a picker with our enum values;
color/formality/season/ material as editable fields). Save updates to
Supabase. Add a code comment noting edits are future fine-tuning training
data. 3. Move the Log Out button off the Closet screen into a new lightweight
Settings/Account screen (show the signed-in email, Log Out, Delete Account
placeholder, app version, links to privacy policy). 4. Make the scan tip more
visible: show the lighting/framing tip in the error state when tag-item
returns no_item (black text, larger font), and keep the small pre-scan hint.
Tell me how to test each.
```


## 2.3 Account deletion (Apple requirement — likely rejection if missing)

**Claude Code prompt — account deletion:**

```
Apple requires in-app account deletion for apps with account creation.
Implement it end-to-end: 1. Add a "Delete Account" action on the Settings
screen with a serious confirm dialog ("This permanently deletes your account,
items, and photos. This cannot be undone."). 2. Create an Edge Function
delete-account that verifies the caller's JWT, then deletes: all their rows in
items, all their images in the wardrobe-items bucket, and finally the auth
user (admin API, service role key from secrets — never in the app). 3. Client:
on success, sign out locally and return to the auth screen. 4. Handle
partial-failure gracefully (retry guidance, never a white screen). 5. Give me
the deploy command, and tell me how to test with a throwaway account.
```


## 2.4 Cost guardrails (before strangers use it)

**Claude Code prompt — API caps:**

```
Add cost guardrails to protect Anthropic/Gemini spend: 1. In tag-item and
find-outfit, enforce per-user daily limits (30 tags, 20 outfit queries per
day) tracked in a small usage table keyed by user_id + date. Over the limit,
return 429 with reason "daily_limit" and a friendly message; the app should
show "You've hit today's limit — resets tomorrow." 2. Confirm no retry loop
anywhere can call Claude repeatedly on failure. 3. Deploy both functions and
tell me how to verify the cap triggers.
```


## 2.5 App Store submission package

- [ ] Rebuild + submit: eas build -p ios --profile production, then eas
submit -p ios (bump buildNumber)

- [ ] Also rebuild Android APK so the share link matches current code: eas
build -p android --profile preview

- [ ] Screenshots: closet grid, outfit result with reasoning, add/tag flow,
duplicate warning (6.7″ iPhone size minimum)

- [ ] App Privacy labels: email (account), photos (user content), user
content linked to identity — match reality exactly

- [ ] App Review Information: demo account credentials (populated closet),
notes for reviewer

- [ ] Category: Lifestyle. Price: Free. Export compliance: standard HTTPS
exemption

- [ ] Submit for review (typical turnaround 1–3 days)

**Claude Code prompt — listing copy (optional assist):**

```
Draft App Store listing copy for Closet OS: 1. App name + subtitle (30 chars)
emphasizing "AI outfits from clothes you own" and "stop re-buying duplicates".
2. A 3-paragraph description: the problem, how it works (photograph once, ask
in plain English, get an outfit with reasoning), the duplicate- detection
savings angle. No competitor names, no unverifiable claims. 3. 100-char
keyword string: wardrobe, closet, outfit, AI stylist, capsule, etc. —
comma-separated, no spaces after commas, no duplicates of words already in the
name/subtitle.
```


# 3. Week 2 — Launch Loop

*Objective: release, tell the world, and fix only what real users hit.*

- [ ] Release the approved build (manual release the morning you're ready to
post)

- [ ] Publish the LinkedIn launch post (native video upload, links in first
comment: App Store, GitHub, Android APK)

- [ ] Post a 30–60s vertical demo to TikTok/Reels/Shorts — hook: “I kept
re-buying the same shirt, so I built an AI for my closet”

- [ ] Share to 1–2 relevant subreddits (r/malefashionadvice,
capsule-wardrobe or BuildInPublic communities) — as a story, not an ad

- [ ] Daily: check Supabase Edge Function logs + TestFlight/App Store
feedback; keep a running issue list

- [ ] Fix ONE top recurring issue this week — resist rebuilding anything

*Rule of thumb for this week: distribution over development. A day spent
posting the demo where your niche hangs out beats a day of speculative
features.*

## Ongoing update flow (memorize this)

|                                                |                                                                                                      |
|------------------------------------------------|------------------------------------------------------------------------------------------------------|
| **Change type**                                | **How to ship it**                                                                                   |
| JS-only change (UI, logic)                     | eas update --branch preview (Expo Go) + resubmit NOT required; production OTA per your update config |
| Native change (permissions, new native module) | eas build → eas submit → App Review again                                                            |
| Edge Function change                           | supabase functions deploy \<name\> — local edits are NOT live until deployed                         |
| DB schema change                               | migration + supabase db push; grep app & RPCs for dropped columns first                              |

# 4. Week 3 — Differentiate

*Objective: build the two features that attack the incumbents'
documented weakness (context-aware styling) and your unique angle (money
saved).*

## 4.1 Weather-aware outfits (zero-typing daily use)

**Claude Code prompt — weather context:**

```
Add automatic weather context to outfit queries: 1. Use expo-location to get
coarse location (ask permission with a clear string; degrade gracefully if
denied — the feature is optional). 2. Fetch current conditions + today's
high/low from Open-Meteo (free, no API key) in the find-outfit request path —
do it in the Edge Function so the logic is server-side and cacheable per city
per hour. 3. Inject weather into the outfit prompt ("66°F, light rain") so
queries like "what should I wear today" work with zero extra typing. 4. Add a
one-tap "Today's outfit" button on the Outfit screen that sends that query
automatically. Show the weather used in the result header. 5. Add
NSLocationWhenInUseUsageDescription to app config (this is a NATIVE change —
flag that it needs a new eas build, not just an update).
```


4.2 “Money saved” duplicate counter (your headline differentiator)

**Claude Code prompt — savings counter:**

```
Turn duplicate detection into a visible money-saved story: 1. When the
duplicate warning fires and the user chooses to DELETE the new item (i.e.,
they kept what they owned), log an event in a dupes_avoided table (user_id,
matched_item_id, created_at, est_value). 2. Estimate est_value with a small
Claude call from the item's category/ description (median replacement price,
conservative). Cache per category to avoid repeated calls. 3. Show a running
"You've avoided re-buying ~\$X" total on the Closet screen header — tasteful,
not gamified. 4. Keep it honest: label it as an estimate.
```


## 4.3 Nice-to-haves if time remains (in priority order)

- Background removal on item photos (parity feature every incumbent has)
  — try an open-source segmentation model via Replicate or a free-tier
  API; keep original photo as fallback.

- App icon / logo refresh + splash screen; check App Store for name
  collisions on “Closet OS” and shortlist alternates.

- Onboarding: first item added within 60 seconds of first open
  (skip-able 3-screen intro, camera opens on first CTA).

# 5. Week 4 — Monetization Groundwork

*Objective: install the freemium scaffold and start the services pitch
loop. Revenue follows distribution, so keep posting.*

## 5.1 Free-tier limits + paywall scaffold

**Claude Code prompt — freemium scaffold:**

```
Implement freemium limits with RevenueCat (free tier of their SDK): 1. Free
tier: 20 closet items max, 3 outfit queries/day. Pro (later): unlimited items
+ queries. Enforce limits SERVER-SIDE in the Edge Functions (client checks are
cosmetic only). 2. Integrate react-native-purchases; configure a single "Pro"
entitlement. Products will be created in App Store Connect later — code
against the entitlement, feature-flag the paywall OFF by default. 3. Build a
simple paywall screen (what Pro unlocks, monthly price placeholder \$3.99,
restore purchases button). 4. When a free user hits a limit, show a friendly
explainer with the paywall behind a flag — for launch, just show "limits reset
daily". 5. This adds a native module — flag that it needs a new eas build.
```


*Why flag-off at launch: you want usage data and reviews first. Turning
on payments in week 8+ with real retention data beats charging on day
one to zero users.*

## 5.2 The Path-3 services pitch (fastest real money)

The pipeline you built (photo → vision tagging → embeddings → semantic
search) is a paid service for businesses with visual inventory. The app
is your proof-of-work.

- Targets: consignment/thrift stores (auto-tag listings), boutiques
  (visual “find similar” search), e-commerce agencies (white-label
  capability), resellers (photo → tags → draft listing).

- Offer: “I build AI-powered tagging/search on your inventory in 2–3
  weeks. Live demo: \[App Store link\].” Anchor pricing at
  \$2–10K/project depending on scope.

- Cadence: one tailored pitch per week minimum — local businesses first
  (walk in with the app on your phone), then agencies via LinkedIn.

- Reuse your Outlander lead-gen skills: your own n8n + Serper workflow
  can build the prospect list of boutiques/consignment stores in
  Virginia. Your GTM stack, pointed at yourself.

**Claude Code prompt — pitch one-pager:**

```
Create a one-page pitch document (markdown, I'll convert) titled "AI Inventory
Tagging & Visual Search — built and shipped": 1. Problem framing for a
boutique/consignment owner (hours spent tagging, customers can't find similar
items). 2. What I deliver: photograph inventory once → auto-tags
(color/category/ condition) → searchable by meaning → optional "similar items"
on their site. Timeline 2–3 weeks. 3. Proof: Closet OS on the App Store — same
pipeline, live. Include the architecture in one sentence + the demo video
link. 4. Simple pricing table: Starter (tagging only), Standard (+search),
Custom (integration). Leave numbers as placeholders for me. 5. Contact block.
Tone: plain, confident, zero hype.
```


# 6. Money: The Three Paths (and honest odds)

|                    |                                                                                                  |                                                                                                                                                                                          |
|--------------------|--------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Path**           | **What it looks like**                                                                           | **Honest expectation**                                                                                                                                                                   |
| 1. Freemium app   | Free tier + \$3.99/mo Pro; App Store distribution; organic content marketing                     | Slow. Crowded market (\$4.99–\$9.99 incumbents). Hundreds/mo at small scale is a good outcome. Do NOT buy ads until conversion is proven — installs cost \$1–4 and mostly don't convert. |
| 2. Niche version  | Same app aimed at one audience: men-only, college students, travel capsules, or thrift resellers | Better odds than Path 1. Resellers are the strongest niche — tagging saves them listing time, a utility purchase. Validate with 5 conversations before building.                         |
| 3. Sell the skill | \$2–10K projects building this pipeline on business inventories; app = credibility               | Fastest and most reliable. Aligns with your agency work and GTM skills. One closed project beats a year of app revenue at this stage.                                                    |

**Recommended posture:** launch free (Path 1 scaffold installed but
flag-off), actively pitch Path 3 weekly, and validate Path 2 through
user feedback. The app's guaranteed return is career capital — every
path above is upside on top of that floor.

## On ads, specifically

- Showing ads in-app: needs tens of thousands of active users to earn
  meaningful revenue — not your stage.

- Running ads to get users: costs money per install and loses money
  until your free→paid conversion rate is proven. Revisit only after
  organic traction and a working paywall.

- Free distribution that actually works now: short-form video demos,
  Reddit/community storytelling, LinkedIn build-in-public, and App Store
  search optimization (your AEO skill applied to ASO).

# 7. Decision Points & Metrics

|                |                                                                                                                                                       |
|----------------|-------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Checkpoint** | **Decide**                                                                                                                                            |
| End of Week 2  | Did 50+ people try it? If organic posts got zero traction, iterate the hook/video before building more features.                                      |
| End of Week 4  | Any Path-3 replies/meetings? If yes, prioritize closing one project over app features.                                                                |
| Week 8         | Retention check: do users return weekly? If yes, turn the paywall flag ON. If no, the paywall won't save it — fix retention or double down on Path 3. |
| Anytime        | A company/person offers money for the app or a custom build → that conversation outranks everything on this plan.                                     |

Track weekly (a simple spreadsheet is fine): downloads, signups, items
added per user, outfit queries per user, D7 return rate, API spend,
pitches sent, pitch replies.

# 8. Quick Reference

## Commands cheat sheet

```
\# Deploy an Edge Function (local edits are NOT live until this runs) supabase
functions deploy tag-item \# Apply DB migrations supabase db push \# Update
the Expo Go demo (JS only) eas update --branch preview \# New iOS production
build + submit eas build -p ios --profile production eas submit -p ios \#
Fresh Android APK share link eas build -p android --profile preview \# Check
env vars / secrets eas env:list supabase secrets list
```


## Debug playbook (learned the hard way this project)

- “My fix didn't work” → first check it was DEPLOYED (functions deploy /
  db push / eas update). Happened twice.

- White screen in RN → a render crash; reproduce with npx expo start and
  read the Metro error. Guard every field from API responses; keep error
  boundaries.

- Generic errors lie → always unwrap the real HTTP status/body
  (FunctionsHttpError.context). Make functions return machine-readable
  reasons.

- Works in Expo Go ≠ works in the native build —
  permissions/Info.plist/env vars only prove out in the real binary via
  TestFlight.

- Prompt changes are empirical — verify against the live model with
  logging, never by inspection.

- Query and stored embeddings must match exactly: same model, same
  dimensions (gemini-embedding-001 @ 768), everywhere.

## Principles for every future app

- Ship vertical slices — end every work session with something that runs
  end-to-end.

- Server-side keys, RLS from day one, fail-closed gates on anything a
  model decides.

- Design a data flywheel: user corrections (tag edits) become training
  data.

- The demo video and README are products — most evaluators only ever see
  those.

- Decide the distribution channel before the final build; each channel
  has different rules.

- Pick projects where the worst case is still a win (career capital
  floor, revenue upside).
