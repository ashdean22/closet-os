/**
 * What the current user is allowed to do, and how much of it they have left.
 *
 * All of it comes from Postgres. The app never decides whether someone is
 * subscribed — it asks, and renders the answer. A phone that believes it is
 * entitled is making a claim; only the entitlements table makes it true, and
 * find-outfit checks that table itself rather than trusting anything sent
 * with the request.
 */

import { supabase } from "./supabase";

export type Plan = "free" | "monthly" | "yearly" | "lifetime" | "exempt";

export type OutfitStatus = {
  plan: Plan;
  /** True for every paid plan and for exempt accounts. */
  unlimited: boolean;
  /** Searches allowed today. Meaningless when `unlimited`. */
  limit: number;
  used: number;
  left: number;
  /** UTC midnight, when the counter rolls over. */
  resetsAt: Date | null;
};

/**
 * The free tier, assumed while the real answer is loading or after it fails.
 *
 * Optimism would be the wrong default in the other direction — showing
 * "unlimited" to someone who is about to be refused sets them up to be
 * surprised by the paywall rather than prepared for it.
 */
export const FREE_STATUS: OutfitStatus = {
  plan: "free",
  unlimited: false,
  limit: 2,
  used: 0,
  left: 2,
  resetsAt: null,
};

const PLANS: Plan[] = ["free", "monthly", "yearly", "lifetime", "exempt"];

export async function fetchOutfitStatus(): Promise<OutfitStatus> {
  const { data, error } = await supabase.rpc("my_outfit_status");
  if (error) throw new Error(error.message);

  const d = (data ?? {}) as Record<string, unknown>;
  const plan = PLANS.includes(d.plan as Plan) ? (d.plan as Plan) : "free";
  const limit = typeof d.limit === "number" ? d.limit : FREE_STATUS.limit;
  const used = typeof d.used === "number" ? d.used : 0;

  return {
    plan,
    unlimited: d.unlimited === true,
    limit,
    used,
    left: typeof d.left === "number" ? d.left : Math.max(limit - used, 0),
    resetsAt: typeof d.resets_at === "string" ? new Date(d.resets_at) : null,
  };
}

/** How the plan is named to the person on it. */
export function planLabel(plan: Plan): string {
  switch (plan) {
    case "monthly":
      return "Capsule Unlimited — monthly";
    case "yearly":
      return "Capsule Unlimited — yearly";
    case "lifetime":
      return "Capsule Unlimited — lifetime";
    case "exempt":
      return "Capsule Unlimited";
    default:
      return "Free";
  }
}

/**
 * "Resets at midnight" is only true in UTC, and saying it flatly to somebody
 * in Los Angeles at 4pm is wrong by eight hours. So this says the local time
 * the counter actually rolls over.
 */
export function resetLabel(resetsAt: Date | null): string {
  if (!resetsAt) return "Resets tomorrow.";
  const time = resetsAt.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const soon = resetsAt.getTime() - Date.now() < 24 * 60 * 60 * 1000;
  return soon ? `Resets at ${time}.` : `Resets ${resetsAt.toLocaleDateString()}.`;
}
