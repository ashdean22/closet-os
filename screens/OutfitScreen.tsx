import React, { useState, useRef, useEffect, useCallback } from "react";
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
import ErrorBoundary from "../components/ErrorBoundary";
import ImageZoomModal from "../components/ImageZoomModal";
import ItemPickerModal, { type PickableItem } from "../components/ItemPickerModal";
import { supabase } from "../lib/supabase";
import { readFunctionError } from "../lib/functionErrors";

// ── Types ─────────────────────────────────────────────────────────────────────

type ItemDetail = {
  id: string;
  image_url: string | null;
  category: string | null;
  color: string | null;
  secondary_color: string | null;
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
  is_anchor: boolean;
};

type MissingDetail = {
  role: string;
  reason: "no_match" | "not_owned";
};

type Variation = {
  name: string;
  outfit: OutfitPiece[];
  rationale: string;
  missing: string[];
  missing_detail: MissingDetail[];
};

type OutfitResult = {
  query: string;
  anchor: ItemDetail | null;
  variations: Variation[];
  /**
   * Server-supplied explanation used when `variations` is empty — an empty
   * closet and an over-filtered refresh are both "no looks", but they need
   * different words.
   */
  message: string;
};

// ── Screen ────────────────────────────────────────────────────────────────────

export default function OutfitScreen() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  // Separate from `loading` so refreshing keeps the current look on screen
  // instead of blanking to the full-page spinner.
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<OutfitResult | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<PickableItem | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [zoom, setZoom] = useState<{ uri: string; caption: string } | null>(null);
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

  const canSearch = query.trim().length > 0 || anchor !== null;

  /**
   * One request path for the first search and for "give me more looks".
   *
   * `excludeItemIds` is how a server-side refresh gets a genuinely different
   * batch. It carries only the pieces from the batch the user just rejected,
   * not everything ever shown — excluding the full history would starve
   * retrieval in a small wardrobe after two or three refreshes.
   */
  const fetchOutfits = useCallback(
    async ({
      append = false,
      excludeItemIds = [],
    }: { append?: boolean; excludeItemIds?: string[] } = {}) => {
      if (!append) {
        Keyboard.dismiss();
        setLoading(true);
        setResult(null);
        setIndex(0);
      } else {
        setRefreshing(true);
      }
      setError(null);

      try {
        const invoke = (exclude: string[]) =>
          supabase.functions.invoke<unknown>("find-outfit", {
            body: {
              query: query.trim(),
              anchor_item_id: anchor?.id ?? null,
              exclude_item_ids: exclude,
              variations: 3,
            },
          });

        let { data, error: fnError } = await invoke(excludeItemIds);

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
          if (detail.reason === "daily_limit") throw new Error("daily_limit");
          if (detail.reason === "anchor_not_found") throw new Error("anchor_not_found");
          throw new Error(detail.message);
        }
        if (!data) throw new Error("find-outfit returned no data");

        // The function can return HTTP 200 with an error body or a drifted shape;
        // invoke() only routes non-2xx to `fnError`, so we validate here. This is
        // the primary defense — a malformed body becomes a friendly error state
        // instead of a render crash (TypeError on .length/.map).
        let normalized = normalizeOutfitResult(data);
        if (!normalized) {
          const serverError =
            typeof data === "object" && data !== null && "error" in data
              ? String((data as { error: unknown }).error)
              : "Unexpected response from the server.";
          throw new Error(serverError);
        }

        // Exclusions can empty the candidate pool in a small closet. Rather
        // than dead-end the refresh, ask once more with no exclusions — a
        // repeated look beats "nothing left".
        if (normalized.variations.length === 0 && excludeItemIds.length > 0) {
          const retry = await invoke([]);
          if (!retry.error && retry.data) {
            normalized = normalizeOutfitResult(retry.data) ?? normalized;
          }
        }

        if (!mounted.current) return;

        if (append && result) {
          const merged = [...result.variations, ...normalized.variations];
          setResult({ ...normalized, variations: merged });
          // Jump to the first newly-fetched look, or stay put if none came back.
          setIndex(
            normalized.variations.length > 0
              ? result.variations.length
              : Math.min(index, merged.length - 1),
          );
        } else {
          setResult(normalized);
          setIndex(0);
        }
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        if (mounted.current) setError(friendlyOutfitError(raw));
      } finally {
        if (mounted.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [anchor, index, query, result],
  );

  const handleFind = useCallback(() => {
    if (!canSearch) return;
    fetchOutfits();
  }, [canSearch, fetchOutfits]);

  /**
   * Refresh is free while unseen looks remain in the batch — the server already
   * returned three, so swapping between them costs nothing and doesn't spend a
   * request against the daily outfit cap. Only an exhausted batch hits the API.
   */
  const handleRefresh = useCallback(() => {
    if (!result || refreshing) return;

    if (index < result.variations.length - 1) {
      setIndex((i) => i + 1);
      return;
    }

    const lastBatch = result.variations.slice(-3);
    const exclude = [
      ...new Set(
        lastBatch.flatMap((v) =>
          v.outfit.filter((p) => !p.is_anchor).map((p) => p.item_id),
        ),
      ),
    ];
    fetchOutfits({ append: true, excludeItemIds: exclude });
  }, [fetchOutfits, index, refreshing, result]);

  const current = result?.variations[index] ?? null;
  const hasUnseen = result ? index < result.variations.length - 1 : false;

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
          <Text className="text-2xl font-bold text-gray-800">Find an Outfit</Text>

          {/* ── Anchor piece ───────────────────────────────────────────── */}
          <AnchorRow
            anchor={anchor}
            onPick={() => setPickerOpen(true)}
            onClear={() => setAnchor(null)}
          />

          {/* ── Query input ────────────────────────────────────────────── */}
          <View className="gap-3">
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder={
                anchor
                  ? "Add an occasion (optional)"
                  : "e.g. outfit for a 65° rainy interview"
              }
              placeholderTextColor="#9ca3af"
              returnKeyType="search"
              onSubmitEditing={handleFind}
              multiline={false}
              // Explicit style prevents Android text-clipping caused by
              // includeFontPadding collapsing the NativeWind py-* height.
              style={{
                borderWidth: 1,
                borderColor: "#d1d5db",
                borderRadius: 12,
                paddingHorizontal: 16,
                paddingVertical: 14,
                fontSize: 16,
                color: "#1f2937",
                backgroundColor: "#f9fafb",
              }}
            />
            <TouchableOpacity
              onPress={handleFind}
              disabled={!canSearch || loading}
              className={`py-4 rounded-xl items-center flex-row justify-center gap-2 ${
                canSearch && !loading ? "bg-indigo-600" : "bg-gray-300"
              }`}
            >
              {loading ? (
                <>
                  <ActivityIndicator size="small" color="white" />
                  <Text className="text-white text-base font-semibold">
                    Styling…
                  </Text>
                </>
              ) : (
                <Text className="text-white text-base font-semibold">
                  Find My Outfit
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* ── Error ──────────────────────────────────────────────────── */}
          {error && (
            <View className="bg-red-50 border border-red-200 rounded-xl p-4 gap-3">
              <Text className="text-red-700 text-sm font-semibold">
                Couldn't find an outfit
              </Text>
              <Text className="text-red-600 text-sm leading-5">{error}</Text>
              <TouchableOpacity
                onPress={handleFind}
                className="self-start bg-red-100 px-4 py-2 rounded-lg"
              >
                <Text className="text-red-700 text-sm font-semibold">Try again</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Loading state ──────────────────────────────────────────── */}
          {loading && (
            <View className="items-center py-16 gap-4">
              <ActivityIndicator size="large" color="#4f46e5" />
              <Text className="text-gray-600 text-base font-medium">
                Finding your outfits…
              </Text>
              <Text className="text-gray-400 text-xs">
                Embedding query · searching closet · styling with Claude
              </Text>
            </View>
          )}

          {/* ── Empty / prompt state ────────────────────────────────────── */}
          {!loading && !result && !error && (
            <View className="items-center py-16 gap-3">
              <Text className="text-4xl">✦</Text>
              <Text className="text-gray-500 text-base text-center">
                Describe the occasion, weather, or vibe — or pin a piece you want
                to wear — and Claude will build a few looks from your closet.
              </Text>
            </View>
          )}

          {/* ── Results ────────────────────────────────────────────────── */}
          {result && current && (
            <OutfitResults
              query={result.query}
              variation={current}
              index={index}
              total={result.variations.length}
              refreshing={refreshing}
              hasUnseen={hasUnseen}
              onSelectIndex={setIndex}
              onRefresh={handleRefresh}
              onZoom={setZoom}
            />
          )}

          {/* Server returned a valid response with no buildable looks. Prefer
              its own explanation — "your closet is empty" and "nothing left
              after those refreshes" are different problems. */}
          {result && !current && !loading && (
            <View className="bg-amber-50 border border-amber-200 rounded-xl p-4 gap-1">
              <Text className="text-amber-800 text-sm font-semibold">
                {closetIsEmpty(result.message)
                  ? "Your closet is empty"
                  : "No outfits to show"}
              </Text>
              <Text className="text-amber-700 text-sm leading-5">
                {closetIsEmpty(result.message)
                  ? "Add and save some items first — the AI needs photos to work with."
                  : result.message ||
                    "Try rephrasing your search, or add more variety to your closet."}
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <ItemPickerModal
        visible={pickerOpen}
        onSelect={(item) => {
          setAnchor(item);
          setPickerOpen(false);
          // Clear stale results — they were styled without this piece pinned.
          setResult(null);
          setIndex(0);
        }}
        onClose={() => setPickerOpen(false)}
      />

      <ImageZoomModal
        uri={zoom?.uri ?? null}
        caption={zoom?.caption}
        onClose={() => setZoom(null)}
      />
    </ScreenWrapper>
    </ErrorBoundary>
  );
}

// ── AnchorRow ─────────────────────────────────────────────────────────────────

function AnchorRow({
  anchor,
  onPick,
  onClear,
}: {
  anchor: PickableItem | null;
  onPick: () => void;
  onClear: () => void;
}) {
  if (!anchor) {
    return (
      <TouchableOpacity
        onPress={onPick}
        className="flex-row items-center gap-3 border border-dashed border-gray-300 rounded-2xl px-4 py-3"
      >
        <Text className="text-lg text-gray-400">＋</Text>
        <View className="flex-1">
          <Text className="text-gray-700 text-sm font-semibold">
            Style around a piece
          </Text>
          <Text className="text-gray-400 text-xs">
            Pick a shirt, trousers, anything — the look is built to match it
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View className="flex-row items-center gap-3 bg-indigo-50 border border-indigo-100 rounded-2xl p-2.5">
      {anchor.image_url ? (
        <Image
          source={{ uri: anchor.image_url }}
          style={{ width: 48, height: 48, borderRadius: 10 }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={{ width: 48, height: 48, borderRadius: 10 }}
          className="bg-indigo-100 items-center justify-center"
        >
          <Text className="text-indigo-400 text-[10px]">No photo</Text>
        </View>
      )}
      <View className="flex-1">
        <Text className="text-indigo-500 text-[10px] font-semibold uppercase tracking-wide">
          Building around
        </Text>
        <Text
          className="text-indigo-900 text-sm font-medium capitalize"
          numberOfLines={1}
        >
          {[anchor.color, anchor.category].filter(Boolean).join(" ") || "Selected item"}
        </Text>
      </View>
      <TouchableOpacity
        onPress={onPick}
        className="px-2.5 py-1.5 rounded-lg bg-white border border-indigo-100"
      >
        <Text className="text-indigo-600 text-xs font-semibold">Change</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onClear}
        accessibilityRole="button"
        accessibilityLabel="Remove pinned piece"
        className="w-7 h-7 rounded-full bg-white border border-indigo-100 items-center justify-center"
      >
        <Text className="text-indigo-500 text-xs font-semibold">✕</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── OutfitResults ─────────────────────────────────────────────────────────────

function OutfitResults({
  query,
  variation,
  index,
  total,
  refreshing,
  hasUnseen,
  onSelectIndex,
  onRefresh,
  onZoom,
}: {
  query: string;
  variation: Variation;
  index: number;
  total: number;
  refreshing: boolean;
  hasUnseen: boolean;
  onSelectIndex: (i: number) => void;
  onRefresh: () => void;
  onZoom: (z: { uri: string; caption: string }) => void;
}) {
  // Defensive defaults: even though normalizeOutfitResult guarantees arrays,
  // guard again here so a future shape change can never throw during render.
  const outfit = Array.isArray(variation.outfit) ? variation.outfit : [];
  const missing = Array.isArray(variation.missing_detail)
    ? variation.missing_detail
    : [];
  const rationale = variation.rationale || "Here's a look from your closet.";

  return (
    <View className="gap-4">
      {/* ── Look selector ────────────────────────────────────────────────── */}
      {total > 1 && (
        <View className="flex-row items-center justify-between">
          <Text className="text-gray-500 text-xs font-semibold uppercase tracking-wide">
            Look {index + 1} of {total}
          </Text>
          <View className="flex-row items-center gap-1.5">
            {Array.from({ length: total }).map((_, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => onSelectIndex(i)}
                accessibilityRole="button"
                accessibilityLabel={`Show look ${i + 1}`}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              >
                <View
                  className={`rounded-full ${
                    i === index ? "bg-indigo-600" : "bg-gray-300"
                  }`}
                  style={{ width: i === index ? 20 : 8, height: 8 }}
                />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Rationale banner */}
      <View className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
        <Text className="text-indigo-500 text-xs font-semibold uppercase tracking-wide mb-1">
          {variation.name || "Styled for"}
        </Text>
        {query ? (
          <Text className="text-indigo-900 text-sm font-medium italic leading-5">
            "{query}"
          </Text>
        ) : null}
        <Text className="text-indigo-800 text-sm leading-5 mt-2">{rationale}</Text>
      </View>

      {/* Outfit pieces */}
      {outfit.length === 0 ? (
        <View className="bg-amber-50 border border-amber-200 rounded-xl p-4 gap-1">
          <Text className="text-amber-800 text-sm font-semibold">
            {closetIsEmpty(rationale)
              ? "Your closet is empty"
              : "No matching items found"}
          </Text>
          <Text className="text-amber-700 text-sm leading-5">
            {closetIsEmpty(rationale)
              ? "Add and save some items first — the AI needs photos to work with."
              : "Try rephrasing your query, or add more variety to your closet."}
          </Text>
        </View>
      ) : (
        <View className="gap-3">
          {outfit.map((piece, i) => (
            <OutfitCard
              key={piece?.item_id ?? i}
              piece={piece}
              onZoom={onZoom}
            />
          ))}
        </View>
      )}

      {/* ── Refresh ──────────────────────────────────────────────────────── */}
      {outfit.length > 0 && (
        <TouchableOpacity
          onPress={onRefresh}
          disabled={refreshing}
          className={`py-3.5 rounded-xl items-center flex-row justify-center gap-2 border ${
            refreshing
              ? "bg-gray-100 border-gray-200"
              : "bg-white border-indigo-200"
          }`}
        >
          {refreshing ? (
            <>
              <ActivityIndicator size="small" color="#4f46e5" />
              <Text className="text-gray-500 text-sm font-semibold">
                Styling more looks…
              </Text>
            </>
          ) : (
            <>
              <Text className="text-indigo-600 text-sm">↻</Text>
              <Text className="text-indigo-600 text-sm font-semibold">
                {/* Say which refreshes are instant so it's clear when a tap
                    costs a request against the daily limit. */}
                {hasUnseen ? "Show me the next look" : "Style something new"}
              </Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {/* Missing items */}
      {missing.length > 0 && (
        <View className="bg-amber-50 border border-amber-200 rounded-2xl p-4 gap-2">
          <Text className="text-amber-700 text-xs font-semibold uppercase tracking-wide">
            Not in this look
          </Text>
          {missing.map((m, i) => (
            <View key={i} className="flex-row items-start gap-2">
              <Text className="text-amber-500">•</Text>
              <Text className="text-amber-800 text-sm leading-5 flex-1">
                <Text className="capitalize font-medium">{m.role}</Text>
                {m.reason === "not_owned"
                  ? " — you haven't added any to your closet yet"
                  : " — nothing in your closet suited this search"}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── OutfitCard ────────────────────────────────────────────────────────────────

function OutfitCard({
  piece,
  onZoom,
}: {
  piece: OutfitPiece;
  onZoom: (z: { uri: string; caption: string }) => void;
}) {
  // piece itself may be malformed if the response shape drifts; default it.
  const item = piece?.item;
  const role = piece?.role ?? "item";
  const reason = piece?.reason ?? "";
  const { bg, text } = rolePillStyle(role);
  const caption = [item?.color, item?.category].filter(Boolean).join(" · ");

  return (
    <View
      className={`flex-row bg-white border rounded-2xl overflow-hidden ${
        piece?.is_anchor ? "border-indigo-200" : "border-gray-100"
      }`}
    >
      {/* Thumbnail — tap to open full screen and zoom */}
      {item?.image_url ? (
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => onZoom({ uri: item.image_url as string, caption })}
          accessibilityRole="imagebutton"
          accessibilityLabel="View photo full screen"
        >
          <Image
            source={{ uri: item.image_url }}
            style={{ width: 88, height: 88 }}
            resizeMode="cover"
          />
          <View
            style={{ position: "absolute", bottom: 4, right: 4 }}
            className="bg-black/45 w-5 h-5 rounded-full items-center justify-center"
          >
            <Text className="text-white text-[10px]">⤢</Text>
          </View>
        </TouchableOpacity>
      ) : (
        <View
          style={{ width: 88, height: 88 }}
          className="bg-gray-100 items-center justify-center"
        >
          <Text className="text-gray-400 text-xs">No photo</Text>
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
          {piece?.is_anchor && (
            <View className="px-2 py-0.5 rounded-full bg-indigo-600">
              <Text className="text-white text-xs font-semibold">Your pick</Text>
            </View>
          )}
          {item?.color ? (
            <Text
              className="text-gray-400 text-xs capitalize flex-1"
              numberOfLines={1}
            >
              {item.color}
              {item.category ? ` · ${item.category}` : ""}
            </Text>
          ) : null}
        </View>

        {/* Claude's reason */}
        <Text className="text-gray-700 text-sm leading-5" numberOfLines={3}>
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
 *
 * Accepts the pre-variations response shape too: if the deployed function is
 * older than the app, `outfit`/`rationale`/`missing` are folded into a single
 * variation so the screen still works instead of showing an error.
 */
function normalizeOutfitResult(data: unknown): OutfitResult | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;

  const hasVariations = Array.isArray(d.variations);
  const hasLegacyOutfit = Array.isArray(d.outfit);
  if (!hasVariations && !hasLegacyOutfit) return null;

  const rawVariations: unknown[] = hasVariations
    ? (d.variations as unknown[])
    : [{ outfit: d.outfit, rationale: d.rationale, missing: d.missing }];

  const variations = rawVariations
    .filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
    .map((v) => normalizeVariation(v))
    // A variation with no pieces has nothing to render.
    .filter((v) => v.outfit.length > 0);

  return {
    query: typeof d.query === "string" ? d.query : "",
    anchor: (d.anchor ?? null) as ItemDetail | null,
    variations,
    message: typeof d.rationale === "string" ? d.rationale : "",
  };
}

function normalizeVariation(v: Record<string, unknown>): Variation {
  const outfit: OutfitPiece[] = (Array.isArray(v.outfit) ? v.outfit : [])
    .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
    .map((p) => ({
      item_id: typeof p.item_id === "string" ? p.item_id : "",
      role: typeof p.role === "string" ? p.role : "item",
      reason: typeof p.reason === "string" ? p.reason : "",
      item: (p.item ?? null) as OutfitPiece["item"],
      is_anchor: p.is_anchor === true,
    }));

  const missing = Array.isArray(v.missing)
    ? (v.missing as unknown[]).map((m) => String(m ?? ""))
    : [];

  // missing_detail is the newer, structured form. Fall back to synthesising it
  // from the plain string list so an older function still renders sensibly.
  const missingDetail: MissingDetail[] = Array.isArray(v.missing_detail)
    ? (v.missing_detail as unknown[])
        .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
        .map((m) => ({
          role: String(m.role ?? ""),
          reason: m.reason === "not_owned" ? "not_owned" : "no_match",
        }))
    : missing.map((role) => ({ role, reason: "no_match" as const }));

  return {
    name: typeof v.name === "string" ? v.name : "",
    outfit,
    rationale: typeof v.rationale === "string" ? v.rationale : "",
    missing,
    missing_detail: missingDetail,
  };
}

/** Maps raw error strings to user-readable messages. */
function friendlyOutfitError(raw: string): string {
  if (raw === "daily_limit")
    return "You've hit today's outfit limit — it resets tomorrow.";
  if (raw === "anchor_not_found")
    return "That pinned piece is no longer in your closet. Pick another one.";
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
    top:       { bg: "bg-indigo-100", text: "text-indigo-700"  },
    bottom:    { bg: "bg-sky-100",    text: "text-sky-700"     },
    outerwear: { bg: "bg-slate-100",  text: "text-slate-700"   },
    shoes:     { bg: "bg-rose-100",   text: "text-rose-700"    },
    accessory: { bg: "bg-amber-100",  text: "text-amber-700"   },
    dress:     { bg: "bg-violet-100", text: "text-violet-700"  },
  };
  return map[role] ?? { bg: "bg-gray-100", text: "text-gray-700" };
}
