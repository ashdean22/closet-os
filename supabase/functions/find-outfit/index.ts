import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { embedText } from "../_shared/gemini-embed.ts";
import { checkDailyLimit, DAILY_OUTFIT_LIMIT } from "../_shared/usage.ts";

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
  secondary_color: string | null;
  category: string | null;
  formality: string | null;
  season: string | null;
  material: string | null;
  description: string | null;
  similarity: number;
  category_rank: number;
};

type Role = "top" | "bottom" | "outerwear" | "shoes" | "accessory" | "dress";

type OutfitPiece = {
  item_id: string;
  role: Role;
  reason: string;
};

type ModelOutfit = {
  name: string;
  outfit: OutfitPiece[];
  rationale: string;
};

type ModelResult = {
  outfits: ModelOutfit[];
};

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLES: Role[] = ["top", "bottom", "outerwear", "shoes", "accessory", "dress"];

/** Slots a look is expected to fill. A dress stands in for top + bottom. */
const CORE_ROLES: Role[] = ["top", "bottom", "shoes"];

/** Hard ceiling on candidates sent to Claude — bounds prompt tokens and cost. */
const MAX_CANDIDATES = 32;

/** More than 3 looks per call stops being useful and just burns tokens. */
const MAX_VARIATIONS = 3;

/** At most one piece per role, except accessories which may layer. */
const MAX_PER_ROLE: Partial<Record<Role, number>> = { accessory: 2 };

// ── Tool definition ───────────────────────────────────────────────────────────

