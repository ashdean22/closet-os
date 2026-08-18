/**
 * Capsule's visual theme — "Atomic Age".
 *
 * Palette sampled from mid-century retro-futurist illustration: bone-white
 * concrete, burnt-orange awnings, teal sky, brass trim. Warm neutrals are
 * deliberate — clothing photographs read better against warm ground than
 * against the cool grey most apps default to.
 *
 * This file is the single source of truth. `tailwind.config.js` mirrors it for
 * className usage; import from here for inline `style` props (several call
 * sites use plain styles on purpose — see AuthScreen's submit button).
 */

export const colors = {
  // ── Grounds ──────────────────────────────────────────────────────────────
  /** App background — warm cream, the concrete of the reference art. */
  ground: "#F2E9DA",
  /** Cards and raised surfaces; sits lighter than the ground. */
  surface: "#FCF8F1",
  /** Inset surfaces — text inputs, wells, unselected segments. */
  sunken: "#EAE0CE",
  /** Hairlines and dividers. */
  edge: "#DCCDB4",

  // ── Ink ──────────────────────────────────────────────────────────────────
  /** Primary text — deep charcoal-teal, never pure black. */
  ink: "#1B333B",
  /** Secondary text, captions. */
  inkSoft: "#5A7078",
  /** Placeholders, disabled text, inactive tabs. */
  inkFaint: "#93A5AB",

  // ── Rust — primary action ────────────────────────────────────────────────
  rust: "#C0521F",
  rustDeep: "#9C4118",
  /** Disabled/loading state of a rust button. */
  rustMuted: "#DFA88A",
  /** Wash behind rust content. */
  rustTint: "#F7E2D4",

  // ── Teal — secondary / structure ─────────────────────────────────────────
  teal: "#2A6F84",
  tealDeep: "#1B4E5E",
  tealTint: "#DCEAEE",

  // ── Sky — accent ─────────────────────────────────────────────────────────
  sky: "#6FB4CC",
  skyTint: "#E3F0F5",

  // ── Brass — reserved for AI moments (tagging, outfit generation) ─────────
  brass: "#C9A05E",
  brassTint: "#F5EBD8",

  // ── Functional ───────────────────────────────────────────────────────────
  /** Errors — a rust-red that belongs to the palette, not Tailwind's red-600. */
  danger: "#B3402E",
  dangerTint: "#F9E3DE",
  dangerEdge: "#E8BFB6",
  /** Success — olive, from the reference art's terrain. */
  success: "#6B7A45",
  successTint: "#EDEFE0",
  /** Advisory callouts (possible duplicate, missing pieces) — brass, not alarm. */
  notice: "#8A6A2F",
  noticeTint: "#F5EBD8",
  noticeEdge: "#DFC894",

  white: "#FFFFFF",
} as const;

/**
 * Six distinct hues for category pills (top / bottom / shoes / …). Each is a
 * pale tint with matching dark ink, all drawn from the same muted family so a
 * row of pills reads as one set rather than a bag of highlighter colours.
 */
export const chips = {
  teal:  { tint: "#DCEAEE", ink: "#1B4E5E" },
  rust:  { tint: "#F7E2D4", ink: "#9C4118" },
  brass: { tint: "#F5EBD8", ink: "#7A5A22" },
  olive: { tint: "#EDEFE0", ink: "#4E5A31" },
  sky:   { tint: "#E3F0F5", ink: "#2A6F84" },
  plum:  { tint: "#EDE3E4", ink: "#6E4048" },
} as const;

export type ChipHue = keyof typeof chips;

/**
 * Font families. The string must match the key passed to `useFonts` in App.tsx.
 *
 * `display` (Fascinate Inline) has an inline stroke that fills in and turns to
 * mush below ~26px — wordmark and hero headings only. `deco` (Limelight) is the
 * workhorse for section headers and buttons. Body copy and form inputs stay on
 * the system face: Deco display types are period-correct but genuinely hard to
 * read in paragraphs, and unreadable forms lose signups.
 */
export const fonts = {
  display: "FascinateInline",
  deco: "Limelight",
} as const;

/** Letter-spacing that keeps Limelight from feeling cramped at small sizes. */
export const tracking = {
  deco: 0.5,
  decoWide: 1.5,
} as const;

export type ThemeColor = keyof typeof colors;
