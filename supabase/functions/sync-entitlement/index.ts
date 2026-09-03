/**
 * "I just bought something — please make it real."
 *
 * Called by the app straight after a purchase or a restore. Everything it
 * needs is already known: the caller's identity comes from their JWT, and
 * what they own comes from RevenueCat. Nothing about the purchase is taken
 * from the request body, because a request body is exactly where a forged
 * entitlement would arrive.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { syncEntitlement } from "../_shared/revenuecat.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Verify caller identity from the JWT ───────────────────────────────
    // The user id is both who we are writing an entitlement for AND the
    // RevenueCat app user id we look it up under, so taking it from anywhere
    // but a verified token would let anyone claim anyone's subscription.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing or invalid Authorization header" }, 401);
    }

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      authHeader.slice(7),
    );
    if (authError || !user) {
      return json({ error: "Invalid or expired token — please sign in again" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const result = await syncEntitlement(supabase, user.id);
    console.log("[sync-entitlement]", JSON.stringify({ user: user.id, ...result }));

    return json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync-entitlement]", message);
    return json({ error: message }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