const buildOutfitsTool: Anthropic.Tool = {
  name: "build_outfits",
  description:
    "Assemble one or more complete, distinctly different outfits from the " +
    "retrieved wardrobe items. Every item_id you use MUST be from the " +
    "Retrieved Items list — never invent or hallucinate item IDs.",
  input_schema: {
    type: "object",
    properties: {
      outfits: {
        type: "array",
        description:
          "One entry per requested variation, best look first. Each outfit must " +
          "be a meaningfully different combination — not the same look with one " +
          "accessory swapped.",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Two or three words naming this look's angle, e.g. " +
                "'Sharp and warm' or 'Relaxed layers'. No punctuation.",
            },
            outfit: {
              type: "array",
              description:
                "The selected pieces. Each item_id must exactly match an id in " +
                "Retrieved Items.",
              items: {
                type: "object",
                properties: {
                  item_id: {
                    type: "string",
                    description: "UUID exactly as it appears in Retrieved Items.",
                  },
                  role: {
                    type: "string",
                    enum: ROLES,
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
                "One sentence connecting this complete look to the query's " +
                "weather, occasion, and vibe.",
            },
          },
          required: ["name", "outfit", "rationale"],
        },
      },
    },
    required: ["outfits"],
  },
};

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    const anchorItemId =
      typeof body?.anchor_item_id === "string" ? body.anchor_item_id : null;
    const excludeItemIds: string[] = Array.isArray(body?.exclude_item_ids)
      ? body.exclude_item_ids.filter((id: unknown) => typeof id === "string")
      : [];
    // Defaults to 1, NOT 3. Clients that want variations ask for them
    // explicitly; v1.0.0 is live on the App Store and never sends this field,
    // and it only ever renders one look. Defaulting to 3 would triple those
    // users' output tokens to build two looks they can't see.
    //
    // Asking for 3 in one call is still far cheaper than three separate calls
    // (one embed, one retrieval, one request) — that's why the updated client
    // sends variations: 3 and swaps between them locally on Refresh.
    const variations = clamp(
      typeof body?.variations === "number" ? Math.trunc(body.variations) : 1,
      1,
      MAX_VARIATIONS,
    );

    // An anchor item is a query in itself ("something to go with this shirt"),
    // so either input alone is enough.
    if (!query && !anchorItemId) {
      return json(
        {
          error: "query (non-empty string) or anchor_item_id is required",
          reason: "bad_request",
        },
        400,
      );
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
    // match_items_stratified can run unrestricted; user scope is enforced by
    // the filter_user_id parameter we pass explicitly, not by RLS).
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Daily cost cap — checked before the Gemini embed and Claude calls ──
    // Still one increment per call regardless of how many variations come back,
    // because the cost driver is the round-trip, not the outfit count.
    const usage = await checkDailyLimit(supabase, userId, "outfit", DAILY_OUTFIT_LIMIT);
    if (!usage.ok) {
      return json(usage.body, usage.status);
    }

    // ── Step 0: resolve the anchor item, if one was pinned ────────────────
    // Explicitly scoped by user_id: an anchor id belonging to someone else's
    // closet must not leak its photo or tags back through this endpoint.
    let anchor: RetrievedItem | null = null;
    if (anchorItemId) {
      const { data: anchorRow, error: anchorError } = await supabase
        .from("items")
        .select(
          "id, image_url, color, secondary_color, category, formality, season, " +
            "material, description",
        )
        .eq("id", anchorItemId)
        .eq("user_id", userId)
        .maybeSingle();

      if (anchorError) {
        throw new Error(`anchor lookup failed: ${anchorError.message}`);
      }
      if (!anchorRow) {
        return json(
          {
            error: "That item is no longer in your closet.",
            reason: "anchor_not_found",
          },
          404,
        );
      }
      anchor = { ...anchorRow, similarity: 1, category_rank: 0 } as RetrievedItem;
    }

    // ── Step 1: embed the search text ─────────────────────────────────────
    // Uses the SAME model (gemini-embedding-001), outputDimensionality (768),
    // and L2-normalisation as embed-item via the shared helper.
    // Query and stored vectors MUST be identical in production or distances
    // are meaningless.
    //
    // With an anchor we embed a composite string rather than the raw query, so
    // retrieval pulls pieces that pair with the anchor's colour/fabric/formality
    // instead of items that merely resemble the typed words.
    const searchText = buildSearchText(query, anchor);
    const queryVector = await embedText(searchText, geminiKey);

    // ── Step 2: retrieve nearest items, stratified by category ────────────
    // per_category guarantees the candidate set has options for every slot the
    // closet can fill — a flat top-N could return ten shirts and no shoes,
    // which made a complete outfit impossible regardless of prompting.
    const perCategory = variations > 1 ? 5 : 3;
    const excludeIds = [...new Set([...excludeItemIds, ...(anchor ? [anchor.id] : [])])];

    const { data: items, error: rpcError } = await supabase.rpc(
      "match_items_stratified",
      {
        query_embedding: `[${queryVector.join(",")}]`,
        filter_user_id: userId,
        per_category: perCategory,
        exclude_ids: excludeIds,
      },
    ) as { data: RetrievedItem[] | null; error: { message: string } | null };

    if (rpcError) {
      throw new Error(`match_items_stratified RPC error: ${rpcError.message}`);
    }

    // Roles the anchor already fills are dropped from the candidate pool so the
    // model physically cannot pair a second top with a pinned top.
    const anchorCovers = anchor ? rolesCoveredBy(categoryToRole(anchor.category)) : [];
    const retrieved = capCandidates(
      (items ?? []).filter((i) => {
        const role = categoryToRole(i.category);
        return !anchorCovers.includes(role);
      }),
    );

    // What the closet contains at all — lets us distinguish "you own no shoes"
    // from "none of your shoes suited this query" when reporting gaps.
    const { data: ownedRows } = await supabase.rpc("closet_categories", {
      filter_user_id: userId,
    }) as { data: { category: string; item_count: number }[] | null };
    const ownedRoles = new Set(
      (ownedRows ?? []).map((r) => categoryToRole(r.category)),
    );

    if (retrieved.length === 0 && !anchor) {
      const emptyCloset = (ownedRows ?? []).length === 0;
      return emptyResult(
        query,
        emptyCloset
          ? "Your closet has no embedded items yet — add some pieces first."
          : "Nothing left to pull from — try a different search or clear the refreshes.",
      );
    }

    // Build the allowed-ID set for anti-hallucination validation.
    const allowedIds = new Set(retrieved.map((i) => i.id));

    // ── Step 3: ask Claude to assemble the outfits ────────────────────────
    // maxRetries: 0 — the SDK default of 2 automatic retries would multiply
    // spend/latency on transient failures; the user retries manually instead.
    const anthropic = new Anthropic({ apiKey: anthropicKey, maxRetries: 0 });

    const itemsForPrompt = retrieved.map((i) => ({
      id: i.id,
      category: i.category,
      color: i.color,
      secondary_color: i.secondary_color,
      formality: i.formality,
      season: i.season,
      material: i.material,
      description: i.description,
      similarity: Math.round(i.similarity * 1000) / 1000,
    }));

    // Only ask for slots the wardrobe can actually fill. Demanding shoes from a
    // closet with no shoes just invites the model to hallucinate one.
    const fillableCore = CORE_ROLES.filter(
      (role) =>
        retrieved.some((i) => categoryToRole(i.category) === role) ||
        (retrieved.some((i) => categoryToRole(i.category) === "dress") &&
          role !== "shoes"),
    );

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      // Three looks of ~5 pieces, each with a reason sentence, needs materially
      // more room than the single-outfit version's 1024.
      max_tokens: 3072,
      // tool_choice: { type: "tool" } forces Claude to call build_outfits,
      // guaranteeing a parseable structured response every time.
      tool_choice: { type: "tool", name: "build_outfits" },
      tools: [buildOutfitsTool],
      system:
        "You are an experienced personal stylist building outfits from a user's " +
        "real wardrobe.\n\n" +
        "HARD RULES — never break these:\n" +
        "1. Every item_id in every outfit must be an id from the Retrieved Items " +
        "list. Inventing or guessing item IDs is strictly forbidden.\n" +
        "2. Each outfit must be COMPLETE: a top, a bottom, and shoes whenever the " +
        "retrieved set contains them. A dress replaces the top and bottom, but " +
        "still needs shoes. Never return a look that is only one or two pieces " +
        "when the candidates allow a full one.\n" +
        "3. Do not assign two items to the same role within one outfit (e.g. two " +
        "tops). Accessories may appear at most twice. Outerwear is optional — add " +
        "it only when the weather or occasion calls for it.\n" +
        "4. When asked for multiple outfits, each must be a genuinely different " +
        "combination — change the core pieces, not just an accessory. Order them " +
        "best first.\n\n" +
        "STYLING CRAFT — apply these in order when choosing between valid options:\n" +
        "a. Formality consistency. One piece at the wrong level breaks the whole " +
        "look — athletic sneakers under tailored trousers, a hoodie with dress " +
        "shoes. Match the occasion, and keep every piece within one step of it.\n" +
        "b. Colour. Build on a workable scheme rather than picking pieces that " +
        "merely 'go': neutrals (black, white, grey, navy, beige, brown) anchor and " +
        "pair with anything; a single saturated colour reads best against " +
        "neutrals; two saturated colours need to be either analogous (neighbours " +
        "on the wheel, e.g. rust with mustard) or deliberately complementary " +
        "(opposites, e.g. navy with camel). Avoid two competing brights. Warm " +
        "tones (camel, rust, cream, olive) and cool tones (navy, grey, charcoal, " +
        "true white) each sit together more comfortably than mixed. Black with " +
        "navy, and black with dark brown, both need clear contrast elsewhere to " +
        "look intentional.\n" +
        "c. Texture and fabric. A good outfit varies surface, not just colour — " +
        "pair smooth with textured (cotton shirt with wool trousers, silk with " +
        "denim, knitwear with leather). An outfit where every piece shares one " +
        "flat texture looks like a uniform. Match fabric weight to the season: " +
        "linen and light cotton for heat, wool, denim and leather for cold.\n" +
        "d. Proportion and pattern. At most one bold pattern per outfit, with the " +
        "rest solid. If two patterns appear, they must differ clearly in scale.\n" +
        "e. Then seasonal fit, then the similarity scores — which are retrieval " +
        "hints only, never a substitute for your judgement.\n\n" +
        "In each piece's `reason`, name the actual styling logic (the colour " +
        "relationship, the texture contrast, the formality match) rather than " +
        "restating the garment. Write like a stylist talking to a client: " +
        "specific and plain, never florid.",
      messages: [
        {
          role: "user",
          content: buildUserPrompt({
            query,
            anchor,
            itemsForPrompt,
            variations,
            fillableCore,
          }),
        },
      ],
    });

    // tool_choice: { type: "tool" } guarantees a tool_use block, but a
    // max_tokens cutoff mid-tool can still yield a partial/non-tool block.
    const block = message.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      console.error(
        "[find-outfit] no tool_use block; stop_reason:",
        message.stop_reason,
      );
      throw new Error("The stylist returned an unexpected response.");
    }

    const result = block.input as ModelResult;
    const rawOutfits = Array.isArray(result?.outfits) ? result.outfits : [];

    // ── Step 4: validate, pin the anchor, and report honest gaps ──────────
    const itemMap = new Map(retrieved.map((i) => [i.id, i]));
    const seenSignatures = new Set<string>();
    const built: unknown[] = [];

    for (const candidate of rawOutfits) {
      const pieces = sanitizePieces(candidate?.outfit, allowedIds, anchor);

      // A look that survived sanitisation with nothing in it is not worth
      // showing; skip rather than render an empty card.
      if (pieces.length === 0) continue;

      // Drop exact repeats — the prompt asks for distinct looks, but identical
      // item sets still slip through occasionally.
      const signature = pieces.map((p) => p.item_id).sort().join("|");
      if (seenSignatures.has(signature)) continue;
      seenSignatures.add(signature);

      const filled = new Set(pieces.flatMap((p) => rolesCoveredBy(p.role)));
      // Authoritative gap list, computed server-side rather than trusted from
      // the model, and split by cause so the client can say something true.
      const missingDetail = CORE_ROLES.filter((role) => !filled.has(role)).map(
        (role) => ({
          role,
          reason: ownedRoles.has(role) ? "no_match" : "not_owned",
        }),
      );

      built.push({
        name: typeof candidate?.name === "string" ? candidate.name : "",
        outfit: pieces.map((piece) => ({
          ...piece,
          item: piece.item_id === anchor?.id ? anchor : itemMap.get(piece.item_id),
          is_anchor: piece.item_id === anchor?.id,
        })),
        rationale:
          typeof candidate?.rationale === "string"
            ? candidate.rationale
            : "A look pulled from your closet.",
        // Plain role strings: clients shipped before this update render these
        // directly in a bullet list, so they must stay short and readable.
        missing: missingDetail.map((m) => m.role),
        missing_detail: missingDetail,
      });

      if (built.length >= variations) break;
    }

    if (built.length === 0) {
      return emptyResult(
        query,
        "The stylist couldn't put a look together from these pieces — try " +
          "rephrasing, or add more variety to your closet.",
      );
    }

    const first = built[0] as {
      outfit: unknown[];
      rationale: string;
      missing: string[];
    };

    return json({
      query,
      anchor,
      variations: built,
      // ── Back-compat ────────────────────────────────────────────────────
      // v1.0.0 is live on the App Store and reads these three top-level keys.
      // They mirror the first variation so shipped clients keep working
      // unchanged against the new function.
      outfit: first.outfit,
      rationale: first.rationale,
      missing: first.missing,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[find-outfit]", message);
    return json({ error: message }, 500);
  }
});

