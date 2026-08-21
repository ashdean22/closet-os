import { createClient } from "jsr:@supabase/supabase-js@2";

// Apple-required in-app account deletion (App Review Guideline 5.1.1(v)).
// Deletes, in order: the user's storage images, their saved outfits, their
// items rows, their usage rows, and finally the auth user via the admin API.
// The service-role key exists ONLY as a function secret — it is never shipped
// in the app.
//
// Every step is idempotent, so a partial failure is safely retryable: the
// client just calls the function again.

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
    // Same pattern as find-outfit: never trust a user_id from the body; the
    // only account you can delete is the one whose token you hold.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing or invalid Authorization header", reason: "unauthorized" }, 401);
    }
    const jwt = authHeader.slice(7);

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: { user }, error: authError } = await anonClient.auth.getUser(jwt);
    if (authError || !user) {
      return json({ error: "Invalid or expired token — please sign in again", reason: "unauthorized" }, 401);
    }
    const userId = user.id;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── 1. Collect and remove storage images ─────────────────────────────
    // Paths are derived from the items rows (uploads aren't namespaced by
    // user), so this must happen BEFORE the rows are deleted. Best-effort:
    // an orphaned file is harmless; a blocked account deletion is not.
    const { data: items, error: fetchError } = await supabase
      .from("items")
      .select("image_url")
      .eq("user_id", userId);

    if (fetchError) {
      console.error("[delete-account] fetching items failed:", fetchError.message);
      return json(
        { error: "Could not read account data — please try again.", reason: "partial_failure" },
        500,
      );
    }

    const paths = (items ?? [])
      .map((i) => storagePathFromUrl(i.image_url))
      .filter((p): p is string => p !== null);

    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error: storageError } = await supabase.storage
        .from("wardrobe-items")
        .remove(chunk);
      if (storageError) {
        console.warn("[delete-account] storage remove:", storageError.message);
      }
    }

    // ── 2. Delete saved outfits ───────────────────────────────────────────
    // Nothing cascades these away for us: user_id is a bare uuid column with
    // no FK to auth.users, so deleting the auth user leaves the outfit rows
    // behind — name, the free-text query ("65 and rainy, job interview") and
    // Claude's per-piece reasons, all of it user content. Pieces go with the
    // outfit via ON DELETE CASCADE on outfit_id.
    const { error: outfitsError } = await supabase
      .from("saved_outfits")
      .delete()
      .eq("user_id", userId);
    if (outfitsError) {
      console.error("[delete-account] saved_outfits delete failed:", outfitsError.message);
      return json(
        { error: "Could not delete account data — please try again.", reason: "partial_failure" },
        500,
      );
    }

    // ── 3. Delete items rows ──────────────────────────────────────────────
    const { error: itemsError } = await supabase
      .from("items")
      .delete()
      .eq("user_id", userId);
    if (itemsError) {
      console.error("[delete-account] items delete failed:", itemsError.message);
      return json(
        { error: "Could not delete account data — please try again.", reason: "partial_failure" },
        500,
      );
    }

    // ── 4. Delete usage rows (best-effort — table may not exist locally) ──
    const { error: usageError } = await supabase
      .from("api_usage")
      .delete()
      .eq("user_id", userId);
    if (usageError) {
      console.warn("[delete-account] api_usage delete:", usageError.message);
    }

    // ── 5. Delete the auth user ───────────────────────────────────────────
    const { error: adminError } = await supabase.auth.admin.deleteUser(userId);
    if (adminError) {
      console.error("[delete-account] auth delete failed:", adminError.message);
      return json(
        {
          error: "Your data was removed but the account itself could not be deleted — please try again.",
          reason: "auth_delete_failed",
        },
        500,
      );
    }

    console.log("[delete-account] deleted user", userId, "items:", items?.length ?? 0);
    return json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[delete-account]", message);
    return json({ error: message, reason: "unknown" }, 500);
  }
});

function storagePathFromUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = "/wardrobe-items/";
  const idx = url.indexOf(marker);
  return idx >= 0 ? url.slice(idx + marker.length) : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
