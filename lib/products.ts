/**
 * The three things Capsule sells.
 *
 * Product ids are the contract with App Store Connect: they must match the
 * identifiers created there exactly, they are permanent once a product has
 * been submitted, and they are what a purchase receipt refers back to. Keeping
 * them in one file means the paywall, the purchase call, and the server-side
 * verification can never drift apart on a typo.
 *
 * Prices here are FALLBACKS for rendering before the store answers, and for
 * the simulator, where StoreKit has nothing to say. The real price shown to a
 * user always comes from the store: Apple localises it, applies the right
 * currency, and knows about regional pricing — none of which a hardcoded
 * "$4.99" can do.
 */

export type ProductKind = "monthly" | "yearly" | "lifetime";

export type Product = {
  kind: ProductKind;
  id: string;
  /** True for auto-renewing subscriptions; false for the one-time unlock. */
  subscription: boolean;
  title: string;
  /** Fallback only — prefer the store's localised price string. */
  fallbackPrice: string;
  /** The line under the price. */
  note: string;
  /** Shown as a flag on the card. Empty for none. */
  badge: string;
};

const BUNDLE = "com.gabe822.closetos";

export const PRODUCTS: Product[] = [
  {
    kind: "yearly",
    id: `${BUNDLE}.unlimited.yearly`,
    subscription: true,
    title: "Yearly",
    fallbackPrice: "$29.99",
    // 4.99 x 12 = 59.88, so the annual plan really is half price. Stated as a
    // comparison rather than a percentage because the comparison is checkable.
    note: "$2.50 a month, billed yearly",
    badge: "Best value",
  },
  {
    kind: "monthly",
    id: `${BUNDLE}.unlimited.monthly`,
    subscription: true,
    title: "Monthly",
    fallbackPrice: "$4.99",
    note: "Cancel any time",
    badge: "",
  },
  {
    kind: "lifetime",
    id: `${BUNDLE}.unlimited.lifetime`,
    subscription: false,
    title: "Lifetime",
    fallbackPrice: "$49.99",
    note: "One payment, yours for good",
    badge: "",
  },
];

export const PRODUCT_IDS = PRODUCTS.map((p) => p.id);

/**
 * Whether this build can actually take money.
 *
 * False in Expo Go, and false in a binary that shipped before RevenueCat was
 * wired up — including one that has since been handed these screens by an
 * over-the-air update. Everywhere the paywall would appear checks this first,
 * because offering somebody a plan the build cannot sell them is worse than
 * not mentioning it: they tap, nothing happens, and the app looks broken.
 *
 * The server is told the same thing, and only meters a client against the
 * free tier once it can honour the upgrade it would be pointing at.
 */
export const PURCHASES_AVAILABLE =
  (process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? "").length > 0;

export function productById(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}
