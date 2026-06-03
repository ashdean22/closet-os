import React, { useState, useRef } from "react";
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
import { supabase } from "../lib/supabase";

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
  item: ItemDetail;
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

  const handleFind = async () => {
    if (!query.trim()) return;
    Keyboard.dismiss();
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke<OutfitResult>(
        "find-outfit",
        { body: { query: query.trim() } },
      );

      if (fnError) throw fnError;
      if (!data) throw new Error("find-outfit returned no data");
      setResult(data);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setError(friendlyOutfitError(raw));
    } finally {
      setLoading(false);
    }
  };

  return (
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

          {/* ── Query input ────────────────────────────────────────────── */}
          <View className="gap-3">
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="e.g. outfit for a 65° rainy interview"
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
              disabled={!query.trim() || loading}
              className={`py-4 rounded-xl items-center flex-row justify-center gap-2 ${
                query.trim() && !loading ? "bg-indigo-600" : "bg-gray-300"
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
                Finding your outfit…
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
                Describe the occasion, weather, or vibe and Claude will build an outfit from your closet.
              </Text>
            </View>
          )}

          {/* ── Results ────────────────────────────────────────────────── */}
          {result && <OutfitResults result={result} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenWrapper>
  );
}

// ── OutfitResults ─────────────────────────────────────────────────────────────

function OutfitResults({ result }: { result: OutfitResult }) {
  return (
    <View className="gap-4">
      {/* Rationale banner */}
      <View className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
        <Text className="text-indigo-500 text-xs font-semibold uppercase tracking-wide mb-1">
          Styled for
        </Text>
        <Text className="text-indigo-900 text-sm font-medium italic leading-5">
          "{result.query}"
        </Text>
        <Text className="text-indigo-800 text-sm leading-5 mt-2">
          {result.rationale}
        </Text>
      </View>

      {/* Outfit pieces */}
      {result.outfit.length === 0 ? (
        <View className="bg-amber-50 border border-amber-200 rounded-xl p-4 gap-1">
          <Text className="text-amber-800 text-sm font-semibold">
            {closetIsEmpty(result.rationale)
              ? "Your closet is empty"
              : "No matching items found"}
          </Text>
          <Text className="text-amber-700 text-sm leading-5">
            {closetIsEmpty(result.rationale)
              ? "Add and save some items first — the AI needs photos to work with."
              : "Try rephrasing your query, or add more variety to your closet."}
          </Text>
        </View>
      ) : (
        <View className="gap-3">
          {result.outfit.map((piece) => (
            <OutfitCard key={piece.item_id} piece={piece} />
          ))}
        </View>
      )}

      {/* Missing items */}
      {result.missing.length > 0 && (
        <View className="bg-amber-50 border border-amber-200 rounded-2xl p-4 gap-2">
          <Text className="text-amber-700 text-xs font-semibold uppercase tracking-wide">
            Missing from your closet
          </Text>
          {result.missing.map((m, i) => (
            <View key={i} className="flex-row items-center gap-2">
              <Text className="text-amber-500">•</Text>
              <Text className="text-amber-800 text-sm capitalize">{m}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── OutfitCard ────────────────────────────────────────────────────────────────

function OutfitCard({ piece }: { piece: OutfitPiece }) {
  const { item, role, reason } = piece;
  const { bg, text } = rolePillStyle(role);

  return (
    <View className="flex-row bg-white border border-gray-100 rounded-2xl overflow-hidden">
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
          {item?.color ? (
            <Text className="text-gray-400 text-xs capitalize" numberOfLines={1}>
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

/** Maps raw error strings to user-readable messages. */
function friendlyOutfitError(raw: string): string {
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
