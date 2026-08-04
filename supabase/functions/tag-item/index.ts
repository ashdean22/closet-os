import Anthropic from "npm:@anthropic-ai/sdk";
import { encodeBase64 } from "jsr:@std/encoding/base64";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { checkDailyLimit, DAILY_TAG_LIMIT } from "../_shared/usage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// The tool schema enforces the exact JSON shape — Claude cannot deviate.
const tagTool: Anthropic.Tool = {
  name: "tag_clothing_item",
  description:
    "Extract structured metadata from a clothing item image. " +
    "Fill every field; use your best judgment when details are ambiguous.",
  input_schema: {
    type: "object",
    properties: {
      item_detected: {
        type: "boolean",
        description:
          "True only if the image clearly contains a single wearable item " +
          "(clothing, footwear, or accessory) that can be tagged. False if the " +
          "image shows no wearable item, or is too dark, blurry, or cluttered to " +
          "identify one. When false, the other fields may be left as best guesses.",
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description:
          "Your confidence that the tags are accurate. Use 'low' when poor " +
          "lighting, framing, or focus made the item hard to read.",
      },
      color: {
        type: "string",
        description:
          "Primary color of the item using plain, specific terms " +
          "(e.g. 'navy blue', 'off-white', 'charcoal grey').",
      },
      secondaryColor: {
        type: "string",
        description:
          "Secondary or accent color if clearly present. " +
          "Empty string if the item is a single solid color.",
      },
      category: {
        type: "string",
        enum: ["top", "bottom", "outerwear", "shoes", "accessory", "dress", "other"],
        description: "Garment category.",
      },
      formality: {
        type: "string",
        enum: ["casual", "smart-casual", "business", "formal", "athletic"],
        description:
          "Most appropriate formality level. Prefer the most specific match; " +
          "use 'smart-casual' for items that work in both casual and office settings.",
      },
      season: {
        type: "string",
        enum: ["spring", "summer", "fall", "winter", "all-season"],
        description:
          "Primary season this item is suited for based on weight, fabric, " +
          "and coverage. Use 'all-season' only for genuinely versatile pieces.",
      },
      material: {
        type: "string",
        description:
          "Dominant fabric or material inferred from visual texture and sheen " +
          "(e.g. 'cotton', 'denim', 'leather', 'wool', 'linen', 'polyester'). " +
          "One word or short phrase only.",
      },
      description: {
        type: "string",
        description:
          "One concise sentence (max 25 words) describing the item's style, " +
          "color, and occasion suitability. Written so a vector model can later " +
          "retrieve it by semantic meaning — avoid filler phrases like 'this is a'.",
      },
    },
    required: [
      "item_detected",
      "confidence",
      "color",
      "secondaryColor",
      "category",
      "formality",
      "season",
      "material",
      "description",
    ],
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { image_url } = await req.json();
    if (!image_url || typeof image_url !== "string") {
      return json(
        { error: "image_url (string) is required", reason: "bad_request" },
        400,
      );
    }

    // ── Verify caller identity from the JWT (same pattern as find-outfit) ──
    // Needed for the per-user daily cap; also means anonymous holders of the
    // public anon key can't spend Vision credits.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json(
        { error: "Missing or invalid Authorization header", reason: "unauthorized" },
        401,
      );
    }
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      authHeader.slice(7),
    );
    if (authError || !user) {
      return json(
        { error: "Invalid or expired token — please sign in again", reason: "unauthorized" },
        401,
      );
    }

    // Fetch image from storage and convert to base64 — more reliable than
    // passing the URL directly because signed/auth-gated URLs may not be
    // reachable by Anthropic's servers.
    const imageRes = await fetch(image_url);
    if (!imageRes.ok) {
      return json(
        {
          error: `Failed to fetch image from storage: HTTP ${imageRes.status}`,
          reason: "fetch_failed",
        },
        502,
      );
    }

    const rawContentType = imageRes.headers.get("content-type") ?? "";

    // HEIC/HEIF is common from iPhones but is NOT a media type the vision model
    // accepts. The old code silently relabelled it as image/jpeg, so Anthropic
    // received mislabelled bytes and rejected them with a confusing error. Fail
    // fast with an honest reason instead.
    if (/heic|heif/i.test(rawContentType)) {
      return json(
        {
          error: "HEIC/HEIF images aren't supported — please use JPEG or PNG.",
          reason: "unsupported_format",
        },
        415,
      );
    }
    const mediaType = toAnthropicMediaType(rawContentType);

    const bytes = await imageRes.arrayBuffer();
    // Guard the Anthropic per-image size limit BEFORE we spend a Vision call.
    // A full-resolution phone photo can easily exceed this, which previously
    // surfaced as a generic 500 that looked like a tagging/quality failure.
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return json(
        {
          error: `Image is ${(bytes.byteLength / 1048576).toFixed(1)}MB, over the ` +
            `${MAX_IMAGE_BYTES / 1048576}MB vision limit.`,
          reason: "image_too_large",
        },
        413,
      );
    }
    const base64Data = encodeBase64(bytes);

    // ── Daily cost cap — checked after cheap validations, right before the
    // Vision call, so oversized/unsupported images don't burn quota.
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const usage = await checkDailyLimit(serviceClient, user.id, "tag", DAILY_TAG_LIMIT);
    if (!usage.ok) {
      return json(usage.body, usage.status);
    }

    const anthropic = new Anthropic({
      apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
      // The SDK default is 2 automatic retries on 429/5xx. Zero keeps a failing
      // request from tripling spend/latency — the user retries manually.
      maxRetries: 0,
    });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      // tool_choice: { type: "tool" } forces Claude to call our tool,
      // guaranteeing the response is always valid structured JSON.
      tool_choice: { type: "tool", name: "tag_clothing_item" },
      tools: [tagTool],
      system:
        "You are a fashion-aware clothing tagger. Your FIRST and most important " +
        "job is to decide whether the image actually shows a single, clearly " +
        "visible wearable item — a garment, pair of shoes, or accessory.\n\n" +
        "Set item_detected=false (and do NOT invent any tag values) whenever the " +
        "image is NOT a clear, taggable wearable item. This includes: a blank or " +
        "plain wall, floor, ceiling, door, or sky; furniture, rooms, or interiors; " +
        "food, plants, animals, people with no single clear garment, landscapes, " +
        "screenshots, or text; an empty or near-empty frame; or any image too " +
        "dark, blurry, or cluttered to identify one specific garment. A flat " +
        "expanse of uniform color (e.g. a painted wall) is NOT clothing. When in " +
        "doubt, set item_detected=false rather than guessing.\n\n" +
        "Only set item_detected=true when you can point to a specific wearable " +
        "item in the frame. Use confidence='low' when lighting, blur, or framing " +
        "make the tags largely a guess.\n\n" +
        "When item_detected=true, fill all fields accurately. If the item has a " +
        "pattern (e.g. stripes, plaid), use the dominant ground color as 'color' " +
        "and the pattern color as 'secondaryColor'. Never fabricate details for " +
        "something you cannot actually see.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64Data,
              },
            },
            {
              type: "text",
              text:
                "Use the tag_clothing_item tool on this image. First decide whether " +
                "it contains a single, clearly visible wearable item (clothing, " +
                "shoes, or accessory). If it does NOT — for example a blank wall, " +
                "floor, furniture, or any non-garment image — set item_detected=false " +
                "and do not invent tags. Only fill in attributes when an item is " +
                "genuinely present.",
            },
          ],
        },
      ],
    });

    // tool_choice forces a tool_use block, but a max_tokens cutoff mid-tool can
    // still yield a non-tool / partial block. Treat that as a parse failure
    // (a service problem), NOT a photo-quality problem.
    const block = message.content[0];
    if (!block || block.type !== "tool_use") {
      console.error(
        "[tag-item] no tool_use block; stop_reason:",
        message.stop_reason,
      );
      return json(
        {
          error: "The vision model returned an unexpected response.",
          reason: "parse_error",
        },
        502,
      );
    }

    const result = block.input as TagResult;

    // Log exactly what the model decided so a wrongly-saved (or wrongly-rejected)
    // image can be diagnosed from the function logs.
    console.log(
      "[tag-item] result:",
      JSON.stringify({
        item_detected: result.item_detected,
        confidence: result.confidence,
        category: result.category,
      }),
    );

    // The ONLY honest trigger for a "try better lighting / framing" message:
    // the model itself reports it couldn't find a wearable item, or tagged it
    // with low confidence. Everything else is a service/input failure.
    //
    // Fail closed: only proceed to tag when item_detected is explicitly true.
    // Anything else (false, or a missing/non-boolean value) is treated as
    // no_item, so we never save a row for an unrecognised image.
    if (result.item_detected !== true || result.confidence === "low") {
      return json(
        {
          error: "Couldn't confidently identify a clothing item in the photo.",
          reason: "no_item",
        },
        422,
      );
    }

    // Strip the control fields so the client receives only tag data.
    const { item_detected: _d, confidence: _c, ...tags } = result;
    return json(tags);
  } catch (err) {
    return mapTagError(err);
  }
});

