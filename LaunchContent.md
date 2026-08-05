# Capsule — Launch Content

Copy for the Week 2 launch push. Post the LinkedIn one **only after the app is
approved and live** — it claims availability in the first two lines.

## LinkedIn launch post

Native video upload (the 30–60s demo). Links go in the first comment, not the
post body — LinkedIn suppresses reach on posts with outbound links.

---

I kept buying the same white polo. I own four.

So I built Capsule: photograph your closet once, then ask for an outfit in
plain English and get one back, assembled only from clothes you already own,
with a reason for every piece. It's free on the App Store.

The build was less glamorous than the demo.

The vision model went through a phase of confidently tagging a blank wall as a
garment — high confidence, full attribute list, entirely imaginary. Twice I
"fixed" a bug that stayed broken because I never actually deployed the fix. A
screen went white in front of a tester and the only clue was an error message
that read, in full, "Error."

Each of those cost me an evening. Each of them taught me something no tutorial
had.

What it does: photo → automatic tagging → semantic search across your own
wardrobe → an outfit with reasoning. It also flags near-duplicates when you add
something you basically already own, which is the feature I built for myself.

What it doesn't do: give you taste. It won't make you dress better. It'll stop
you buying the fifth polo.

Solo build. Claude for vision and styling, Gemini for embeddings, Postgres with
pgvector for search, Supabase on the backend, React Native on the front.

Links in the comments. If you try it and it does something dumb, tell me — I'd
rather hear it from you than read it in a one-star review.

---

**First comment:** App Store link · GitHub repo · Android APK

## Short-form video hook (TikTok / Reels / Shorts)

Open on the closet, deadpan: *"I own four white polos. I did not do that on
purpose."* Then the app: photograph a piece, tags appear, ask for "smart casual
dinner," outfit comes back with reasoning. Close on the duplicate warning
firing: *"This is the part that would've saved me three polos."*

Keep it under 45 seconds. No music bed louder than your voice.

## Reddit (r/malefashionadvice, capsule-wardrobe, build-in-public)

Post as a story, not an ad. Lead with the problem and the number (four polos),
describe what you built in two sentences, be explicit that it's free with no
ads, and ask a real question — what would you want it to do that it doesn't?
Link only if the subreddit allows it; otherwise let people ask.
