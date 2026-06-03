import Anthropic from "npm:@anthropic-ai/sdk";
import { encodeBase64 } from "jsr:@std/encoding/base64";

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
      return json({ error: "image_url (string) is required" }, 400);
    }

    // Fetch image from storage and convert to base64 — more reliable than
    // passing the URL directly because signed/auth-gated URLs may not be
    // reachable by Anthropic's servers.
    const imageRes = await fetch(image_url);
    if (!imageRes.ok) {
      return json(
        { error: `Failed to fetch image: HTTP ${imageRes.status}` },
        400,
      );
    }

    const rawContentType = imageRes.headers.get("content-type") ?? "";
    const mediaType = toAnthropicMediaType(rawContentType);
    const base64Data = encodeBase64(await imageRes.arrayBuffer());

    const anthropic = new Anthropic({
      apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
    });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      // tool_choice: { type: "tool" } forces Claude to call our tool,
      // guaranteeing the response is always valid structured JSON.
      tool_choice: { type: "tool", name: "tag_clothing_item" },
      tools: [tagTool],
      system:
        "You are a fashion-aware clothing tagger. Analyze the image carefully " +
        "and fill all fields accurately. If the item has a pattern (e.g. stripes, " +
        "plaid), use the dominant ground color as 'color' and the pattern color " +
        "as 'secondaryColor'.",
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
              text: "Tag this clothing item using the tag_clothing_item tool.",
            },
          ],
        },
      ],
    });

    // tool_choice: { type: "tool" } guarantees content[0] is always tool_use.
    const block = message.content[0];
    if (block.type !== "tool_use") {
      throw new Error(`Unexpected content block type: ${block.type}`);
    }

    return json(block.input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[tag-item]", message);
    return json({ error: message }, 500);
  }
});

// ── helpers ─────────────────────────────────────────────────────────────────

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
