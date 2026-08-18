/**
 * Shared wardrobe vocabulary: the tag values tag-item can produce, the
 * human-facing labels for them, and the sorting/grouping helpers the closet
 * filters are built on.
 *
 * Kept in one place because ClosetScreen, the filter bar, and the outfit
 * anchor picker all need the same buckets — and because colour arrives as free
 * text from the vision model, so the normalisation has to be identical
 * everywhere or the same jumper lands in two different groups.
 */

// ── Categories ────────────────────────────────────────────────────────────────
// Mirrors the `category` enum in supabase/functions/tag-item/index.ts.

export const CATEGORIES = [
  "top",
  "bottom",
  "outerwear",
  "shoes",
  "accessory",
  "dress",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  top: "Tops",
  bottom: "Bottoms",
  outerwear: "Outerwear",
  shoes: "Shoes",
  accessory: "Accessories",
  dress: "Dresses",
  other: "Other",
};

// Note: items still carry a `season` tag, and the stylist uses it when
// building outfits. It is simply not offered as a closet filter — browsing by
// season proved less useful than by type or colour.

// ── Formality ─────────────────────────────────────────────────────────────────

export const FORMALITIES = [
  "athletic",
  "casual",
  "smart-casual",
  "business",
  "formal",
] as const;

export type Formality = (typeof FORMALITIES)[number];

/** Dressed-up ordering for the formality sort; lower is more casual. */
const FORMALITY_RANK: Record<string, number> = {
  athletic: 0,
  casual: 1,
  "smart-casual": 2,
  business: 3,
  formal: 4,
};

// ── Colour buckets ────────────────────────────────────────────────────────────
// The vision model writes free text ("navy blue", "off-white", "charcoal
// grey"), so grouping by the raw string would produce a bucket per item. These
// are deliberately coarse — close enough to be useful for browsing, and never
// presented as an exact colour reading.

export const COLOR_BUCKETS = [
  "black",
  "white",
  "grey",
  "beige",
  "brown",
  "navy",
  "blue",
  "green",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple",
  "multi",
  "unknown",
] as const;

export type ColorBucket = (typeof COLOR_BUCKETS)[number];

export const COLOR_LABELS: Record<ColorBucket, string> = {
  black: "Black",
  white: "White",
  grey: "Grey",
  beige: "Beige / Tan",
  brown: "Brown",
  navy: "Navy",
  blue: "Blue",
  green: "Green",
  yellow: "Yellow",
  orange: "Orange",
  red: "Red",
  pink: "Pink",
  purple: "Purple",
  multi: "Multi",
  unknown: "Untagged",
};

/** Swatch colours for the filter chips. Representative, not exact. */
export const COLOR_SWATCHES: Record<ColorBucket, string> = {
  black: "#111827",
  white: "#f9fafb",
  grey: "#9ca3af",
  beige: "#d6c3a5",
  brown: "#8b5e3c",
  navy: "#1e3a5f",
  blue: "#3b82f6",
  green: "#4d7c4d",
  yellow: "#eab308",
  orange: "#f97316",
  red: "#dc2626",
  pink: "#ec4899",
  purple: "#8b5cf6",
  multi: "#a3a3a3",
  unknown: "#e5e7eb",
};

/**
 * Ordered longest-specific-first: "navy" must be tested before "blue" or every
 * navy item lands in the blue bucket, and "off-white" before "white" would be
 * redundant since the substring already matches.
 */
const COLOR_PATTERNS: [ColorBucket, string[]][] = [
  ["multi", ["multi", "pattern", "print", "floral", "stripe", "plaid", "check", "camo"]],
  ["black", ["black", "jet", "onyx", "ebony"]],
  ["white", ["white", "ivory", "snow"]],
  ["grey", ["grey", "gray", "charcoal", "slate", "silver", "ash", "graphite"]],
  ["beige", ["beige", "tan", "khaki", "camel", "sand", "taupe", "cream", "oatmeal", "nude", "stone", "ecru"]],
  ["brown", ["brown", "chocolate", "espresso", "mocha", "chestnut", "cognac", "walnut", "coffee"]],
  ["navy", ["navy"]],
  ["blue", ["blue", "denim", "cobalt", "azure", "sky", "cerulean", "periwinkle", "aqua"]],
  ["green", ["green", "olive", "sage", "mint", "emerald", "forest", "teal", "moss", "hunter"]],
  ["yellow", ["yellow", "mustard", "gold", "lemon", "butter"]],
  ["orange", ["orange", "rust", "terracotta", "amber", "apricot", "copper"]],
  ["red", ["red", "burgundy", "maroon", "crimson", "wine", "scarlet", "cherry", "brick"]],
  ["pink", ["pink", "blush", "rose", "coral", "salmon", "fuchsia", "magenta"]],
  ["purple", ["purple", "violet", "lavender", "lilac", "plum", "indigo", "mauve", "aubergine"]],
];

