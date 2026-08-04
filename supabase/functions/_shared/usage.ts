// Per-user daily cost guardrails, shared by tag-item and find-outfit.
// Call BEFORE spending any Anthropic/Gemini credits.

export const DAILY_TAG_LIMIT = 30;
export const DAILY_OUTFIT_LIMIT = 20;

type UsageAction = "tag" | "outfit";

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
  | { ok: false; status: number; body: { error: string; reason: string } };

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
      },
    };
  }

  return { ok: true };
}