// Maps an internal failure to an honest, specific HTTP status + reason code.
// `reason` lets the app pick the right user-facing message without guessing
// from a stringly-typed error.
function mapTagError(err: unknown): Response {
  const status =
    typeof (err as { status?: unknown })?.status === "number"
      ? (err as { status: number }).status
      : null;
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[tag-item] failure", status ?? "(no status)", msg);

  if (status === 429) {
    return json(
      { error: "Vision service rate limit reached.", reason: "rate_limited" },
      429,
    );
  }
  if (status === 529 || status === 503) {
    return json(
      { error: "Vision service is overloaded.", reason: "overloaded" },
      503,
    );
  }
  if (status === 408 || /timeout|timed out|etimedout|connection error/i.test(msg)) {
    return json(
      { error: "Vision request timed out.", reason: "timeout" },
      504,
    );
  }
  if (status === 401 || status === 403) {
    // Bad/missing ANTHROPIC_API_KEY — a config problem, not the user's photo.
    return json(
      { error: "Vision service authentication failed.", reason: "service_config" },
      502,
    );
  }
  if (
    status === 400 &&
    /image|media_type|base64|dimension|pixel|could not process/i.test(msg)
  ) {
    return json(
      { error: `Vision API rejected the image: ${msg}`, reason: "image_rejected" },
      422,
    );
  }
  return json({ error: msg, reason: "unknown" }, 500);
}

// ── helpers ─────────────────────────────────────────────────────────────────

// Anthropic's documented per-image limit is 5MB. We guard the raw bytes before
// base64-encoding so an oversized photo fails fast with a clear reason.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type TagResult = {
  item_detected: boolean;
  confidence: "high" | "medium" | "low";
  color: string;
  secondaryColor: string;
  category: string;
  formality: string;
  season: string;
  material: string;
  description: string;
};

type AnthropicMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function toAnthropicMediaType(contentType: string): AnthropicMediaType {
  if (contentType.includes("png")) return "image/png";
  if (contentType.includes("gif")) return "image/gif";
  if (contentType.includes("webp")) return "image/webp";
  return "image/jpeg"; // default for jpg/heic/unknown
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