// ── Prompt construction ───────────────────────────────────────────────────────

function buildUserPrompt({
  query,
  anchor,
  itemsForPrompt,
  variations,
  fillableCore,
}: {
  query: string;
  anchor: RetrievedItem | null;
  itemsForPrompt: unknown[];
  variations: number;
  fillableCore: Role[];
}): string {
  const lines: string[] = [];

  lines.push(query ? `Query: "${query}"` : "Query: (none given — style around the pinned piece)");

  if (anchor) {
    lines.push(
      "",
      "PINNED PIECE — the user specifically wants to wear this, and it is " +
        "already in every outfit. Do NOT include it in your outfit arrays, and " +
        "do NOT pick anything that fills the same role. Build around it:",
      JSON.stringify(
        {
          category: anchor.category,
          color: anchor.color,
          secondary_color: anchor.secondary_color,
          formality: anchor.formality,
          season: anchor.season,
          material: anchor.material,
          description: anchor.description,
        },
        null,
        2,
      ),
    );
  }

  lines.push(
    "",
    "Retrieved Items (you may ONLY use these):",
    JSON.stringify(itemsForPrompt, null, 2),
  );

  if (fillableCore.length > 0) {
    lines.push(
      "",
      `The candidates can fill these core slots: ${fillableCore.join(", ")}. ` +
        "Every outfit you return must fill all of them.",
    );
  }

  lines.push(
    "",
    variations === 1
      ? "Use the build_outfits tool to return exactly 1 outfit."
      : `Use the build_outfits tool to return ${variations} distinctly different ` +
        "outfits, best first. If the candidates genuinely cannot support that " +
        "many different looks, return fewer rather than near-duplicates.",
  );

  return lines.join("\n");
}

