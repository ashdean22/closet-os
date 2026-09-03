// Per-user daily cost guardrails, shared by tag-item and find-outfit.
// Call BEFORE spending any Anthropic/Gemini credits.

export const DAILY_TAG_LIMIT = 30;

/**
 * Fallback outfit budget, used only when the limits lookup itself fails.
 *
 * Real limits come from public.outfit_limits, which knows about paid plans and
 * exemptions. This number exists so a database hiccup degrades to "a generous
 * but finite allowance" rather than to either "no outfits for anybody" or
 * "unlimited outfits for everybody".
 */
export const DAILY_OUTFIT_LIMIT = 4;

type UsageAction = "tag" | "outfit" | "outfit_extra";

/** What a request is actually asking for, which decides which budget it spends. */
export type OutfitIntent = "search" | "prefetch" | "swap";

export type OutfitLimits = {
  /** 'free' | 'monthly' | 'yearly' | 'lifetime' | 'exempt' */
  plan: string;
  /** True for every paid plan and for exempt accounts. */
  unlimited: boolean;
  /** Looks the user asked for. The number the paywall is about. */
  searches: number;
  /** Background prefetches and laundry swaps. */
  extras: number;
};

const FREE_FALLBACK: OutfitLimits = {
  plan: "free",
  unlimited: false,
  searches: DAILY_OUTFIT_LIMIT,
  extras: DAILY_OUTFIT_LIMIT,
};

/**
 * Reads the caller's plan and today's allowance from Postgres.
 *
 * Fails to the FREE tier rather than to unlimited: a lookup that errors must
 * not hand out paid features, and a paying customer briefly seeing a free-tier
 * limit is a far cheaper mistake than the reverse.
 */
export async function getOutfitLimits(
  supabase: RpcClient,
  userId: string,
): Promise<OutfitLimits> {
  const { data, error } = await supabase.rpc("outfit_limits", {
    p_user_id: userId,
  });

  if (error) {
    console.error("[usage] outfit_limits failed:", error.message);
    return FREE_FALLBACK;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return FREE_FALLBACK;

  const r = row as Record<string, unknown>;
  return {
    plan: typeof r.plan === "string" ? r.plan : "free",
    unlimited: r.unlimited === true,
    searches: typeof r.searches === "number" ? r.searches : FREE_FALLBACK.searches,
    extras: typeof r.extras === "number" ? r.extras : FREE_FALLBACK.extras,
  };
}

// Minimal client shape so callers can pass any supabase-js client instance
// without a version-pinned type import.
type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type UsageCheck =
  | { ok: true }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Atomically increments the caller's daily counter and checks it against the
 * limit. Must be called with a service-role client (increment_usage is not
 * executable by anon/authenticated).
 *
 * Fails CLOSED: if the usage check itself errors we refuse the request rather
 * than risk uncapped spend — the client shows a generic retry message.
 */
export async function checkDailyLimit(
  supabase: RpcClient,
  userId: string,
  action: UsageAction,
  limit: number,
  /**
   * Merged into the 429 body. The paywall needs to know which plan was
   * refused and what the ceiling was, and that has to travel with the
   * refusal — asking a second endpoint after being told no is a round trip
   * spent re-establishing something the first response already knew.
   */
  detail: Record<string, unknown> = {},
): Promise<UsageCheck> {
  const { data: allowed, error } = await supabase.rpc("increment_usage", {
    p_user_id: userId,
    p_action: action,
    p_limit: limit,
  });

  if (error) {
    console.error(`[usage] increment_usage failed for ${action}:`, error.message);
    return {
      ok: false,
      status: 500,
      body: { error: "Usage check failed — please try again.", reason: "unknown" },
    };
  }

  if (allowed !== true) {
    console.log(`[usage] daily ${action} limit reached for user`, userId);
    return {
      ok: false,
      status: 429,
      body: {
        error: `Daily ${action} limit reached (${limit}/day). Resets tomorrow.`,
        reason: "daily_limit",
        limit,
        ...detail,
      },
    };
  }

  return { ok: true };
}
