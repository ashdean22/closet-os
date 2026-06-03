import { createClient } from "jsr:@supabase/supabase-js@2";
import { embedText, EMBED_DIMS } from "../_shared/gemini-embed.ts";

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
    const { item_id } = await req.json();
    if (!item_id || typeof item_id !== "string") {
      return json({ error: "item_id (string) is required" }, 400);
    }

    // Service-role client so we can read and write without RLS restrictions.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Fetch the item's description
    const { data: item, error: fetchError } = await supabase
      .from("items")
      .select("description")
      .eq("id", item_id)
      .single();

    if (fetchError) return json({ error: fetchError.message }, 404);
    if (!item?.description) {
      return json({ error: "Item has no description to embed" }, 400);
    }

    // 2. Embed with the shared helper (gemini-embedding-001, 768 dims, L2-normalised)
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) throw new Error("GEMINI_API_KEY secret is not set");

    const vector = await embedText(item.description, geminiKey);

    // 3. Write vector back to items.embedding as a pgvector-literal string.
    const { error: updateError } = await supabase
      .from("items")
      .update({ embedding: `[${vector.join(",")}]` })
      .eq("id", item_id);

    if (updateError) throw updateError;

    return json({ success: true, dimensions: EMBED_DIMS });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[embed-item]", message);
    return json({ error: message }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
