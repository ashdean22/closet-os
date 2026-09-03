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
  Alert,
} from "react-native";
import ScreenWrapper from "../components/ScreenWrapper";
import DecoHeader from "../components/DecoHeader";
import ErrorBoundary from "../components/ErrorBoundary";
import ImageZoomModal from "../components/ImageZoomModal";
import ItemPickerModal, { type PickableItem } from "../components/ItemPickerModal";
import SavedOutfitsList from "../components/SavedOutfitsList";
import {
  DuplicateOutfitError,
  loadSavedSignatures,
  outfitKey,
  saveOutfit,
} from "../lib/savedOutfits";
import { hasSeen, markSeen } from "../lib/onboarding";
import { supabase } from "../lib/supabase";
import { invokeFunction } from "../lib/invokeFunction";
import { colors, fonts, radius, tracking } from "../lib/theme";
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
  /** Carried over from the previous look during a laundry swap. */
  is_kept: boolean;
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
  /**
   * Machine-readable counterpart to `message`. The server refuses some
   * requests before spending anything on them — an empty closet, a wardrobe
   * with no trousers, a query asking what to wear on the moon — and each
   * refusal needs a different thing offered back to the user. Null when the
   * response carried looks, or came from a function older than this client.
   */
  reason: BlockReason | null;
  /** For `implausible_request`: the same idea, rephrased so it would work. */
  suggestion: string;
  /** For the closet-shortfall reasons: which slots are empty. */
  missingCategories: string[];
};

/** Every refusal the function can return. Anything else is treated as generic. */
const BLOCK_REASONS = [
  "empty_closet",
  "closet_processing",
  "insufficient_closet",
  "needs_shoes_confirmation",
  "implausible_request",
  "no_candidates",
  "no_looks",
] as const;

type BlockReason = (typeof BLOCK_REASONS)[number];

type FetchOpts = {
  append?: boolean;
  silent?: boolean;
  excludeItemIds?: string[];
  variations?: number;
  /**
   * A laundry swap: keep these pieces of the look on screen and replace only
   * what was dropped. The result overwrites the variation at `swapAt` rather
   * than being appended, so the user watches one garment change instead of
   * losing the outfit they were reading.
   */
  keepItemIds?: string[];
  swapAt?: number;
  /** Carries the user's "style it anyway" past the no-shoes check. */
  allowMissingShoes?: boolean;
};

/**
 * What the spinner says. The stages are honest about the pipeline — retrieval
 * really does finish in about a second and the rest is the model writing — and
 * a wait you can watch move is shorter than the same wait spent wondering.
 */
function loadingStage(seconds: number, phase: "styling" | "photos"): string {
  if (phase === "photos") return "Loading the photos…";
  if (seconds < 2) return "Reading your closet…";
  if (seconds < 5) return "Pairing pieces…";
  return "Writing the reasons…";
}

/**
 * Warms the image cache so a look appears complete the instant it appears.
 *
 * Without this the card renders, then its photos pop in one by one over the
 * next second or two, which reads as the app still working after it has
 * finished. Prefetching costs a moment at the end of a ten-second wait and
 * buys a reveal with nothing missing from it.
 *
 * Never blocks for long: a photo that 404s or crawls must not hold the outfit
 * hostage, so the race resolves either way and the <Image> falls back to
 * loading normally.
 */
const PRELOAD_TIMEOUT_MS = 4000;

async function preloadPhotos(urls: (string | null | undefined)[]): Promise<void> {
  const real = [...new Set(urls.filter((u): u is string => !!u))];
  if (real.length === 0) return;

  await Promise.race([
    Promise.all(real.map((uri) => Image.prefetch(uri).catch(() => false))),
    new Promise((resolve) => setTimeout(resolve, PRELOAD_TIMEOUT_MS)),
  ]);
}

