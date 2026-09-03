/**
 * Everything that happens to a subscription while the app is closed.
 *
 * Renewals, cancellations, expiries, refunds, billing failures. These are most
 * of a subscription's life and none of them involve the phone, so without this
 * endpoint a cancelled subscriber would keep unlimited access until they next
 * opened the app — which, having cancelled, they may never do.
 *
 * The body is treated as a nudge rather than as news: it tells us WHO changed,
 * and then we re-read the authoritative state from RevenueCat's API. Webhooks
 * can arrive late, twice, or out of order, and re-reading makes all three
 * harmless.
 *
 * Deploy with --no-verify-jwt: RevenueCat has no Supabase token to present. It
 * authenticates with the shared secret checked below instead, which is why
 * that check must come before anything else happens.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { syncEntitlement } from "../_shared/revenuecat.ts";

Deno.serve(async (req: Request) => {
  try {
    // ── Authenticate the caller ───────────────────────────────────────────
    // Set the same value in RevenueCat's dashboard under the webhook's
    // Authorization header. Without this the endpoint is an open door for
    // writing entitlements.
    const expected = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
    if (!expected) {
      console.error("[revenuecat-webhook] REVENUECAT_WEBHOOK_SECRET is not set");
      return new Response("not configured", { status: 500 });
    }
    if (req.headers.get("Authorization") !== expected) {
      console.warn("[revenuecat-webhook] rejected a request with a bad secret");
      return new Response("unauthorized", { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const event = body?.event ?? {};
    const type = typeof event.type === "string" ? event.type : "UNKNOWN";

    // app_user_id is the Supabase user id — set at Purchases.configure time.
    // original_app_user_id is the fallback for an alias created before the
    // user signed in.
    const userId: string | null =
      typeof event.app_user_id === "string"
        ? event.app_user_id
        : typeof event.original_app_user_id === "string"
          ? event.original_app_user_id
          : null;

    if (!userId || !UUID.test(userId)) {
      // RevenueCat sends test pings and events for anonymous ids that never
      // signed in. Neither is an error, and answering 200 stops their retry
      // queue from hammering a request we are deliberately ignoring.
      console.log(`[revenuecat-webhook] ignoring ${type} for id:`, userId);
      return new Response("ignored", { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const result = await syncEntitlement(supabase, userId);
    console.log(
      "[revenuecat-webhook]",
      JSON.stringify({ type, user: userId, ...result }),
    );

    return new Response("ok", { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[revenuecat-webhook]", message);
    // A 5xx tells RevenueCat to retry, which is what we want for a transient
    // failure — the alternative is silently losing a cancellation.
    return new Response(message, { status: 500 });
  }
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
