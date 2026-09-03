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

/** The tag columns every candidate and pinned piece is selected with. */
const ITEM_COLUMNS =
  "id, image_url, color, secondary_color, category, formality, season, " +
  "material, description";

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

/**
 * Slots the closet must be able to fill before a search is worth running.
 *
 * Shoes are deliberately absent. A top and a bottom are the outfit; shoes
 * complete it. Someone who has photographed six shirts and four pairs of
 * trousers but no footwear yet should still get styled — after being told,
 * once, that the looks will come back barefoot.
 */
const REQUIRED_ROLES: Role[] = ["top", "bottom"];

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

/**
 * The escape hatch from build_outfits.
 *
 * Offered as a tool rather than handled by a separate classifier call because
 * the judgement needs the same context the styling does, and a second model
 * round trip to screen every query would cost more latency than the rare
 * nonsense request is worth. tool_choice "any" forces exactly one of the two.
 */
const flagUnwearableTool: Anthropic.Tool = {
  name: "flag_unwearable_request",
  description:
    "Call this INSTEAD of build_outfits when the request asks to be dressed " +
    "for a place or activity that ordinary clothing cannot survive — a day on " +
    "the moon, a deep-sea dive, walking through fire. A request merely " +
    "INSPIRED BY such a thing ('a moon-landing vibe', 'space-age silver') is " +
    "an aesthetic and must be built normally, never flagged.",
  input_schema: {
    type: "object",
    properties: {
      note: {
        type: "string",
        description:
          "One or two sentences addressed to the user, explaining plainly why " +
          "this needs equipment rather than an outfit. Dry, never scolding.",
      },
      suggestion: {
        type: "string",
        description:
          "The same idea rephrased as something buildable, quoted so the user " +
          "can reuse it — e.g. 'an outfit inspired by a moon landing'.",
      },
    },
    required: ["note", "suggestion"],
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
    // Pieces of the look already on screen that the user wants to keep while
    // one of them is swapped out ("that shirt is in the laundry"). Pinned
    // exactly like an anchor, so the stylist only refills the slot that opened.
    const keepItemIds: string[] = Array.isArray(body?.keep_item_ids)
      ? body.keep_item_ids.filter((id: unknown) => typeof id === "string")
      : [];
    // Set once the user has been told they own no shoes and chose to go on.
    const allowMissingShoes = body?.allow_missing_shoes === true;
    // Whether the caller can render a refusal and offer a way past it. Only
    // the updated client sends this. A shipped build that cannot show a
    // "style it anyway" button must not be handed a question it has no way to
    // answer — for those, no shoes stays what it always was: a look with no
    // shoes in it, and an honest note in the missing list.
    const supportsBlocking = body?.supports_blocking === true;
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

    // ── Step 0: resolve the pinned pieces ─────────────────────────
    // Two kinds, resolved identically: the anchor is a piece the user chose to
    // build around, and keep_item_ids are the pieces of the look on screen that
    // survived a "that one is in the laundry" swap. Both are fixed points the
    // stylist builds around rather than chooses.
    //
    // One query, explicitly scoped by user_id: an id belonging to someone
    // else's closet must not leak its photo or tags back through this endpoint.
    const pinnedRequestIds = [
      ...new Set([...(anchorItemId ? [anchorItemId] : []), ...keepItemIds]),
    ];

    let anchor: RetrievedItem | null = null;
    let kept: RetrievedItem[] = [];

    if (pinnedRequestIds.length > 0) {
      const { data: pinnedRows, error: pinnedError } = await supabase
        .from("items")
        .select(ITEM_COLUMNS)
        .in("id", pinnedRequestIds)
        .eq("user_id", userId);

      if (pinnedError) {
        throw new Error(`pinned lookup failed: ${pinnedError.message}`);
      }

      const byId = new Map(
        (pinnedRows ?? []).map((row) => [
          row.id as string,
          { ...row, similarity: 1, category_rank: 0 } as RetrievedItem,
        ]),
      );

      if (anchorItemId) {
        const found = byId.get(anchorItemId);
        // The anchor is the whole point of the request, so its disappearance
        // is an error the user has to resolve.
        if (!found) {
          return json(
            {
              error: "That item is no longer in your closet.",
              reason: "anchor_not_found",
            },
            404,
          );
        }
        anchor = found;
      }

      // A kept piece that has since been deleted is quietly dropped instead:
      // the stylist refills its slot, which is exactly what a swap asks for.
      kept = keepItemIds
        .filter((id) => id !== anchorItemId)
        .map((id) => byId.get(id))
        .filter((item): item is RetrievedItem => item !== undefined);
    }

    const pinned: RetrievedItem[] = anchor ? [anchor, ...kept] : kept;
    const keptIds = new Set(kept.map((k) => k.id));

    // ── Step 1: what the closet actually holds ───────────────────────
    // Awaited up front rather than raced with the model call, because two
    // later decisions depend on it: whether the request can be answered at all,
    // and whether retrieval needs to embed anything. It is one indexed GROUP BY
    // over a single user's rows — far cheaper than the Gemini round trip it
    // goes on to save.
    //
    // The raw count runs alongside it to tell an empty closet apart from a
    // closet whose photos are still being tagged: closet_categories only counts
    // rows that already carry an embedding.
    const [ownedResult, rawCountResult] = await Promise.all([
      (supabase.rpc("closet_categories", {
        filter_user_id: userId,
      }) as unknown as PromiseLike<
        { data: { category: string; item_count: number }[] | null }
      >).then((r) => r, () => ({ data: null })),
      (supabase
        .from("items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId) as unknown as PromiseLike<{ count: number | null }>)
        .then((r) => r, () => ({ count: null })),
    ]);

    const owned = ownedResult.data ?? [];
    const ownedByRole = new Map<Role, number>();
    for (const row of owned) {
      const role = categoryToRole(row.category);
      ownedByRole.set(role, (ownedByRole.get(role) ?? 0) + row.item_count);
    }
    const ownedRoles = new Set(ownedByRole.keys());
    const totalOwned = owned.reduce((n, row) => n + row.item_count, 0);
    const rawItemCount = rawCountResult.count ?? 0;

    /** A dress fills the top and bottom slots on its own, but never the shoes. */
    const closetCovers = (role: Role) =>
      ownedRoles.has(role) || (role !== "shoes" && ownedRoles.has("dress"));

    // ── Step 2: refuse what the closet cannot answer ─────────────────
    // Deliberately ahead of checkDailyLimit. Telling somebody they own no
    // trousers costs nothing to work out, and must not spend one of their few
    // daily searches — an empty closet would otherwise burn the whole day's
    // allowance discovering it is empty. Nothing below this point is free.
    if (totalOwned === 0) {
      return rawItemCount > 0
        ? blocked(
            query,
            "closet_processing",
            "Your closet is still being catalogued — give it a moment and try " +
              "again.",
          )
        : blocked(
            query,
            "empty_closet",
            "Add some clothes first. The stylist needs at least a top and a " +
              "bottom in your closet before it can put a look together.",
            { missing_categories: REQUIRED_ROLES },
          );
    }

    const missingRequired = REQUIRED_ROLES.filter((role) => !closetCovers(role));
    if (missingRequired.length > 0) {
      return blocked(
        query,
        "insufficient_closet",
        `Your closet has no ${listRoles(missingRequired)} yet. Add at least one ` +
          "of each, and the stylist can build a complete look.",
        { missing_categories: missingRequired },
      );
    }

    // Shoes are optional, but not silently so: the user is told once, and the
    // client resends with allow_missing_shoes to go ahead barefoot.
    if (!closetCovers("shoes") && !allowMissingShoes && supportsBlocking) {
      return blocked(
        query,
        "needs_shoes_confirmation",
        "You have no shoes in your closet. The stylist can still build the " +
          "rest of the look — tops and bottoms are all it really needs.",
        { missing_categories: ["shoes"] },
      );
    }

    // ── Step 3: daily cost cap ──────────────────────────────
    // Still one increment per call regardless of how many variations come back,
    // because the cost driver is the round-trip, not the outfit count.
    const usage = await checkDailyLimit(supabase, userId, "outfit", DAILY_OUTFIT_LIMIT);
    if (!usage.ok) {
      return json(usage.body, usage.status);
    }

    // ── Step 4: gather candidates ───────────────────────────
    // Two paths, chosen by closet size.
    //
    // Below MAX_CANDIDATES the stylist ends up seeing the entire wardrobe
    // whichever path runs, so ranking it is work with no consequence: the
    // embedding is a Gemini round trip whose only product is an order the
    // prompt explicitly calls a hint. Skipping it takes a network call out of
    // the wait and removes a third-party dependency from the common path.
    // Nearly every real closet takes this branch.
    //
    // Above the cap the ranking earns its keep, because it decides which pieces
    // get dropped. There the embed and the stratified vector search run as
    // before.
    const excludeIds = [
      ...new Set([...excludeItemIds, ...pinned.map((piece) => piece.id)]),
    ];

    // A role the pinned pieces have already filled to capacity is dropped from
    // the candidate pool entirely, so the model physically cannot pair a second
    // top with a pinned top. Counted rather than flagged because accessories
    // may legitimately layer two deep.
    const pinnedRoleCounts = new Map<Role, number>();
    for (const piece of pinned) {
      for (const role of rolesCoveredBy(categoryToRole(piece.category))) {
        pinnedRoleCounts.set(role, (pinnedRoleCounts.get(role) ?? 0) + 1);
      }
    }
    const saturated = (role: Role) =>
      (pinnedRoleCounts.get(role) ?? 0) >= (MAX_PER_ROLE[role] ?? 1);

    const ranked = totalOwned > MAX_CANDIDATES;
    let pool: RetrievedItem[];

    if (!ranked) {
      const { data: rows, error: closetError } = await supabase
        .from("items")
        .select(ITEM_COLUMNS)
        .eq("user_id", userId)
        // Matches closet_categories, so the counts above describe the same set
        // of rows the stylist is about to see.
        .not("embedding", "is", null);

      if (closetError) {
        throw new Error(`closet fetch failed: ${closetError.message}`);
      }

      const dropped = new Set(excludeIds);
      pool = (rows ?? [])
        .filter((row) => !dropped.has(row.id as string))
        .map((row) => ({ ...row, similarity: 0, category_rank: 0 } as RetrievedItem));
    } else {
      // Uses the SAME model (gemini-embedding-001), outputDimensionality (768),
      // and L2-normalisation as embed-item via the shared helper. Query and
      // stored vectors MUST be identical in production or distances are
      // meaningless.
      //
      // With an anchor we embed a composite string rather than the raw query, so
      // retrieval pulls pieces that pair with the anchor's colour/fabric/
      // formality instead of items that merely resemble the typed words.
      const geminiKey = Deno.env.get("GEMINI_API_KEY");
      if (!geminiKey) throw new Error("GEMINI_API_KEY secret is not set");

      const searchText = buildSearchText(query, anchor ?? pinned[0] ?? null);
      const queryVector = await embedText(searchText, geminiKey);

      // per_category guarantees the candidate set has options for every slot the
      // closet can fill — a flat top-N could return ten shirts and no shoes,
      // which made a complete outfit impossible regardless of prompting.
      // High enough that it never binds for a normal wardrobe: the intent is
      // "show everything", with MAX_CANDIDATES as the only real guard.
      const { data: items, error: rpcError } = await supabase.rpc(
        "match_items_stratified",
        {
          query_embedding: `[${queryVector.join(",")}]`,
          filter_user_id: userId,
          per_category: 100,
          exclude_ids: excludeIds,
        },
      ) as { data: RetrievedItem[] | null; error: { message: string } | null };

      if (rpcError) {
        throw new Error(`match_items_stratified RPC error: ${rpcError.message}`);
      }
      pool = items ?? [];
    }

    const retrieved = capCandidates(
      pool.filter((item) => !saturated(categoryToRole(item.category))),
    );

    if (retrieved.length === 0 && pinned.length === 0) {
      return blocked(
        query,
        "no_candidates",
        "Nothing left to pull from — try a different search or start a fresh " +
          "one.",
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
      // Omitted entirely on the unranked path: every score there is 0, and a
      // column of zeroes is both misleading to the model and paid for on every
      // request, since the candidate list is the part that cannot be cached.
      ...(ranked ? { similarity: Math.round(i.similarity * 1000) / 1000 } : {}),
    }));

    // Only ask for slots that are still open AND fillable. Demanding shoes from
    // a closet with no shoes just invites the model to hallucinate one, and
    // demanding a top when a pinned top is already in the look invites a second.
    const fillableCore = CORE_ROLES.filter(
      (role) =>
        !saturated(role) &&
        (retrieved.some((i) => categoryToRole(i.category) === role) ||
          (retrieved.some((i) => categoryToRole(i.category) === "dress") &&
            role !== "shoes")),
    );

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      // Three looks of ~5 pieces, each with a reason sentence, needs materially
      // more room than the single-outfit version's 1024.
      max_tokens: 3072,
      // "any" rather than a named tool: the model must call one of the two,
      // which keeps the response parseable, but it chooses between styling the
      // request and refusing it as unwearable. Naming build_outfits would have
      // forced an outfit for a moonwalk.
      tool_choice: { type: "any" },
      tools: [buildOutfitsTool, flagUnwearableTool],
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
            kept,
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

    // tool_choice: { type: "any" } guarantees a tool_use block, but a
    // max_tokens cutoff mid-tool can still yield a partial/non-tool block.
    const block = message.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      console.error(
        "[find-outfit] no tool_use block; stop_reason:",
        message.stop_reason,
      );
      throw new Error("The stylist returned an unexpected response.");
    }

    // The stylist judged this a request for equipment rather than clothing.
    if (block.name === flagUnwearableTool.name) {
      const flagged = block.input as { note?: string; suggestion?: string };
      console.log("[find-outfit] flagged as unwearable:", JSON.stringify({ query }));
      return blocked(
        query,
        "implausible_request",
        typeof flagged?.note === "string" && flagged.note.trim()
          ? flagged.note.trim()
          : "That asks for equipment rather than an outfit — no wardrobe covers it.",
        {
          suggestion:
            typeof flagged?.suggestion === "string" ? flagged.suggestion.trim() : "",
        },
      );
    }

    const result = block.input as ModelResult;
    const rawOutfits = Array.isArray(result?.outfits) ? result.outfits : [];

    // ── Step 5: validate, pin the fixed pieces, report honest gaps ────────
    // ownedRoles and ownedByRole were computed in Step 1 and are reused here
    // rather than refetched — the closet cannot have changed mid-request.

    // Retrieval diagnostics. The question this answers: when the outfits are
    // disappointing, is it the wardrobe or the search? If `shown` equals
    // `owned` for a category, the stylist saw everything available and the
    // limit is the closet. If `shown` is well below `owned`, retrieval is
    // filtering out pieces that never got a chance.
    const shownByRole = new Map<string, number>();
    for (const i of retrieved) {
      const role = categoryToRole(i.category);
      shownByRole.set(role, (shownByRole.get(role) ?? 0) + 1);
    }
    console.log(
      "[find-outfit] candidates:",
      JSON.stringify({
        ranked,
        total_shown: retrieved.length,
        pinned: pinned.length,
        by_role: Object.fromEntries(
          [...ownedByRole.entries()].map(([role, ownedCount]) => [
            role,
            `${shownByRole.get(role) ?? 0}/${ownedCount}`,
          ]),
        ),
      }),
    );

    const itemMap = new Map<string, RetrievedItem>([
      ...retrieved.map((i) => [i.id, i] as const),
      ...pinned.map((i) => [i.id, i] as const),
    ]);
    const seenSignatures = new Set<string>();
    const built: unknown[] = [];

    for (const candidate of rawOutfits) {
      const pieces = sanitizePieces(
        resolvePromptIds(candidate?.outfit, uuidForPromptId),
        allowedIds,
        pinned,
        anchor?.id ?? null,
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
          item: itemMap.get(piece.item_id) ?? null,
          is_anchor: piece.item_id === anchor?.id,
          // Carried through so the client can restore the reason it already
          // showed for this piece instead of the placeholder written below.
          is_kept: keptIds.has(piece.item_id),
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
      return blocked(
        query,
        "no_looks",
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
  kept,
  itemsForPrompt,
  variations,
  fillableCore,
}: {
  query: string;
  anchor: RetrievedItem | null;
  kept: RetrievedItem[];
  itemsForPrompt: unknown[];
  variations: number;
  fillableCore: Role[];
}): string {
  const lines: string[] = [];

  lines.push(query ? `Query: "${query}"` : "Query: (none given — style around the pinned pieces)");

  const describe = (item: RetrievedItem) => ({
    category: item.category,
    color: item.color,
    secondary_color: item.secondary_color,
    formality: item.formality,
    season: item.season,
    material: item.material,
    description: item.description,
  });

  if (anchor) {
    lines.push(
      "",
      "PINNED PIECE — the user specifically wants to wear this, and it is " +
        "already in every outfit. Do NOT include it in your outfit arrays, and " +
        "do NOT pick anything that fills the same role. Build around it:",
      JSON.stringify(describe(anchor), null, 2),
    );
  }

  if (kept.length > 0) {
    lines.push(
      "",
      "ALREADY IN THE LOOK — the user is replacing one piece of an outfit they " +
        "are already wearing in their head, and has kept these. They are " +
        "fixed. Do NOT include them in your outfit arrays and do NOT pick " +
        "anything that fills the same role. Choose only what is missing, and " +
        "make it work with these:",
      JSON.stringify(kept.map(describe), null, 2),
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
  pinned: RetrievedItem[],
  anchorId: string | null,
): OutfitPiece[] {
  const pieces: OutfitPiece[] = [];
  const roleCounts = new Map<Role, number>();
  const usedIds = new Set<string>();

  // Pinned pieces go in first and unconditionally: they are the user's
  // decision, not the model's, and seeding roleCounts with them is what stops
  // the model from adding a second piece to a slot that is already filled.
  for (const piece of pinned) {
    const role = categoryToRole(piece.category);
    pieces.push({
      item_id: piece.id,
      role,
      reason:
        piece.id === anchorId
          ? "You picked this piece — the rest of the look is built around it."
          : "Kept from the look you were just shown.",
    });
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
    usedIds.add(piece.id);
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

/**
 * A 200 that carries no outfit, and says why.
 *
 * Status 200 rather than 4xx is deliberate back-compat: v1.0.0 is live on the
 * App Store and renders `rationale` from a 200 while turning any non-2xx into
 * a generic "something went wrong". So the prose has to stand on its own for
 * old clients, and `reason` is the extra the new client branches on.
 */
function blocked(
  query: string,
  reason: string,
  rationale: string,
  extra: Record<string, unknown> = {},
): Response {
  return json({
    query,
    anchor: null,
    variations: [],
    outfit: [],
    rationale,
    missing: CORE_ROLES,
    reason,
    blocked: true,
    ...extra,
  });
}

/** "tops and shoes" — for a sentence, not a bullet list. */
function listRoles(roles: Role[]): string {
  const words = roles.map((role) => (role === "bottom" ? "bottoms" : `${role}s`));
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