/** The photos a look needs before it is worth showing. */
function photosOf(variation: Variation | undefined): (string | null)[] {
  return (variation?.outfit ?? []).map((piece) => piece.item?.image_url ?? null);
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function OutfitScreen({
  onAddItems,
}: {
  /** Switches to the Add Item tab — the only place a closet gets filled. */
  onAddItems?: () => void;
}) {
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

  // The Outfit tab carries two views. A segmented control rather than a fifth
  // tab: the bar already runs four items at 9px and a fifth crushes the labels.
  const [mode, setMode] = useState<"find" | "saved">("find");
  // Bumped after a save so the saved list refetches when switched to.
  const [savedRefreshKey, setSavedRefreshKey] = useState(0);
  // Every outfit this account has already saved, keyed by its set of garments.
  // Keyed rather than indexed by position so the Save button stays honest
  // across refreshes, swaps and searches — the same four pieces are the same
  // outfit however the user arrived at them, which is exactly the rule the
  // database enforces.
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [savingLook, setSavingLook] = useState(false);
  // Seconds spent waiting on the current search, so the spinner can say
  // something true about where the time is going.
  const [elapsed, setElapsed] = useState(0);
  // "styling" is the model working; "photos" is the image cache warming after
  // it. Two different waits, and saying which one is running stops the last
  // second reading as a stall.
  const [phase, setPhase] = useState<"styling" | "photos">("styling");
  // The garment currently being swapped out, so its card can show the work
  // happening on the piece the user actually tapped.
  const [swappingId, setSwappingId] = useState<string | null>(null);
  // One-time hint on the first visit. Shows what a good query looks like —
  // "describe the day, not the clothes" is the part people get wrong.
  const [showCoach, setShowCoach] = useState(false);

  // Pieces the user has marked unavailable this session ("that's in the
  // laundry"). Held in a ref, not state: nothing renders from it directly, and
  // a swap needs the value it just added on the very next line rather than
  // after a re-render.
  const unavailable = useRef<Set<string>>(new Set());
  // Set once the user has been warned they own no shoes and chosen to go on.
  // Also a ref — asking again on every search would be nagging, not consent.
  const shoelessConfirmed = useRef(false);

  // Bumped on every fresh search. A background prefetch or a double-tapped
  // Find that lands after a newer search started must not merge into it.
  const searchGen = useRef(0);
  // fetchOutfits calls itself to prefetch, which a useCallback can't do
  // directly — the binding doesn't exist yet inside its own body.
  const fetchRef = useRef<((opts?: FetchOpts) => Promise<void>) | null>(null);

  // Guards against setState after unmount (suspect #3). The screen normally
  // stays mounted across tab switches, but this keeps the async path safe.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    hasSeen("outfitCoach").then((seen) => {
      if (active && !seen) setShowCoach(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const dismissCoach = useCallback(() => {
    setShowCoach(false);
    markSeen("outfitCoach");
  }, []);

  // Refetched whenever the saved list changes so the Save button reflects
  // deletions too — un-saving a look must make it saveable again.
  useEffect(() => {
    let active = true;
    loadSavedSignatures()
      .then((keys) => {
        if (active) setSavedKeys(keys);
      })
      // A failure here only costs the button its head start: the database
      // still refuses a duplicate, so this is not worth an error state.
      .catch((err) => console.warn("[outfit] saved signatures:", err));
    return () => {
      active = false;
    };
  }, [savedRefreshKey]);

  const canSearch = query.trim().length > 0 || anchor !== null;

  /**
   * One request path for the first search, for the background prefetch, and for
   * "give me more looks".
   *
   * `excludeItemIds` is how a server-side refresh gets a genuinely different
   * batch. It carries only the pieces from the batch the user just rejected,
   * not everything ever shown — excluding the full history would starve
   * retrieval in a small wardrobe after two or three refreshes.
   *
   * `silent` is the prefetch: no spinner, no error state, no index jump. It
   * fills the Refresh queue behind the user's back while they read look one.
   */
  const fetchOutfits = useCallback(
    async ({
      append = false,
      silent = false,
      excludeItemIds = [],
      variations = 1,
      keepItemIds = [],
      swapAt,
      allowMissingShoes,
    }: FetchOpts = {}) => {
      // Three shapes of request, and they differ in what they do to the screen
      // rather than in what they ask the server:
      //   fresh  — clears everything and starts over
      //   append — adds looks to the batch behind the current one
      //   swap   — replaces one look in place, keeping the user's position
      const isSwap = typeof swapAt === "number";

      // A fresh search invalidates everything in flight; an append or a swap
      // inherits the generation of the search it belongs to.
      const gen = append || isSwap ? searchGen.current : ++searchGen.current;
      const stale = () => searchGen.current !== gen || !mounted.current;

      if (!append && !isSwap) {
        Keyboard.dismiss();
        setLoading(true);
        setPhase("styling");
        setElapsed(0);
        setResult(null);
        setIndex(0);
      } else if (!silent && !isSwap) {
        setRefreshing(true);
      }
      if (!silent) setError(null);

      try {
        const invoke = (exclude: string[]) =>
          invokeFunction<unknown>("find-outfit", {
            body: {
              query: query.trim(),
              anchor_item_id: anchor?.id ?? null,
              // Anything the user has put in the laundry stays out for the
              // rest of the session — being offered the same dirty shirt on
              // the next refresh is the bug this is here to prevent.
              exclude_item_ids: [
                ...new Set([...exclude, ...unavailable.current]),
              ],
              keep_item_ids: keepItemIds,
              allow_missing_shoes: allowMissingShoes ?? shoelessConfirmed.current,
              // Tells the function this build can show a refusal and offer a
              // way past it, so it is safe to ask rather than assume.
              supports_blocking: true,
              variations,
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

        // A refusal the server reached before spending anything — an empty
        // closet, no trousers, a request for moon boots. It carries no looks
        // by definition, so none of the retry-and-merge logic below applies.
        if (normalized.reason) {
          if (stale()) return;
          // On a swap or an append the outfit already on screen is still
          // perfectly good; replacing it with a notice would punish the user
          // for asking a follow-up question.
          if (append || isSwap) {
            console.warn("[find-outfit] blocked mid-batch:", normalized.reason);
            if (!silent) setError(normalized.message);
            return;
          }
          setResult(normalized);
          setIndex(0);
          return;
        }

        // Exclusions can empty the candidate pool in a small closet. Rather
        // than dead-end the refresh, ask once more with no exclusions — a
        // repeated look beats "nothing left".
        // Not for a prefetch: nobody is waiting on it, so an empty answer is a
        // short queue rather than a dead end, and spending a second request to
        // fill it would double the cost of a search in a small wardrobe.
        if (!silent && normalized.variations.length === 0 && excludeItemIds.length > 0) {
          const retry = await invoke([]);
          if (!retry.error && retry.data) {
            normalized = normalizeOutfitResult(retry.data) ?? normalized;
          }
        }

        if (stale()) return;

        // ── Photos before pixels ──────────────────────────────────────
        // The look is not shown until its garments are in the image cache, so
        // it arrives complete rather than assembling itself over the next
        // second. Only for looks the user is about to see: a silent prefetch
        // warms its photos too, but nobody is waiting on it, so it does not
        // get to hold up the screen first.
        const incoming = normalized.variations[0];
        if (!silent && incoming) {
          setPhase("photos");
          await preloadPhotos(photosOf(incoming));
          if (stale()) return;
        }

        if (isSwap) {
          const replacement = normalized.variations[0];
          if (!replacement) {
            if (!silent) setError("Couldn't find a replacement for that piece.");
            return;
          }
          setResult((prev) => {
            if (!prev) return prev;
            const next = [...prev.variations];
            const previous = next[swapAt];
            if (!previous) return prev;
            next[swapAt] = mergeSwappedLook(previous, replacement);
            return { ...prev, variations: next };
          });
          return;
        }

        if (append) {
          setResult((prev) =>
            prev
              ? { ...prev, variations: [...prev.variations, ...normalized.variations] }
              : normalized,
          );
          // Refresh only calls the server from the last look in the batch, so
          // "the first new look" is always the next index along. A prefetch
          // stays put — the user is still reading look one.
          if (!silent && normalized.variations.length > 0) {
            setIndex((i) => i + 1);
          }
          if (normalized.variations.length > 0) {
            const latest = normalized.variations[0];
            // A prefetched look's photos are warmed in the background so that
            // tapping Refresh is instant rather than merely fast.
            if (silent) void preloadPhotos(photosOf(latest));
            void fetchRef.current?.({
              append: true,
              silent: true,
              variations: 2,
              excludeItemIds: [
                ...excludeItemIds,
                ...latest.outfit
                  .filter((piece) => !piece.is_anchor)
                  .map((piece) => piece.item_id),
              ],
            });
          }
        } else {
          setResult(normalized);
          setIndex(0);

          // ── Prefetch the rest of the batch ────────────────────────────
          // The wait the user feels is the model writing looks, and it writes
          // them one after another: three take ~22s, one takes ~9s. So we ask
          // for one, put it on screen, and fetch the other two while they read
          // it. By the time anyone taps Refresh the queue is usually full.
          if (incoming) {
            const exclude = incoming.outfit
              .filter((piece) => !piece.is_anchor)
              .map((piece) => piece.item_id);
            void fetchRef.current?.({
              append: true,
              silent: true,
              variations: 2,
              excludeItemIds: exclude,
            });
          }
        }
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        if (silent) {
          console.warn("[find-outfit] prefetch failed:", raw);
        } else if (!stale()) {
          setError(friendlyOutfitError(raw));
        }
      } finally {
        if (mounted.current && !silent) {
          setLoading(false);
          setRefreshing(false);
          setPhase("styling");
        }
      }
    },
    [anchor, query],
  );

  useEffect(() => {
    fetchRef.current = fetchOutfits;
  }, [fetchOutfits]);

  // Ticks only while the first look is being built.
  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [loading]);

  const handleFind = useCallback(() => {
    if (!canSearch) return;
    fetchOutfits();
  }, [canSearch, fetchOutfits]);

  /**
   * Refresh is free while unseen looks remain in the batch — the search fetches
   * one look and prefetches two more, so swapping between them costs nothing
   * and doesn't spend a request against the daily outfit cap. Only an exhausted
   * batch hits the API.
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
    fetchOutfits({ append: true, excludeItemIds: exclude, variations: 1 });
  }, [fetchOutfits, index, refreshing, result]);

  /**
   * Saving costs nothing — no model call — so the look is written immediately
   * under the name the stylist already gave it. Renaming lives in the saved
   * list; asking for a name before the user has seen it save is friction for
   * no benefit.
   */
  const handleSaveLook = useCallback(async () => {
    const variation = result?.variations[index];
    if (!variation || savingLook) return;

    const key = outfitKey(variation.outfit.map((p) => p.item_id));
    if (savedKeys.has(key)) return;

    const pieces = variation.outfit
      .filter((p) => p?.item_id)
      .map((p) => ({
        item_id: p.item_id,
        role: p.role ?? null,
        reason: p.reason ?? null,
        is_anchor: !!p.is_anchor,
      }));

    if (pieces.length === 0) return;

    setSavingLook(true);
    try {
      await saveOutfit({
        name: variation.name || result?.query || "Saved outfit",
        query: result?.query ?? null,
        rationale: variation.rationale ?? null,
        pieces,
      });
      if (!mounted.current) return;
      setSavedKeys((prev) => new Set(prev).add(key));
      setSavedRefreshKey((k) => k + 1);
    } catch (err) {
      if (!mounted.current) return;
      // The database refused it because this outfit is already saved, which
      // is the state the user was asking for. Record it and say so quietly —
      // an error dialog would be reporting a success as a failure.
      if (err instanceof DuplicateOutfitError) {
        setSavedKeys((prev) => new Set(prev).add(key));
        return;
      }
      Alert.alert(
        "Couldn't save",
        err instanceof Error ? err.message : "Please try again.",
      );
    } finally {
      if (mounted.current) setSavingLook(false);
    }
  }, [index, result, savedKeys, savingLook]);

  /**
   * "That one's in the laundry."
   *
   * Drops one garment, pins everything else in the look, and asks the stylist
   * to refill only the slot that opened. Rebuilding the whole outfit would be
   * the easier implementation and the wrong answer: the user liked the look,
   * they just cannot wear one piece of it.
   *
   * The rejected piece stays out for the rest of the session, so it cannot
   * come back on the next refresh.
   */
  const handleSwapPiece = useCallback(
    (itemId: string) => {
      const variation = result?.variations[index];
      if (!variation || swappingId) return;

      const keep = variation.outfit
        .filter((piece) => piece.item_id !== itemId)
        .map((piece) => piece.item_id);

      unavailable.current.add(itemId);
      setSwappingId(itemId);

      void fetchOutfits({
        swapAt: index,
        keepItemIds: keep,
        excludeItemIds: [itemId],
        variations: 1,
      }).finally(() => {
        if (mounted.current) setSwappingId(null);
      });
    },
    [fetchOutfits, index, result, swappingId],
  );

  /** Re-runs the search having accepted that the looks will have no shoes. */
  const handleStyleWithoutShoes = useCallback(() => {
    shoelessConfirmed.current = true;
    void fetchOutfits({ allowMissingShoes: true });
  }, [fetchOutfits]);

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
          <DecoHeader title={mode === "find" ? "Find an Outfit" : "Saved Outfits"} />

          {/* ── Find / Saved ───────────────────────────────────────────── */}
          <ModeToggle mode={mode} onChange={setMode} />

          {mode === "find" ? (
            <>
            {/* ── Anchor piece ───────────────────────────────────────────── */}
            <AnchorRow
              anchor={anchor}
              onPick={() => setPickerOpen(true)}
              onClear={() => setAnchor(null)}
            />

            {/* ── First-visit hint ───────────────────────────────────────── */}
            {showCoach && !result && (
              <View className="bg-brass-tint border border-brass rounded p-4 gap-2">
                <Text
                  style={{
                    fontFamily: fonts.deco,
                    fontSize: 11,
                    letterSpacing: tracking.deco,
                    color: colors.notice,
                  }}
                >
                  TRY ASKING FOR
                </Text>
                <Text className="text-ink text-base italic">
                  "65° and rainy, job interview"
                </Text>
                <Text className="text-ink-soft text-sm leading-5">
                  Describe the day — the weather, the occasion, the mood. Capsule
                  picks the clothes.
                </Text>
                <TouchableOpacity onPress={dismissCoach} className="self-start pt-1">
                  <Text className="text-rust text-sm font-semibold">Got it</Text>
                </TouchableOpacity>
              </View>
            )}

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
                placeholderTextColor={colors.inkFaint}
                returnKeyType="search"
                onSubmitEditing={handleFind}
                multiline={false}
                // Explicit style prevents Android text-clipping caused by
                // includeFontPadding collapsing the NativeWind py-* height.
                style={{
                  borderWidth: 1,
                  borderColor: colors.edge,
                  borderRadius: radius.md,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  fontSize: 16,
                  color: colors.ink,
                  backgroundColor: colors.surface,
                }}
              />
              <TouchableOpacity
                onPress={handleFind}
                disabled={!canSearch || loading}
                className={`py-4 rounded items-center flex-row justify-center gap-2 ${
                  canSearch && !loading ? "bg-rust" : "bg-sunken"
                }`}
              >
                {/* No spinner here on purpose — the results area below already
                    shows one, and two animations for a single wait read as two
                    things happening. The label carries the state instead. */}
                <Text
                  className={`text-base font-semibold ${
                    canSearch && !loading ? "text-ground" : "text-ink-faint"
                  }`}
                >
                  {loading ? "Styling…" : "Find My Outfit"}
                </Text>
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
              <View className="items-center py-16 gap-2">
                <ActivityIndicator size="large" color={colors.rust} />
                <Text className="text-ink-soft text-base font-medium mt-2">
                  {loadingStage(elapsed, phase)}
                </Text>
                <Text className="text-ink-faint text-xs">
                  {elapsed < 15
                    ? "Usually about 10 seconds."
                    : "Taking longer than usual — hang tight."}
                </Text>
              </View>
            )}

            {/* ── Empty / prompt state ────────────────────────────────────── */}
            {!loading && !result && !error && (
              <View className="items-center py-16 gap-3">
                {/* Brass marks the AI moments throughout the app. */}
                <Text style={{ fontSize: 36, color: colors.brass }}>{"\u2726\uFE0E"}</Text>
                <Text className="text-ink-soft text-base text-center">
                  Describe the occasion, weather, or vibe — or pin a piece you want
                  to wear — and the stylist will build a few looks from your closet.
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
                saved={savedKeys.has(outfitKey(current.outfit.map((p) => p.item_id)))}
                swappingId={swappingId}
                onSwapPiece={handleSwapPiece}
                saving={savingLook}
                onSave={handleSaveLook}
                onSelectIndex={setIndex}
                onRefresh={handleRefresh}
                onZoom={setZoom}
              />
            )}

            {/* Server returned a valid response with no buildable looks. Each
                cause needs a different thing offered back, so the notice
                branches on the reason rather than printing one message for
                every dead end. */}
            {result && !current && !loading && (
              <BlockedNotice
                result={result}
                onAddItems={onAddItems}
                onStyleWithoutShoes={handleStyleWithoutShoes}
                onUseSuggestion={(text) => {
                  setQuery(text);
                  inputRef.current?.focus();
                }}
              />
            )}
            </>
          ) : (
            <SavedOutfitsList
              refreshKey={savedRefreshKey}
              onFindOutfit={() => setMode("find")}
            />
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

// ── ModeToggle ────────────────────────────────────────────────────────────────

/**
 * FIND / SAVED, styled as the sign-in toggle so the two segmented controls in
 * the app read as the same component. Deliberately not a fifth tab — the bar
 * already runs four items at 9px and a fifth crushes the labels.
 */
function ModeToggle({
  mode,
  onChange,
}: {
  mode: "find" | "saved";
  onChange: (m: "find" | "saved") => void;
}) {
  return (
    <View
      className="flex-row p-1"
      style={{
        backgroundColor: colors.sunken,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.edge,
      }}
    >
      {(["find", "saved"] as const).map((m) => (
        <TouchableOpacity
          key={m}
          onPress={() => onChange(m)}
          className="flex-1 py-2.5 items-center"
          accessibilityRole="button"
          accessibilityState={{ selected: mode === m }}
          style={{
            borderRadius: radius.sm,
            backgroundColor: mode === m ? colors.surface : "transparent",
          }}
        >
          <Text
            style={{
              fontFamily: fonts.deco,
              fontSize: 12,
              letterSpacing: tracking.deco,
              color: mode === m ? colors.ink : colors.inkFaint,
            }}
          >
            {m === "find" ? "FIND" : "SAVED"}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
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
        className="flex-row items-center gap-3 border border-dashed border-edge rounded px-4 py-3"
      >
        <Text className="text-lg text-ink-faint">＋</Text>
        <View className="flex-1">
          <Text className="text-ink text-sm font-semibold">
            Style around a piece
          </Text>
          <Text className="text-ink-faint text-xs">
            Pick a shirt, trousers, anything — the look is built to match it
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View className="flex-row items-center gap-3 bg-rust-tint border border-rust-muted rounded p-2.5">
      {anchor.image_url ? (
        <Image
          source={{ uri: anchor.image_url }}
          style={{ width: 48, height: 48, borderRadius: radius.md }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={{ width: 48, height: 48, borderRadius: radius.md }}
          className="bg-chip-teal items-center justify-center"
        >
          <Text className="text-rust-muted text-[10px]">No photo</Text>
        </View>
      )}
      <View className="flex-1">
        <Text className="text-rust text-[10px] font-semibold uppercase tracking-wide">
          Building around
        </Text>
        <Text
          className="text-rust-deep text-sm font-medium capitalize"
          numberOfLines={1}
        >
          {[anchor.color, anchor.category].filter(Boolean).join(" ") || "Selected item"}
        </Text>
      </View>
      <TouchableOpacity
        onPress={onPick}
        className="px-2.5 py-1.5 rounded bg-surface border border-rust-muted"
      >
        <Text className="text-rust text-xs font-semibold">Change</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onClear}
        accessibilityRole="button"
        accessibilityLabel="Remove pinned piece"
        className="w-7 h-7 rounded-full bg-surface border border-rust-muted items-center justify-center"
      >
        <Text className="text-rust text-xs font-semibold">✕</Text>
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
  saved,
  saving,
  swappingId,
  onSelectIndex,
  onRefresh,
  onSave,
  onSwapPiece,
  onZoom,
}: {
  query: string;
  variation: Variation;
  index: number;
  total: number;
  refreshing: boolean;
  hasUnseen: boolean;
  saved: boolean;
  saving: boolean;
  swappingId: string | null;
  onSelectIndex: (i: number) => void;
  onRefresh: () => void;
  onSave: () => void;
  onSwapPiece: (itemId: string) => void;
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
        // Arrows rather than dots: with a variable number of looks, dots said
        // how many there were but not that you could move between them.
        <View className="flex-row items-center justify-center gap-4">
          <StepArrow
            direction="left"
            label="Previous look"
            disabled={index === 0}
            onPress={() => onSelectIndex(index - 1)}
          />
          <Text className="text-ink-soft text-xs font-semibold uppercase tracking-wide">
            Look {index + 1} of {total}
          </Text>
          <StepArrow
            direction="right"
            label="Next look"
            disabled={index >= total - 1}
            onPress={() => onSelectIndex(index + 1)}
          />
        </View>
      )}

      {/* Rationale banner */}
      <View className="bg-rust-tint border border-rust-muted rounded p-4">
        <Text className="text-rust text-xs font-semibold uppercase tracking-wide mb-1">
          {variation.name || "Styled for"}
        </Text>
        {query ? (
          <Text className="text-rust-deep text-sm font-medium italic leading-5">
            "{query}"
          </Text>
        ) : null}
        <Text className="text-rust-deep text-sm leading-5 mt-2">{rationale}</Text>
      </View>

      {/* Outfit pieces */}
      {outfit.length === 0 ? (
        <View className="bg-notice-tint border border-notice-edge rounded p-4 gap-1">
          <Text className="text-notice text-sm font-semibold">
            {closetIsEmpty(rationale)
              ? "Your closet is empty"
              : "No matching items found"}
          </Text>
          <Text className="text-chip-brass-ink text-sm leading-5">
            {closetIsEmpty(rationale)
              ? "Add and save some items first — the stylist needs photos to work with."
              : "Try rephrasing your query, or add more variety to your closet."}
          </Text>
        </View>
      ) : (
        <View className="gap-3">
          {outfit.map((piece, i) => (
            <OutfitCard
              key={piece?.item_id ?? i}
              piece={piece}
              swapping={swappingId === piece?.item_id}
              // One swap at a time: a second tap while the stylist is already
              // refilling a slot would race two answers into the same look.
              swapDisabled={swappingId !== null}
              onSwap={onSwapPiece}
              onZoom={onZoom}
            />
          ))}
        </View>
      )}

      {/* Says out loud what the small "In the laundry" links are for. Without
          a line of explanation they read as decoration and go untapped. */}
      {outfit.length > 0 && (
        <Text className="text-ink-faint text-xs text-center -mt-1">
          Something dirty or not available? Tap "In the laundry" on that piece
          and the stylist will swap it out.
        </Text>
      )}

      {/* ── Save ─────────────────────────────────────────────────────────── */}
      {outfit.length > 0 && (
        <TouchableOpacity
          onPress={onSave}
          disabled={saved || saving}
          className={`py-3.5 rounded items-center flex-row justify-center gap-2 ${
            saved
              ? "bg-success-tint border border-success"
              : saving
                ? "bg-sunken"
                : "bg-rust"
          }`}
          accessibilityRole="button"
          accessibilityLabel={saved ? "Outfit saved" : "Save this look"}
        >
          {saving ? (
            <>
              <ActivityIndicator size="small" color={colors.inkSoft} />
              <Text className="text-ink-soft text-sm font-semibold">Saving…</Text>
            </>
          ) : saved ? (
            <Text className="text-success text-sm font-semibold">
              Saved to your outfits
            </Text>
          ) : (
            <Text className="text-ground text-sm font-semibold">Save this look</Text>
          )}
        </TouchableOpacity>
      )}

      {/* ── Refresh ──────────────────────────────────────────────────────── */}
      {outfit.length > 0 && (
        <TouchableOpacity
          onPress={onRefresh}
          disabled={refreshing}
          className={`py-3.5 rounded items-center flex-row justify-center gap-2 border ${
            refreshing
              ? "bg-sunken border-edge"
              : "bg-surface border-rust-muted"
          }`}
        >
          {refreshing ? (
            <>
              <ActivityIndicator size="small" color={colors.rust} />
              <Text className="text-ink-soft text-sm font-semibold">
                Styling more looks…
              </Text>
            </>
          ) : (
            <>
              <Text className="text-rust text-sm">↻</Text>
              <Text className="text-rust text-sm font-semibold">
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
        <View className="bg-notice-tint border border-notice-edge rounded p-4 gap-2">
          <Text className="text-chip-brass-ink text-xs font-semibold uppercase tracking-wide">
            Not in this look
          </Text>
          {missing.map((m, i) => (
            <View key={i} className="flex-row items-start gap-2">
              <Text className="text-notice">•</Text>
              <Text className="text-notice text-sm leading-5 flex-1">
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

// ── StepArrow ─────────────────────────────────────────────────────────────────

/** Side of the square that carries the two visible borders, per direction. */
const CHEVRON_SIDES = {
  right: { borderTopWidth: 2, borderRightWidth: 2, rotate: "45deg" },
  left: { borderTopWidth: 2, borderLeftWidth: 2, rotate: "-45deg" },
} as const;

function StepArrow({
  direction,
  label,
  disabled,
  onPress,
}: {
  direction: "left" | "right";
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const side = CHEVRON_SIDES[direction];
  const color = disabled ? colors.edge : colors.rust;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      // Generous hit area — the mark itself is deliberately small and quiet.
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      className={`rounded-full border items-center justify-center ${
        disabled ? "border-edge" : "border-edge"
      }`}
      style={{ width: 32, height: 32 }}
    >
      {/* Drawn from borders rather than typed as a ‹ or › character. Two
          previous attempts to centre the glyph failed because the problem is
          the font, not the layout: the guillemets' ink sits off-centre inside
          their own em box, so both flex centring and an explicit lineHeight
          faithfully centred a box whose contents were already lopsided.
          A rotated square has no such metrics — its geometry is the mark. */}
      <View
        style={{
          width: 9,
          height: 9,
          borderTopWidth: side.borderTopWidth,
          borderRightWidth: "borderRightWidth" in side ? side.borderRightWidth : 0,
          borderLeftWidth: "borderLeftWidth" in side ? side.borderLeftWidth : 0,
          borderColor: color,
          transform: [
            { rotate: side.rotate },
            // The vertex lands on the bounding box's edge while the arms trail
            // behind it, so the ink sits ~1px toward the point. Nudge back for
            // optical centring.
            { translateX: direction === "right" ? -1 : 1 },
          ],
        }}
      />
    </TouchableOpacity>
  );
}

// ── OutfitCard ────────────────────────────────────────────────────────────────

const REASON_LINES = 3;

function OutfitCard({
  piece,
  swapping,
  swapDisabled,
  onSwap,
  onZoom,
}: {
  piece: OutfitPiece;
  swapping: boolean;
  swapDisabled: boolean;
  onSwap: (itemId: string) => void;
  onZoom: (z: { uri: string; caption: string }) => void;
}) {
  // piece itself may be malformed if the response shape drifts; default it.
  const item = piece?.item;
  const role = piece?.role ?? "item";
  const reason = piece?.reason ?? "";
  const { bg, text } = rolePillStyle(role);
  const caption = [item?.color, item?.category].filter(Boolean).join(" · ");

  const [expanded, setExpanded] = useState(false);
  // Only offer "More" when the text was actually clipped. While collapsed the
  // layout reports at most REASON_LINES lines, so hitting that limit is the
  // signal there may be more to show.
  const [clipped, setClipped] = useState(false);

  return (
    <View
      className={`flex-row bg-surface border rounded overflow-hidden ${
        piece?.is_anchor ? "border-rust-muted" : "border-edge"
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
            className="bg-ink/45 w-5 h-5 rounded-full items-center justify-center"
          >
            <Text className="text-ground text-[10px]">⤢</Text>
          </View>
        </TouchableOpacity>
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
          {piece?.is_anchor && (
            <View className="px-2 py-0.5 rounded-full bg-rust">
              <Text className="text-ground text-xs font-semibold">Your pick</Text>
            </View>
          )}
          {item?.color ? (
            <Text
              className="text-ink-faint text-xs capitalize flex-1"
              numberOfLines={1}
            >
              {item.color}
              {item.category ? ` · ${item.category}` : ""}
            </Text>
          ) : null}
        </View>

        {/* The stylist's reason — tap to expand when it runs past three lines */}
        <TouchableOpacity
          activeOpacity={clipped ? 0.6 : 1}
          onPress={() => clipped && setExpanded((e) => !e)}
          accessibilityRole={clipped ? "button" : "text"}
          accessibilityLabel={
            clipped
              ? `${reason}. Tap to ${expanded ? "collapse" : "read more"}`
              : reason
          }
        >
          <Text
            className="text-ink text-sm leading-5"
            numberOfLines={expanded ? undefined : REASON_LINES}
            onTextLayout={(e) => {
              if (!expanded && e.nativeEvent.lines.length >= REASON_LINES) {
                setClipped(true);
              }
            }}
          >
            {reason}
          </Text>
          {clipped && (
            <Text className="text-rust text-xs font-semibold mt-0.5">
              {expanded ? "Less" : "More"}
            </Text>
          )}
        </TouchableOpacity>

        {/* ── In the laundry ───────────────────────────────────────────
            Deliberately quiet and per-piece. The complaint it answers is
            never "this outfit is wrong", it is "this one shirt is in the
            wash" — so the control sits on the shirt, and the rest of the
            look survives the tap. A pinned piece has no such control: the
            user chose it, and swapping it out would undo the request. */}
        {!piece?.is_anchor && piece?.item_id ? (
          <TouchableOpacity
            onPress={() => onSwap(piece.item_id)}
            disabled={swapDisabled}
            accessibilityRole="button"
            accessibilityLabel={`Replace this ${role} — it is in the laundry`}
            accessibilityState={{ disabled: swapDisabled, busy: swapping }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            className="flex-row items-center gap-1.5 self-start pt-1"
          >
            {swapping ? (
              <>
                <ActivityIndicator size="small" color={colors.inkSoft} />
                <Text className="text-ink-soft text-xs font-semibold">
                  Finding a replacement…
                </Text>
              </>
            ) : (
              <Text
                className={`text-xs font-semibold ${
                  swapDisabled ? "text-ink-faint" : "text-teal"
                }`}
              >
                ⟳ In the laundry
              </Text>
            )}
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

// ── BlockedNotice ─────────────────────────────────────────────────────────────

/**
 * What the screen shows when the stylist was never run.
 *
 * The function refuses some requests before spending anything — an empty
 * closet, a wardrobe with no bottoms, a query asking what to wear on the moon.
 * Each refusal is a different problem and needs a different way out, so this
 * branches rather than printing one apology for all of them. The prose itself
 * comes from the server (`result.message`) so the two can never disagree; what
 * lives here is the heading and the action.
 */
function BlockedNotice({
  result,
  onAddItems,
  onStyleWithoutShoes,
  onUseSuggestion,
}: {
  result: OutfitResult;
  onAddItems?: () => void;
  onStyleWithoutShoes: () => void;
  onUseSuggestion: (text: string) => void;
}) {
  const { reason, message, suggestion, missingCategories } = result;

  const title =
    reason === "empty_closet"
      ? "Your closet is empty"
      : reason === "closet_processing"
        ? "Still cataloguing your closet"
        : reason === "insufficient_closet"
          ? `You need ${missingCategories.length > 1 ? "a few more things" : "one more thing"}`
          : reason === "needs_shoes_confirmation"
            ? "No shoes in your closet"
            : reason === "implausible_request"
              ? "That one needs a spacesuit"
              : "No outfits to show";

  const body =
    message || "Try rephrasing your search, or add more variety to your closet.";

  const needsCloset = reason === "empty_closet" || reason === "insufficient_closet";

  return (
    <View className="bg-notice-tint border border-notice-edge rounded p-4 gap-2">
      <Text className="text-notice text-sm font-semibold">{title}</Text>
      <Text className="text-chip-brass-ink text-sm leading-5">{body}</Text>

      {/* A suggestion is the rephrasing that WOULD have worked, so it goes
          straight into the box rather than being something to retype. */}
      {reason === "implausible_request" && suggestion ? (
        <TouchableOpacity
          onPress={() => onUseSuggestion(suggestion)}
          className="self-start bg-surface border border-notice-edge rounded px-3 py-2 mt-1"
          accessibilityRole="button"
        >
          <Text className="text-notice text-sm">
            Try <Text className="font-semibold">"{suggestion}"</Text> instead
          </Text>
        </TouchableOpacity>
      ) : null}

      {reason === "needs_shoes_confirmation" ? (
        <View className="flex-row flex-wrap gap-2 mt-1">
          <TouchableOpacity
            onPress={onStyleWithoutShoes}
            className="bg-rust rounded px-4 py-2.5"
            accessibilityRole="button"
          >
            <Text className="text-ground text-sm font-semibold">
              Style it anyway
            </Text>
          </TouchableOpacity>
          {onAddItems ? (
            <TouchableOpacity
              onPress={onAddItems}
              className="bg-surface border border-notice-edge rounded px-4 py-2.5"
              accessibilityRole="button"
            >
              <Text className="text-notice text-sm font-semibold">Add shoes</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {needsCloset && onAddItems ? (
        <TouchableOpacity
          onPress={onAddItems}
          className="self-start bg-rust rounded px-4 py-2.5 mt-1"
          accessibilityRole="button"
        >
          <Text className="text-ground text-sm font-semibold">
            Add clothes to your closet
          </Text>
        </TouchableOpacity>
      ) : null}
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

  const rawReason = typeof d.reason === "string" ? d.reason : null;

  return {
    query: typeof d.query === "string" ? d.query : "",
    anchor: (d.anchor ?? null) as ItemDetail | null,
    variations,
    message: typeof d.rationale === "string" ? d.rationale : "",
    // Only trust a reason we know how to render. An unrecognised one — from a
    // function newer than this build — falls through to the generic notice,
    // which still shows the server's own prose.
    reason: BLOCK_REASONS.includes(rawReason as BlockReason)
      ? (rawReason as BlockReason)
      : null,
    suggestion: typeof d.suggestion === "string" ? d.suggestion : "",
    missingCategories: Array.isArray(d.missing_categories)
      ? (d.missing_categories as unknown[]).map((c) => String(c ?? ""))
      : [],
  };
}

/**
 * Folds a swap's answer back into the look it replaced.
 *
 * The server rebuilds the whole outfit around the pieces it was told to keep,
 * and writes a placeholder reason for each of them — it has no idea what those
 * pieces were justified with the first time round. The user does: they read it
 * a moment ago. So the kept pieces get their original sentences back, and only
 * the genuinely new garment arrives with new words.
 *
 * The name and rationale come from the replacement, because the look really
 * has changed and describing it with the old outfit's summary would be a lie.
 */
function mergeSwappedLook(previous: Variation, replacement: Variation): Variation {
  const priorReasons = new Map(
    previous.outfit.map((piece) => [piece.item_id, piece.reason]),
  );

  return {
    ...replacement,
    outfit: replacement.outfit.map((piece) => {
      const prior = priorReasons.get(piece.item_id);
      return piece.is_kept && prior ? { ...piece, reason: prior } : piece;
    }),
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
      is_kept: p.is_kept === true,
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
  return /no embedded items|add some pieces|add some clothes first/i.test(rationale);
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