/** Composite retrieval text — an anchor steers the search toward pairings. */
function buildSearchText(query: string, anchor: RetrievedItem | null): string {
  if (!anchor) return query;

  const descriptor = [
    anchor.color,
    anchor.secondary_color,
    anchor.material,
    anchor.category,
    anchor.formality,
    anchor.description,
  ]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join(" ");

  const pairing = descriptor
    ? `Pieces that pair with a ${descriptor}`
    : "Pieces that pair with the selected item";

  return query ? `${query}. ${pairing}` : pairing;
}

// ── Validation helpers ────────────────────────────────────────────────────────

/**
 * Strips hallucinated ids, enforces the one-piece-per-role rule, and prepends
 * the pinned anchor. Returns pieces in a stable display order.
 */
function sanitizePieces(
  raw: unknown,
  allowedIds: Set<string>,
  anchor: RetrievedItem | null,
): OutfitPiece[] {
  const pieces: OutfitPiece[] = [];
  const roleCounts = new Map<Role, number>();
  const usedIds = new Set<string>();

  if (anchor) {
    const role = categoryToRole(anchor.category);
    pieces.push({
      item_id: anchor.id,
      role,
      reason: "You picked this piece — the rest of the look is built around it.",
    });
    roleCounts.set(role, 1);
    usedIds.add(anchor.id);
  }

  const list = Array.isArray(raw) ? raw : [];
  const hallucinated: string[] = [];

  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const p = entry as Record<string, unknown>;
    const itemId = typeof p.item_id === "string" ? p.item_id : "";

    if (!itemId) continue;
    if (!allowedIds.has(itemId)) {
      hallucinated.push(itemId);
      continue;
    }
    // The same item twice in one look is a model slip, not a styling choice.
    if (usedIds.has(itemId)) continue;

    const role = ROLES.includes(p.role as Role) ? (p.role as Role) : "accessory";
    const used = roleCounts.get(role) ?? 0;
    if (used >= (MAX_PER_ROLE[role] ?? 1)) continue;

    pieces.push({
      item_id: itemId,
      role,
      reason: typeof p.reason === "string" ? p.reason : "",
    });
    roleCounts.set(role, used + 1);
    usedIds.add(itemId);
  }

  if (hallucinated.length > 0) {
    console.error("[find-outfit] Claude hallucinated item IDs:", hallucinated);
  }

  return sortPieces(pieces);
}