/** Maps a free-text colour to one of the coarse buckets. */
export function colorBucket(color: string | null | undefined): ColorBucket {
  if (!color || !color.trim()) return "unknown";
  const normalized = color.toLowerCase();

  for (const [bucket, patterns] of COLOR_PATTERNS) {
    if (patterns.some((p) => normalized.includes(p))) return bucket;
  }
  return "unknown";
}

// ── Sorting ───────────────────────────────────────────────────────────────────

export const SORT_OPTIONS = [
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "category", label: "Type" },
  { key: "color", label: "Colour" },
  { key: "formality", label: "Dressiness" },
] as const;

export type SortKey = (typeof SORT_OPTIONS)[number]["key"];

type SortableItem = {
  created_at: string;
  category: string | null;
  color: string | null;
  formality: string | null;
};

const CATEGORY_ORDER = new Map<string, number>(
  CATEGORIES.map((c, i) => [c, i]),
);
const COLOR_ORDER = new Map<string, number>(
  COLOR_BUCKETS.map((c, i) => [c, i]),
);

/**
 * Returns a new sorted array — never mutates the caller's list, which would
 * fight React's state identity checks.
 *
 * Every comparator falls back to newest-first so items that tie on the primary
 * key still land in a stable, predictable order rather than whatever order the
 * database happened to return.
 */
export function sortItems<T extends SortableItem>(items: T[], sort: SortKey): T[] {
  const byNewest = (a: T, b: T) => b.created_at.localeCompare(a.created_at);

  const sorted = [...items];
  switch (sort) {
    case "oldest":
      return sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
    case "category":
      return sorted.sort(
        (a, b) =>
          rank(CATEGORY_ORDER, a.category) - rank(CATEGORY_ORDER, b.category) ||
          byNewest(a, b),
      );
    case "color":
      return sorted.sort(
        (a, b) =>
          rank(COLOR_ORDER, colorBucket(a.color)) -
            rank(COLOR_ORDER, colorBucket(b.color)) || byNewest(a, b),
      );
    case "formality":
      return sorted.sort(
        (a, b) =>
          (FORMALITY_RANK[a.formality ?? ""] ?? 99) -
            (FORMALITY_RANK[b.formality ?? ""] ?? 99) || byNewest(a, b),
      );
    case "newest":
    default:
      return sorted.sort(byNewest);
  }
}

/** Unknown/legacy tag values sort last instead of jumping to the front. */
function rank(order: Map<string, number>, value: string | null): number {
  if (!value) return 99;
  return order.get(value) ?? 99;
}

// ── Filtering ─────────────────────────────────────────────────────────────────

export type ClosetFilters = {
  categories: Category[];
  colors: ColorBucket[];
};

export const EMPTY_FILTERS: ClosetFilters = {
  categories: [],
  colors: [],
};

export function filtersAreEmpty(f: ClosetFilters): boolean {
  return f.categories.length === 0 && f.colors.length === 0;
}

export function activeFilterCount(f: ClosetFilters): number {
  return f.categories.length + f.colors.length;
}

type FilterableItem = {
  category: string | null;
  color: string | null;
};

/**
 * Groups are ANDed, values within a group are ORed — the behaviour people
 * expect from faceted filters ("tops OR shoes, that are ALSO black").
 */
export function filterItems<T extends FilterableItem>(
  items: T[],
  f: ClosetFilters,
): T[] {
  if (filtersAreEmpty(f)) return items;

  return items.filter((item) => {
    if (f.categories.length > 0) {
      const category = (item.category ?? "other") as Category;
      if (!f.categories.includes(category)) return false;
    }
    if (f.colors.length > 0) {
      if (!f.colors.includes(colorBucket(item.color))) return false;
    }
    return true;
  });
}

/** Toggles a value in a filter array — the chip press behaviour. */
export function toggleFilter<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}
