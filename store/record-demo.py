"""Records a demo of Capsule running in the iOS simulator.

Screen points come from the Simulator window at (1122,46) size 390x840:
  screen_x = 1147.2 + 0.28*px_x,  screen_y = 124 + 0.2841*px_y
where px_* are pixels in the 1206x2622 capture.

Nothing here trusts a hard-coded y below the fold. The rationale card is three
to five lines depending on the look, so the buttons under it move; and momentum
scrolling keeps sliding for a beat after a drag ends. Earlier takes tapped a
letter of the heading, and once tapped Find My Outfit and kicked off a second
search on camera. So the buttons get located in a screenshot each time.
Screenshots taken mid-run do not show up in the recording.
"""
import signal, subprocess, sys, time
import cv2
import numpy as np

S = "/private/tmp/claude-501/-Users-ashdean-closet-os/2b031ceb-6843-408f-ba5b-51cceb7c88d9/scratchpad"
CLICK = "/usr/local/bin/cliclick"
OUT = sys.argv[1]
RUST = np.array([31, 82, 192])          # #C0521F in BGR

TAB_CLOSET = (1273, 821)
TAB_OUTFIT = (1357, 821)
FIELD      = (1317, 384)
FIND       = (1317, 435)
SEG_SAVED  = (1389, 264)
NEXT_BELOW_SAVE = 49                     # screen px from Save to the next-look button

SHOT = f"{S}/_chk.png"

def shot():
    subprocess.run(["xcrun", "simctl", "io", "booted", "screenshot", SHOT], capture_output=True)
    return cv2.imread(SHOT)

def ocr():
    """Recognised text from the last screenshot, as (text, x, y) in capture
    pixels. Colour probes cannot tell "Show me the next look" from "Style
    something new", and every geometric guess at the LOOK bar produced false
    positives off the rationale text. Vision reads the label."""
    out = subprocess.run([f"{S}/ocrbin", SHOT], capture_output=True, text=True).stdout
    rows = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) == 3:
            rows.append((parts[0], int(parts[1]), int(parts[2])))
    return rows

def look_bar_y():
    """Pixel y of the LOOK n OF m row, once the other looks have arrived."""
    for text, _, y in ocr():
        if text.upper().startswith("LOOK ") and " OF " in text.upper():
            return y
    return None

def rust_mask(img, y0, y1):
    d = np.abs(img.astype(int) - RUST).sum(axis=2)
    m = np.zeros(d.shape, np.uint8)
    m[d < 70] = 255
    m[:y0, :] = 0
    m[y1:, :] = 0
    return m

def find_save(img):
    """The full-width rust Save button, wherever the rationale left it."""
    n, _, stats, cents = cv2.connectedComponentsWithStats(rust_mask(img, 1200, 2380), 8)
    best = None
    for i in range(1, n):
        _, _, w, h, area = stats[i]
        if w > 800 and 60 < h < 160 and (best is None or area > stats[best][4]):
            best = i
    if best is None:
        return None
    cx, cy = cents[best]
    return round(1147.2 + 0.28 * cx), round(124 + 0.2841 * cy)

def on_outfit_tab(img):
    band = img[2380:2500, 700:810].astype(int)
    return int((np.abs(band - RUST).sum(axis=2) < 40).sum()) > 200

def result_ready(img):
    """Find My Outfit goes sunken and reads "Styling…" while the call is out."""
    b, g, r = (int(v) for v in img[1094, 607])
    return abs(b - 31) < 26 and abs(g - 82) < 26 and abs(r - 192) < 26

def tap(pt, pause=1.0):
    subprocess.run([CLICK, f"c:{pt[0]},{pt[1]}"], check=True)
    time.sleep(pause)

def type_text(text, pause=1.0):
    subprocess.run([CLICK, "-w", "45", f"t:{text}"], check=True)
    time.sleep(pause)

def drag(points, pause=1.2):
    subprocess.run([CLICK] + points, check=True)
    time.sleep(pause)

# The drag corridor is the left margin: dragging over a garment card opens that
# item's zoom sheet instead of scrolling.
DOWN = ["dd:1180,720", "m:1180,650", "m:1180,560", "m:1180,470", "du:1180,420"]
UP   = ["dd:1180,430", "m:1180,500", "m:1180,600", "m:1180,700", "du:1180,745"]

rec = subprocess.Popen(
    ["xcrun", "simctl", "io", "booted", "recordVideo", "--codec", "h264", "-f", OUT],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)

def finish(note):
    rec.send_signal(signal.SIGINT)
    rec.wait(timeout=30)
    print(note)
    sys.exit(0 if note.startswith("recorded") else 1)

time.sleep(2.0)
time.sleep(3.5)                                  # the closet, held still

for _ in range(3):                               # to the stylist
    tap(TAB_OUTFIT, 1.6)
    if on_outfit_tab(shot()):
        break
else:
    finish("FAILED: never reached the Outfit tab")

tap(FIELD, 0.7)
type_text("dinner out, chilly evening", 1.4)
tap(FIND, 9.0)

for _ in range(14):                              # spinner stages play out here
    if result_ready(shot()):
        break
    time.sleep(1.2)
else:
    finish("FAILED: no outfit came back")

time.sleep(0.8)
drag(DOWN, 2.0)                                  # the pieces and the reasons
# Wait for looks 2 and 3 to arrive before touching the next-look button:
# tapping it early fires a fresh server call instead of the instant local swap
# this is meant to show. The bar is the proof they landed.
bar_y = None
for _ in range(26):
    shot()
    bar_y = look_bar_y()
    if bar_y is not None:
        break
    time.sleep(1.0)
time.sleep(1.5)

for dwell in (3.8, 3.4):                         # flick through them
    shot()
    bar_y = look_bar_y()
    if bar_y is None:
        break
    # The right chevron sits at x=799 in the capture, on the bar's own row.
    tap((round(1147.2 + 0.28 * 799), round(124 + 0.2841 * bar_y)), dwell)

save = find_save(shot())
if save:
    tap(save, 2.6)

drag(UP, 1.2)
tap(SEG_SAVED, 4.5)                              # the saved list
finish(f"recorded -> {OUT}")