/** Head-to-toe display order, so cards read the way an outfit is worn. */
function sortPieces(pieces: OutfitPiece[]): OutfitPiece[] {
  const order: Record<Role, number> = {
    outerwear: 0,
    dress: 1,
    top: 2,
    bottom: 3,
    shoes: 4,
    accessory: 5,
  };
  return [...pieces].sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9));
}

/** A dress fills the top and bottom slots on its own. */
function rolesCoveredBy(role: Role): Role[] {
  return role === "dress" ? ["dress", "top", "bottom"] : [role];
}

function categoryToRole(category: string | null): Role {
  if (category && (ROLES as string[]).includes(category)) return category as Role;
  // "other" and legacy NULL categories are treated as accessories: they never
  // block a core slot and never crowd out a top/bottom/shoe pick.
  return "accessory";
}

/**
 * Caps the candidate list while keeping category breadth — trims the
 * lowest-ranked item from the largest category until we fit, so no category is
 * wiped out entirely by a simple slice.
 */
function capCandidates(items: RetrievedItem[]): RetrievedItem[] {
  if (items.length <= MAX_CANDIDATES) return items;

  const kept = [...items];
  while (kept.length > MAX_CANDIDATES) {
    let worstIndex = 0;
    let worstRank = -1;
    for (let i = 0; i < kept.length; i++) {
      if (kept[i].category_rank > worstRank) {
        worstRank = kept[i].category_rank;
        worstIndex = i;
      }
    }
    kept.splice(worstIndex, 1);
  }
  return kept;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/** Shape-compatible "nothing to show" response for old and new clients alike. */
function emptyResult(query: string, rationale: string): Response {
  return json({
    query,
    anchor: null,
    variations: [],
    outfit: [],
    rationale,
    missing: CORE_ROLES,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
