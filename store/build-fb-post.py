S = "/private/tmp/claude-501/-Users-ashdean-closet-os/2b031ceb-6843-408f-ba5b-51cceb7c88d9/scratchpad"
mark = open(f"{S}/mark.b64").read().strip()
# A raster QR, not the SVG path the print flyer uses. At the size a feed card
# can spare, the stroked SVG rendered too thin to decode — verified by decoding
# the finished PNG, which is the only test that counts.
qr = open(f"{S}/qr.b64").read().strip()

# 16 rays on an ellipse, alternating long/short — the same starburst the sign-in
# screen draws, ported from AuthScreen's Sunburst().
rays = []
import math
RX, RY, N = 132, 158, 16
for i in range(N):
    deg = 360 / N * i
    rad = math.radians(deg)
    h = 38 if i % 2 == 0 else 20
    x = RX * math.sin(rad)
    y = -RY * math.cos(rad)
    rays.append(
        f'<i style="height:{h}px;transform:translate({x:.1f}px,{y:.1f}px) rotate({deg:.0f}deg)"></i>'
    )
rays = "\n        ".join(rays)

def render(height, deck_gap, pad_bottom, k, qr_px, store_pad):
  html = f"""<title>Capsule Facebook Post</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Limelight&family=Jost:wght@300;400;500;600&display=swap">
<style>
  /* Capsule "Atomic Age" tokens, mirrored from lib/theme.ts. A social card is a
     fixed artifact like a print piece: every colour is painted explicitly and
     the page never follows the viewer's theme. */
  :root {{
    --ground:  #F2E9DA;
    --surface: #FCF8F1;
    --ink:     #1B333B;
    --rust:    #C0521F;
    --teal:    #2A6F84;
    --teal-deep:#1B4E5E;
    --brass:   #C9A05E;
    --sky:     #6FB4CC;
  }}

  * {{ box-sizing: border-box; }}
  html, body {{ margin: 0; background: var(--teal-deep); }}
  body {{
    font-family: "Jost", "Avenir Next", "Segoe UI", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }}

  /* 1080 x 1080 — Facebook's square feed slot, the one that keeps its full
     height on mobile instead of being cropped to a letterbox. */
  .card {{
    width: 1080px;
    height: {height}px;
    position: relative;
    overflow: hidden;
    background:
      radial-gradient(120% 90% at 50% 0%, #23617553 0%, #1B4E5E00 60%),
      var(--teal-deep);
    color: var(--ground);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    padding: {deck_gap}px 78px {pad_bottom}px;
    text-align: center;
  }}

  /* Brass keyline, the app's own trim. */
  .card::after {{
    content: "";
    position: absolute;
    inset: 26px;
    border: 1px solid #C9A05E4D;
    pointer-events: none;
  }}

  /* ── Lockup ─────────────────────────────────────────────────────────── */
  .lockup {{ position: relative; width: 360px; height: 372px; display: grid; place-items: center; }}
  .rays {{ position: absolute; inset: 0; display: grid; place-items: center; opacity: .45; }}
  .rays i {{ position: absolute; width: 2px; background: var(--brass); display: block; }}
  .mark {{
    width: 148px;
    height: 220px;
    background-color: var(--ground);
    -webkit-mask-image: url(data:image/png;base64,{mark});
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-position: center;
    -webkit-mask-size: contain;
  }}

  .wordmark {{
    font-family: "Limelight", "Jost", serif;
    font-size: 104px;
    line-height: .92;
    letter-spacing: .01em;
    margin-top: -6px;
    color: var(--ground);
  }}
  .tagline {{
    margin-top: 16px;
    font-size: 20px;
    font-weight: 500;
    letter-spacing: .34em;
    text-transform: uppercase;
    color: var(--brass);
  }}
  .rule {{
    /* flex: none — the card is a column flex container and a 2px child is the
       first thing it shrinks to nothing when the content runs tall. */
    flex: none;
    width: 340px;
    height: 2px;
    margin: 30px 0 26px;
    background: linear-gradient(90deg, #C9A05E00, #C9A05E 25%, #C9A05E 75%, #C9A05E00);
  }}

  /* ── Pitch ──────────────────────────────────────────────────────────── */
  .deck {{
    font-size: 34px;
    font-weight: 300;
    line-height: 1.34;
    max-width: 760px;
    margin: 0;
  }}
  .deck b {{ font-weight: 500; color: #FFF6E6; }}

  .points {{
    list-style: none;
    margin: 34px 0 0;
    padding: 0;
    display: inline-flex;
    flex-direction: column;
    gap: 15px;
    font-size: 24px;
    font-weight: 300;
    color: #DCEAEE;
  }}
  .points li {{ display: flex; align-items: baseline; gap: 14px; text-align: left; }}
  .points span {{ color: var(--brass); font-size: 15px; line-height: 1; }}
  .points em {{ font-style: italic; color: var(--sky); }}

  .free {{
    margin-top: 34px;
    display: inline-flex;
    align-items: center;
    gap: 14px;
    background: var(--rust);
    color: var(--ground);
    font-size: 21px;
    font-weight: 600;
    letter-spacing: .2em;
    text-transform: uppercase;
    padding: 14px 30px;
  }}

  /* ── Store bar ──────────────────────────────────────────────────────── */
  .group {{ display: flex; flex-direction: column; align-items: center; zoom: {k}; }}

  .store {{
    width: 100%;
    display: flex;
    align-items: center;
    gap: 28px;
    background: #16414F;
    border: 1px solid #C9A05E40;
    padding: {store_pad}px 28px;
    text-align: left;
  }}
  .qr {{ width: {qr_px}px; height: {qr_px}px; background: var(--surface); padding: 8px; flex: none; }}
  .qr img {{ width: 100%; height: 100%; display: block; image-rendering: pixelated; }}
  .store h2 {{
    margin: 0;
    font-size: 30px;
    font-weight: 500;
    letter-spacing: .01em;
    color: var(--ground);
  }}
  .store .url {{
    margin: 5px 0 0;
    font-size: 19px;
    font-weight: 300;
    color: var(--sky);
    letter-spacing: .02em;
  }}
  .store .joke {{
    margin: 12px 0 0;
    font-size: 19px;
    font-weight: 300;
    line-height: 1.34;
    color: #B4CBD2;
  }}
  .store .joke b {{ color: var(--brass); font-weight: 500; }}
</style>

<div class="card">
  <div class="group">
  <div class="lockup">
    <div class="rays">
        {rays}
    </div>
    <div class="mark"></div>
  </div>

  <div class="wordmark">Capsule</div>
  <div class="tagline">Digital Closet</div>
  <div class="rule"></div>
  </div>

  <div class="group">

  <p class="deck">
    It keeps track of <b>every piece you own</b> &mdash; then builds the outfit
    for wherever you&rsquo;re going.
  </p>

  <ul class="points">
    <li><span>&#9670;</span>Photograph each piece once. It tags them for you.</li>
    <li><span>&#9670;</span>Tell it the day: <em>&ldquo;65&deg; and rainy, job interview.&rdquo;</em></li>
    <li><span>&#9670;</span>Get a full look, built from clothes you already own.</li>
  </ul>

  <div class="free">Free &middot; No ads &middot; Nothing to buy</div>
  </div>

  <div class="store">
    <div class="qr">
      <img src="data:image/png;base64,{qr}" alt="QR code linking to Capsule Digital Closet on the App Store">
    </div>
    <div>
      <h2>On the App Store &mdash; iPhone only</h2>
      <p class="url">apps.apple.com/app/id6778641801</p>
      <p class="joke"><b>Android:</b> you are not being ignored, you are being
        queued.<br>Borrow a friend&rsquo;s iPhone in the meantime.</p>
    </div>
  </div>
</div>
"""
  return html

# The square is the tighter crop: the same artwork drawn a little smaller so
# the store bar clears the bottom edge.
for name, height, pad, pad_b, k, qr_px, store_pad in (
    ("fb-post", 1080, 46, 40, 0.90, 170, 20),
    ("fb-post-tall", 1350, 92, 56, 1.0, 186, 24),
):
    out = f"/Users/ashdean/closet-os/store/{name}.html"
    open(out, "w").write(render(height, pad, pad_b, k, qr_px, store_pad))
    print("wrote", out)
