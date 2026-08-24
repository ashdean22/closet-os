import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { embedText } from "../_shared/gemini-embed.ts";
import { checkDailyLimit, DAILY_OUTFIT_LIMIT } from "../_shared/usage.ts";
import { STYLIST_SYSTEM_PROMPT } from "../_shared/styling-rules.ts";

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

/**
 * Safety ceiling on candidates sent to Claude.
 *
 * The default is now to show the stylist the ENTIRE wardrobe — a real stylist
 * works from everything you own, and filtering by embedding similarity was
 * quietly hiding two thirds of the tops from it. A typical closet is well
 * under this number, so for most users nothing is filtered at all.
 *
 * This exists only so a very large wardrobe cannot blow up cost or latency.
 * Candidates are the one part of the prompt that is NOT cached (they change
 * per query and per refresh), so each item is paid in full — roughly 70 tokens
 * once the list is compact JSON with short ids, so 120 items is about 8.5k
 * tokens. Above this, capCandidates keeps the best-ranked pieces from each
 * category so breadth survives the trim.
 */
const MAX_CANDIDATES = 120;

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
                    description:
                      "The short id exactly as it appears in Retrieved Items, " +
                      "e.g. i7.",
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
    // The updated client asks for 1, renders it, then quietly asks for 2 more
    // in the background. Three looks in one call is marginally cheaper (one
    // embed, one retrieval, one prefill), but the user waits on generation:
    // three looks take ~22s to write and one takes ~9s, and the extra prefill
    // is a fraction of a cent against thirteen seconds of spinner.
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
    // High enough that it never binds for a normal wardrobe: the intent is
    // "show everything", with MAX_CANDIDATES as the only real guard. A
    // per-slot limit is the wrong shape for this problem because wardrobes are
    // lopsided — capping every category at N starves the one category with
    // real choice (27 tops here) while the shallow ones return everything they
    // have regardless. Kept finite so a pathological closet can't stream tens
    // of thousands of rows out of Postgres before capCandidates trims them.
    const perCategory = 100;
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
    //
    // Started here but NOT awaited until after the model call: nothing in the
    // prompt depends on it, so waiting for it in line just adds its round trip
    // to the time the user spends staring at a spinner.
    const ownedRowsPromise = (supabase.rpc("closet_categories", {
      filter_user_id: userId,
    }) as PromiseLike<{ data: { category: string; item_count: number }[] | null }>)
      .then((r) => r, () => ({ data: null }));

    if (retrieved.length === 0 && !anchor) {
      // No model call on this path, so waiting on the categories costs nothing.
      const { data: rows } = await ownedRowsPromise;
      const emptyCloset = (rows ?? []).length === 0;
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

    // Candidates are addressed by a short id (i0, i1, …) rather than their
    // UUID. This is a latency change, not a cosmetic one: a UUID costs roughly
    // 18 tokens and appears twice — once in the candidate list the model reads
    // and again in every piece it writes back. Swapping in two-character ids
    // cuts the prompt by ~15 tokens per item and the response by ~18 tokens
    // per piece, and generation speed is what the user actually waits on.
    // Measured on a 30-item closet: 3 looks went from 25.5s to 21.8s, a single
    // look from 10.3s to 9.1s.
    const uuidForPromptId = new Map<string, string>();
    retrieved.forEach((item, n) => uuidForPromptId.set(`i${n}`, item.id));

    const itemsForPrompt = retrieved.map((i, n) => ({
      id: `i${n}`,
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
      // The stylist's knowledge is a separate, cached block. It is
      // byte-identical on every request, and because the render order is
      // tools -> system -> messages, this one breakpoint covers the tool
      // schema too. Everything that varies per request — the query, the
      // retrieved items, the pinned piece — lives in the user message below,
      // after the breakpoint, so it never invalidates the cache.
      //
      // 1h TTL rather than the 5m default: a write costs 2x instead of 1.25x,
      // but reads are 0.1x and the entry survives quiet periods. Traffic here
      // is bursty, so 5m entries would usually expire unused and every request
      // would pay the write premium for a cache nobody read.
      system: [
        {
          type: "text",
          text: STYLIST_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
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

    // Cache observability. cache_read > 0 means the static stylist block was
    // served from cache at ~0.1x; a persistent 0 across requests means
    // something is varying inside the cached prefix and the cache is dead.
    const usageStats = message.usage as unknown as {
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
    console.log(
      "[find-outfit] usage:",
      JSON.stringify({
        cache_write: usageStats.cache_creation_input_tokens ?? 0,
        cache_read: usageStats.cache_read_input_tokens ?? 0,
        uncached_input: usageStats.input_tokens ?? 0,
        output: usageStats.output_tokens ?? 0,
      }),
    );

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
    const { data: ownedRows } = await ownedRowsPromise;
    const ownedRoles = new Set(
      (ownedRows ?? []).map((r) => categoryToRole(r.category)),
    );

    // Retrieval diagnostics. The question this answers: when the outfits are
    // disappointing, is it the wardrobe or the search? If `shown` equals
    // `owned` for a category, the stylist saw everything available and the
    // limit is the closet. If `shown` is well below `owned`, retrieval is
    // filtering out pieces that never got a chance, and per_category is the
    // knob to turn.
    const ownedByRole = new Map<string, number>();
    for (const row of ownedRows ?? []) {
      const role = categoryToRole(row.category);
      ownedByRole.set(role, (ownedByRole.get(role) ?? 0) + row.item_count);
    }
    const shownByRole = new Map<string, number>();
    for (const i of retrieved) {
      const role = categoryToRole(i.category);
      shownByRole.set(role, (shownByRole.get(role) ?? 0) + 1);
    }
    console.log(
      "[find-outfit] candidates:",
      JSON.stringify({
        per_category: perCategory,
        total_shown: retrieved.length,
        by_role: Object.fromEntries(
          [...ownedByRole.entries()].map(([role, owned]) => [
            role,
            `${shownByRole.get(role) ?? 0}/${owned}`,
          ]),
        ),
      }),
    );

    const itemMap = new Map(retrieved.map((i) => [i.id, i]));
    const seenSignatures = new Set<string>();
    const built: unknown[] = [];

    for (const candidate of rawOutfits) {
      const pieces = sanitizePieces(
        resolvePromptIds(candidate?.outfit, uuidForPromptId),
        allowedIds,
        anchor,
      );

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
    // Compact, not pretty-printed: the indentation was pure cost. On a 30-item
    // closet it was ~1,800 of the 3,900 input tokens, and input tokens are
    // paid on every request because the candidate list can't be cached.
    JSON.stringify(itemsForPrompt),
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
/**
 * Maps the short ids the model works with (i0, i1, …) back to the real item
 * UUIDs. Anything unrecognised is passed through untouched so it fails the
 * allowed-id check downstream and gets logged as a hallucination — silently
 * dropping it here would hide the failure.
 */
function resolvePromptIds(raw: unknown, uuidForPromptId: Map<string, string>): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map((entry) => {
    if (typeof entry !== "object" || entry === null) return entry;
    const p = entry as Record<string, unknown>;
    if (typeof p.item_id !== "string") return entry;
    return { ...p, item_id: uuidForPromptId.get(p.item_id) ?? p.item_id };
  });
}

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
