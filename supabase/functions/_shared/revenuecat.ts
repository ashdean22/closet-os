/**
 * Turning "what RevenueCat believes" into a row in public.entitlements.
 *
 * One function, two callers, on purpose:
 *
 *   sync-entitlement    runs when the app asks — right after a purchase or a
 *                       restore, so the user isn't left waiting on someone
 *                       else's webhook queue to finish before their money
 *                       does anything.
 *
 *   revenuecat-webhook  runs when the app isn't there — a renewal at 3am, a
 *                       cancellation, an expiry, a refund. These are most of
 *                       the lifetime of a subscription and none of them
 *                       involve the phone.
 *
 * Both end up reading the same source of truth (RevenueCat's REST API) rather
 * than trusting the shape of whatever triggered them. A webhook body is a
 * notification that something changed, not a reliable description of the new
 * state — re-reading costs one request and removes a whole class of bug where
 * two events arrive out of order.
 */

const RC_API = "https://api.revenuecat.com/v1";

/**
 * The entitlement identifier configured in the RevenueCat dashboard.
 *
 * All three products (monthly, yearly, lifetime) grant this same entitlement,
 * which is what lets the app ask one question — "is this user unlimited?" —
 * instead of knowing about every SKU that could make them so.
 */
const ENTITLEMENT_ID = Deno.env.get("REVENUECAT_ENTITLEMENT_ID") ?? "unlimited";

type Product = "monthly" | "yearly" | "lifetime";

type SubscriberResponse = {
  subscriber?: {
    entitlements?: Record<
      string,
      { expires_date: string | null; product_identifier: string }
    >;
    subscriptions?: Record<string, { store?: string; is_sandbox?: boolean }>;
    non_subscriptions?: Record<
      string,
      { store?: string; is_sandbox?: boolean }[]
    >;
    original_app_user_id?: string;
  };
};

type WriteClient = {
  from: (table: string) => {
    upsert: (
      values: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => PromiseLike<{ error: { message: string } | null }>;
    delete: () => {
      eq: (
        column: string,
        value: string,
      ) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

export type SyncResult = {
  entitled: boolean;
  product: Product | null;
  expiresAt: string | null;
};

/**
 * Maps a store product identifier back to one of our three plans.
 *
 * Matches on the suffix rather than the whole string so the bundle prefix can
 * change (a rename, a second bundle id for a TestFlight variant) without
 * silently downgrading every paying customer to "unrecognised".
 */
function productFromIdentifier(identifier: string): Product | null {
  const id = identifier.toLowerCase();
  if (id.endsWith(".lifetime")) return "lifetime";
  if (id.endsWith(".yearly")) return "yearly";
  if (id.endsWith(".monthly")) return "monthly";
  return null;
}

/**
 * Reads the current entitlement for one user and writes it to Postgres.
 *
 * Returns what it decided so callers can log something useful. Throws only on
 * a genuine failure to reach RevenueCat or to write — "this user has bought
 * nothing" is a normal, successful outcome that removes any stale row.
 */
export async function syncEntitlement(
  supabase: WriteClient,
  userId: string,
): Promise<SyncResult> {
  const secret = Deno.env.get("REVENUECAT_SECRET_KEY");
  if (!secret) throw new Error("REVENUECAT_SECRET_KEY secret is not set");

  const res = await fetch(`${RC_API}/subscribers/${encodeURIComponent(userId)}`, {
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`RevenueCat returned ${res.status} for subscriber lookup`);
  }

  const body = (await res.json()) as SubscriberResponse;
  const entitlement = body.subscriber?.entitlements?.[ENTITLEMENT_ID];

  // No entitlement at all, or one that has already lapsed. Either way the row
  // goes: outfit_limits treats a missing row and an expired row identically,
  // but keeping expired rows around would slowly turn the table into a
  // history log that the paywall has to reason about.
  const expiresAt = entitlement?.expires_date ?? null;
  const lapsed = expiresAt !== null && new Date(expiresAt).getTime() <= Date.now();

  if (!entitlement || lapsed) {
    const { error } = await supabase.from("entitlements").delete().eq("user_id", userId);
    if (error) throw new Error(`entitlement delete failed: ${error.message}`);
    return { entitled: false, product: null, expiresAt };
  }

  const product = productFromIdentifier(entitlement.product_identifier);
  if (!product) {
    // An identifier we do not recognise is a configuration mistake, not a
    // reason to hand out or withdraw access silently. Loud, and left alone.
    throw new Error(
      `Unrecognised product identifier "${entitlement.product_identifier}" — ` +
        "check the App Store Connect ids against lib/products.ts",
    );
  }

  const sandbox = isSandbox(body, entitlement.product_identifier);

  const { error } = await supabase.from("entitlements").upsert(
    {
      user_id: userId,
      product,
      // A lifetime purchase has no expiry, which RevenueCat reports as null
      // and which the column stores as null. Same meaning on both sides.
      expires_at: expiresAt,
      latest_transaction_id: entitlement.product_identifier,
      environment: sandbox ? "sandbox" : "production",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) throw new Error(`entitlement upsert failed: ${error.message}`);
  return { entitled: true, product, expiresAt };
}

/** TestFlight and simulator purchases, so a real row is distinguishable. */
function isSandbox(body: SubscriberResponse, productId: string): boolean {
  const sub = body.subscriber?.subscriptions?.[productId];
  if (sub?.is_sandbox !== undefined) return sub.is_sandbox;
  const oneOff = body.subscriber?.non_subscriptions?.[productId];
  if (Array.isArray(oneOff) && oneOff.length > 0) {
    return oneOff[oneOff.length - 1]?.is_sandbox === true;
  }
  return false;
}
