import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { embedText } from "../_shared/gemini-embed.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Types ─────────────────────────────────────────────────────────────────────

type RetrievedItem = {
  id: string;
  image_url: string | null;
  color: string | null;
  category: string | null;
  formality: string | null;
  season: string | null;
  material: string | null;
  description: string | null;
  similarity: number;
};

type OutfitPiece = {
  item_id: string;
  role: "top" | "bottom" | "outerwear" | "shoes" | "accessory" | "dress";
  reason: string;
};

type OutfitResult = {
  outfit: OutfitPiece[];
  rationale: string;
  missing: string[];
};

// ── Tool definition ───────────────────────────────────────────────────────────

const buildOutfitTool: Anthropic.Tool = {
  name: "build_outfit",
  description:
    "Assemble one complete, coherent outfit from the retrieved wardrobe items. " +
    "Every item_id you use MUST be from the Retrieved Items list — " +
    "never invent or hallucinate item IDs.",
  input_schema: {
    type: "object",
    properties: {
      outfit: {
        type: "array",
        description:
          "The selected pieces. Each item_id must exactly match an id in Retrieved Items.",
        items: {
          type: "object",
          properties: {
            item_id: {
              type: "string",
              description: "UUID exactly as it appears in Retrieved Items.",
            },
            role: {
              type: "string",
              enum: ["top", "bottom", "outerwear", "shoes", "accessory", "dress"],
              description: "The role this piece plays in the outfit.",
            },
            reason: {
              type: "string",
              description:
                "One short sentence: why this specific piece fits the query.",
            },
          },
          required: ["item_id", "role", "reason"],
        },
      },
      rationale: {
        type: "string",
        description:
          "One sentence connecting the complete look to the query's weather, " +
          "occasion, and vibe.",
      },
      missing: {
        type: "array",
        description:
          "Roles the query implies but the wardrobe cannot fill from the " +
          "retrieved set. Empty array when the outfit is complete.",
        items: { type: "string" },
      },
    },
    required: ["outfit", "rationale", "missing"],
  },
};

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { query } = await req.json();
    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return json({ error: "query (non-empty string) is required" }, 400);
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) throw new Error("GEMINI_API_KEY secret is not set");

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY secret is not set");

    // ── Verify caller identity from the JWT ───────────────────────────────
    // We never trust a user_id from the request body. Instead we extract the
    // JWT from the Authorization header and verify it server-side with
    // supabase.auth.getUser(). This is the only secure way to get the
    // caller's uid when a function is deployed with --no-verify-jwt.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing or invalid Authorization header" }, 401);
    }
    const jwt = authHeader.slice(7);

    // Use the anon key client to verify the token. getUser() validates the
    // signature against Supabase's JWKS — a forged or expired token fails here.
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: { user }, error: authError } = await anonClient.auth.getUser(jwt);
    if (authError || !user) {
      return json({ error: "Invalid or expired token — please sign in again" }, 401);
    }
    const userId = user.id;

    // Service-role client for privileged DB operations (bypasses RLS so
    // match_items can run unrestricted; user scope is enforced by the
    // filter_user_id parameter we pass explicitly, not by RLS on this client).
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Step 1: embed the query ───────────────────────────────────────────
    // Uses the SAME model (gemini-embedding-001), outputDimensionality (768),
    // and L2-normalisation as embed-item via the shared helper.
    // Query and stored vectors MUST be identical in production or distances
    // are meaningless.
    const queryVector = await embedText(query, geminiKey);

    // ── Step 2: retrieve nearest items via pgvector HNSW ─────────────────
    // filter_user_id scopes the search to this user's wardrobe only.
    const { data: items, error: rpcError } = await supabase.rpc("match_items", {
      query_embedding: `[${queryVector.join(",")}]`,
      filter_user_id: userId,
      match_count: 10,
    }) as { data: RetrievedItem[] | null; error: unknown };

    if (rpcError) throw new Error(`match_items RPC error: ${JSON.stringify(rpcError)}`);

    const retrieved: RetrievedItem[] = items ?? [];

    if (retrieved.length === 0) {
      return json({
        outfit: [],
        rationale: "Your closet has no embedded items yet — add some pieces first.",
        missing: ["top", "bottom", "shoes"],
      });
    }

    // Build the allowed-ID set for anti-hallucination validation.
    const allowedIds = new Set(retrieved.map((i) => i.id));

    // ── Step 3: ask Claude to assemble the outfit ─────────────────────────
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const itemsForPrompt = retrieved.map((i) => ({
      id: i.id,
      category: i.category,
      color: i.color,
      formality: i.formality,
      season: i.season,
      material: i.material,
      description: i.description,
      similarity: Math.round(i.similarity * 1000) / 1000,
    }));

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      // tool_choice: { type: "tool" } forces Claude to call build_outfit,
      // guaranteeing a parseable structured response every time.
      tool_choice: { type: "tool", name: "build_outfit" },
      tools: [buildOutfitTool],
      system:
        "You are a personal stylist building outfits from a user's real wardrobe. " +
        "Rules you must never break:\n" +
        "1. Every item_id in your outfit array must be an id from the Retrieved Items list. " +
        "Inventing or guessing item IDs is strictly forbidden.\n" +
        "2. Do not assign two items to the same role (e.g., two tops). " +
        "If you have multiple options for a role, pick the single best fit.\n" +
        "3. Prioritise: formality match first, then seasonal match, then colour coherence.\n" +
        "4. Only add a role to missing[] if the query genuinely needs it AND " +
        "the retrieved set has nothing that can fill it.\n" +
        "5. Similarity scores are hints only — use your styling judgement.",
      messages: [
        {
          role: "user",
          content:
            `Query: "${query}"\n\n` +
            `Retrieved Items (you may ONLY use these):\n` +
            `${JSON.stringify(itemsForPrompt, null, 2)}\n\n` +
            `Use the build_outfit tool to assemble the best possible outfit.`,
        },
      ],
    });

    // tool_choice: { type: "tool" } guarantees content[0] is tool_use.
    const block = message.content[0];
    if (block.type !== "tool_use") {
      throw new Error(`Unexpected Claude response block type: ${block.type}`);
    }

    const result = block.input as OutfitResult;

    // ── Step 4: anti-hallucination guard ─────────────────────────────────
    // Reject any item_id Claude returned that was not in the retrieved set.
    const hallucinated = result.outfit
      .map((p) => p.item_id)
      .filter((id) => !allowedIds.has(id));

    if (hallucinated.length > 0) {
      console.error("[find-outfit] Claude hallucinated item IDs:", hallucinated);
      // Strip the bad pieces rather than hard-failing so the user still
      // gets a partial outfit. Log for observability.
      result.outfit = result.outfit.filter((p) => allowedIds.has(p.item_id));
      result.missing.push(
        ...hallucinated.map((id) => `unknown (hallucinated id: ${id})`),
      );
    }

    // Attach the full item metadata to each outfit piece so the client
    // doesn't need a second round-trip to display photos and details.
    const itemMap = new Map(retrieved.map((i) => [i.id, i]));
    const outfitWithDetails = result.outfit.map((piece) => ({
      ...piece,
      item: itemMap.get(piece.item_id),
    }));

    return json({
      query,
      outfit: outfitWithDetails,
      rationale: result.rationale,
      missing: result.missing,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[find-outfit]", message);
    return json({ error: message }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
