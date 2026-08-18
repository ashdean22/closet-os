import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from "react-native";
import ScreenWrapper from "../components/ScreenWrapper";
import DecoHeader from "../components/DecoHeader";
import ErrorBoundary from "../components/ErrorBoundary";
import { supabase } from "../lib/supabase";
import { colors, fonts, tracking } from "../lib/theme";
import { readFunctionError } from "../lib/functionErrors";

// ── Types ─────────────────────────────────────────────────────────────────────

type ItemDetail = {
  id: string;
  image_url: string | null;
  category: string | null;
  color: string | null;
  formality: string | null;
  season: string | null;
  material: string | null;
  description: string | null;
};

type OutfitPiece = {
  item_id: string;
  role: string;
  reason: string;
  item: ItemDetail | null;
};

type OutfitResult = {
  query: string;
  outfit: OutfitPiece[];
  rationale: string;
  missing: string[];
};

// ── Screen ────────────────────────────────────────────────────────────────────

export default function OutfitScreen() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OutfitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  // Guards against setState after unmount (suspect #3). The screen normally
  // stays mounted across tab switches, but this keeps the async path safe.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleFind = async () => {
    if (!query.trim()) return;
    Keyboard.dismiss();
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke<unknown>(
        "find-outfit",
        { body: { query: query.trim() } },
      );

      if (fnError) {
        // Unwrap the real status + reason from the response body — the raw
        // error is just "non-2xx status code". daily_limit (429) gets its own
        // honest message instead of a generic failure.
        const detail = await readFunctionError(fnError);
        console.error(
          "[find-outfit] failed:",
          detail.status ?? "(no status)",
          detail.reason ?? "(no reason)",
          detail.message,
        );
        if (detail.reason === "daily_limit") {
          throw new Error("daily_limit");
        }
        throw new Error(detail.message);
      }
      if (!data) throw new Error("find-outfit returned no data");

      // The function can return HTTP 200 with an error body or a drifted shape;
      // invoke() only routes non-2xx to `fnError`, so we validate here. This is
      // the primary defense — a malformed body becomes a friendly error state
      // instead of a render crash (TypeError on .length/.map).
      const normalized = normalizeOutfitResult(data);
      if (!normalized) {
        const serverError =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: unknown }).error)
            : "Unexpected response from the server.";
        throw new Error(serverError);
      }

      if (mounted.current) setResult(normalized);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (mounted.current) setError(friendlyOutfitError(raw));
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  return (
    <ErrorBoundary label="Outfit">
    <ScreenWrapper>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 20, gap: 20 }}
        >
          {/* ── Header ─────────────────────────────────────────────────── */}
          <DecoHeader title="Find an Outfit" />

          {/* ── Query input ────────────────────────────────────────────── */}
          <View className="gap-3">
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="e.g. outfit for a 65° rainy interview"
              placeholderTextColor={colors.inkFaint}
              returnKeyType="search"
              onSubmitEditing={handleFind}
              multiline={false}
              // Explicit style prevents Android text-clipping caused by
              // includeFontPadding collapsing the NativeWind py-* height.
              style={{
                borderWidth: 1,
                borderColor: colors.edge,
                borderRadius: 4,
                paddingHorizontal: 16,
                paddingVertical: 14,
                fontSize: 16,
                color: colors.ink,
                backgroundColor: colors.surface,
              }}
            />
            <TouchableOpacity
              onPress={handleFind}
              disabled={!query.trim() || loading}
              className={`py-4 rounded items-center flex-row justify-center gap-2 ${
                query.trim() && !loading ? "bg-rust" : "bg-sunken"
              }`}
            >
              {loading ? (
                <>
                  <ActivityIndicator size="small" color={colors.ground} />
                  <Text className="text-ground text-base font-semibold">
                    Styling…
                  </Text>
                </>
              ) : (
                <Text
                  className={`text-base font-semibold ${
                    query.trim() && !loading ? "text-ground" : "text-ink-faint"
                  }`}
                >
                  Find My Outfit
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* ── Error ──────────────────────────────────────────────────── */}
          {error && (
            <View className="bg-danger-tint border border-danger-edge rounded p-4 gap-3">
              <Text className="text-danger text-sm font-semibold">
                Couldn't find an outfit
              </Text>
              <Text className="text-danger text-sm leading-5">{error}</Text>
              <TouchableOpacity
                onPress={handleFind}
                className="self-start bg-danger-tint px-4 py-2 rounded"
              >
                <Text className="text-danger text-sm font-semibold">Try again</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Loading state ──────────────────────────────────────────── */}
          {loading && (
            <View className="items-center py-16 gap-4">
              <ActivityIndicator size="large" color={colors.rust} />
              <Text className="text-ink-soft text-base font-medium">
                Finding your outfit…
              </Text>
              <Text className="text-ink-faint text-xs">
                Embedding query · searching closet · styling with Claude
              </Text>
            </View>
          )}

          {/* ── Empty / prompt state ────────────────────────────────────── */}
          {!loading && !result && !error && (
            <View className="items-center py-16 gap-3">
              <Text className="text-4xl">✦</Text>
              <Text className="text-ink-soft text-base text-center">
                Describe the occasion, weather, or vibe and Claude will build an outfit from your closet.
              </Text>
            </View>
          )}

          {/* ── Results ────────────────────────────────────────────────── */}
          {result && <OutfitResults result={result} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenWrapper>
    </ErrorBoundary>
  );
}

// ── OutfitResults ─────────────────────────────────────────────────────────────

function OutfitResults({ result }: { result: OutfitResult }) {
  // Defensive defaults: even though normalizeOutfitResult guarantees arrays,
  // guard again here so a future shape change can never throw during render.
  const outfit = Array.isArray(result.outfit) ? result.outfit : [];
  const missing = Array.isArray(result.missing) ? result.missing : [];
  const rationale = result.rationale ?? "Here's a look from your closet.";

  return (
    <View className="gap-4">
      {/* Rationale banner */}
      <View className="bg-rust-tint border border-rust-muted rounded p-4">
        <Text className="text-rust text-xs font-semibold uppercase tracking-wide mb-1">
          Styled for
        </Text>
        {result.query ? (
          <Text className="text-rust-deep text-sm font-medium italic leading-5">
            "{result.query}"
          </Text>
        ) : null}
        <Text className="text-rust-deep text-sm leading-5 mt-2">
          {rationale}
        </Text>
      </View>

      {/* Outfit pieces */}
      {outfit.length === 0 ? (
        <View className="bg-notice-tint border border-notice-edge rounded p-4 gap-1">
          <Text className="text-notice text-sm font-semibold">
            {closetIsEmpty(rationale)
              ? "Your closet is empty"
              : "No matching items found"}
          </Text>
          <Text className="text-notice text-sm leading-5">
            {closetIsEmpty(rationale)
              ? "Add and save some items first — the AI needs photos to work with."
              : "Try rephrasing your query, or add more variety to your closet."}
          </Text>
        </View>
      ) : (
        <View className="gap-3">
          {outfit.map((piece, i) => (
            <OutfitCard key={piece?.item_id ?? i} piece={piece} />
          ))}
        </View>
      )}

      {/* Missing items */}
      {missing.length > 0 && (
        <View className="bg-notice-tint border border-notice-edge rounded p-4 gap-2">
          <Text className="text-notice text-xs font-semibold uppercase tracking-wide">
            Missing from your closet
          </Text>
          {missing.map((m, i) => (
            <View key={i} className="flex-row items-center gap-2">
              <Text className="text-notice">•</Text>
              <Text className="text-notice text-sm capitalize">
                {String(m ?? "")}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── OutfitCard ────────────────────────────────────────────────────────────────

function OutfitCard({ piece }: { piece: OutfitPiece }) {
  // piece itself may be malformed if the response shape drifts; default it.
  const item = piece?.item;
  const role = piece?.role ?? "item";
  const reason = piece?.reason ?? "";
  const { bg, text } = rolePillStyle(role);

  return (
    <View className="flex-row bg-surface border border-edge rounded overflow-hidden">
      {/* Thumbnail */}
      {item?.image_url ? (
        <Image
          source={{ uri: item.image_url }}
          style={{ width: 88, height: 88 }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={{ width: 88, height: 88 }}
          className="bg-sunken items-center justify-center"
        >
          <Text className="text-ink-faint text-xs">No photo</Text>
        </View>
      )}

      {/* Details */}
      <View className="flex-1 px-3 py-3 gap-1 justify-center">
        {/* Role badge + item label */}
        <View className="flex-row items-center gap-2">
          <View className={`px-2 py-0.5 rounded-full ${bg}`}>
            <Text className={`text-xs font-semibold capitalize ${text}`}>
              {role}
            </Text>
          </View>
          {item?.color ? (
            <Text className="text-ink-faint text-xs capitalize" numberOfLines={1}>
              {item.color}
              {item.category ? ` · ${item.category}` : ""}
            </Text>
          ) : null}
        </View>

        {/* Claude's reason */}
        <Text className="text-ink text-sm leading-5" numberOfLines={3}>
          {reason}
        </Text>
      </View>
    </View>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Validates and normalizes an unknown response body into an OutfitResult.
 * Returns null when the body can't plausibly be an outfit result (e.g. an
 * `{ error }` body returned with HTTP 200, or a drifted shape). A null return
 * tells the caller to show a friendly error rather than crash on render.
 */
function normalizeOutfitResult(data: unknown): OutfitResult | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;

  // An error body with no outfit array is not a valid result.
  if (!Array.isArray(d.outfit)) return null;

  const outfit: OutfitPiece[] = (d.outfit as unknown[])
    .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
    .map((p) => ({
      item_id: typeof p.item_id === "string" ? p.item_id : "",
      role: typeof p.role === "string" ? p.role : "item",
      reason: typeof p.reason === "string" ? p.reason : "",
      item: (p.item ?? null) as OutfitPiece["item"],
    }));

  return {
    query: typeof d.query === "string" ? d.query : "",
    outfit,
    rationale: typeof d.rationale === "string" ? d.rationale : "",
    missing: Array.isArray(d.missing) ? (d.missing as string[]) : [],
  };
}

/** Maps raw error strings to user-readable messages. */
function friendlyOutfitError(raw: string): string {
  if (raw === "daily_limit")
    return "You've hit today's outfit limit — it resets tomorrow.";
  if (/network|fetch|failed to fetch|offline|internet/i.test(raw))
    return "Can't reach the server. Check your connection and try again.";
  if (/no embedded items|add some pieces/i.test(raw))
    return "Your closet has no items yet. Add some photos first, then search.";
  if (/unauthorized|401|jwt expired|invalid.*token/i.test(raw))
    return "Your session expired — sign out and back in, then try again.";
  if (/timeout|timed out/i.test(raw))
    return "The request timed out. Try again in a moment.";
  // Generic fallback — still friendlier than a raw stack trace
  return "Something went wrong. Please try again.";
}

/** True when the Edge Function returned its "no embedded items" rationale. */
function closetIsEmpty(rationale: string): boolean {
  return /no embedded items|add some pieces/i.test(rationale);
}

// ── Role badge colours ────────────────────────────────────────────────────────

function rolePillStyle(role: string): { bg: string; text: string } {
  const map: Record<string, { bg: string; text: string }> = {
    top:       { bg: "bg-chip-teal", text: "text-chip-teal-ink"  },
    bottom:    { bg: "bg-chip-sky",    text: "text-chip-sky-ink"     },
    outerwear: { bg: "bg-sunken",  text: "text-ink"   },
    shoes:     { bg: "bg-chip-rust",   text: "text-chip-rust-ink"    },
    accessory: { bg: "bg-chip-brass",  text: "text-chip-brass-ink"   },
    dress:     { bg: "bg-chip-plum", text: "text-chip-plum-ink"  },
  };
  return map[role] ?? { bg: "bg-sunken", text: "text-ink" };
}
