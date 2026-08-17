import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  Image,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  type Category,
} from "../lib/wardrobe";

export type PickableItem = {
  id: string;
  image_url: string | null;
  color: string | null;
  category: string | null;
  formality: string | null;
};

/**
 * Closet browser for choosing the piece an outfit gets built around
 * ("I want something to go with this shirt").
 *
 * Fetches its own rows rather than taking them from ClosetScreen: the two
 * screens are siblings under App's tab switcher with no shared store, and the
 * query is a cheap indexed select on a wardrobe-sized table.
 */
export default function ItemPickerModal({
  visible,
  onSelect,
  onClose,
}: {
  visible: boolean;
  onSelect: (item: PickableItem) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<PickableItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | null>(null);

  const fetchItems = useCallback(async () => {
    setError(null);
    // RLS scopes this to the signed-in user; no explicit user_id filter needed.
    const { data, error: fetchError } = await supabase
      .from("items")
      .select("id, image_url, color, category, formality")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError("Couldn't load your closet. Tap retry.");
      setLoaded(true);
      return;
    }
    setItems((data ?? []) as PickableItem[]);
    setLoaded(true);
  }, []);

  // Stale-while-revalidate: the previously-loaded closet is shown instantly on
  // reopen and refreshed in the background, so only the very first open waits
  // on the network. Re-fetching every time is still necessary — a piece may
  // have been added or deleted since the last visit.
  useEffect(() => {
    if (visible) fetchItems();
  }, [visible, fetchItems]);

  // Only the first open has nothing to show; later opens render stale rows.
  const showSpinner = !loaded && items.length === 0;

  const availableCategories = useMemo(() => {
    const present = new Set(items.map((i) => i.category ?? "other"));
    return CATEGORIES.filter((c) => present.has(c));
  }, [items]);

  const visibleItems = useMemo(
    () =>
      category === null
        ? items
        : items.filter((i) => (i.category ?? "other") === category),
    [items, category],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: "white" }}>
        {Platform.OS === "ios" && (
          <View className="items-center pt-3 pb-1">
            <View className="w-9 h-1 rounded-full bg-gray-300" />
          </View>
        )}

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <View className="px-5 pt-3 pb-2 flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-xl font-bold text-gray-800">
              Style around a piece
            </Text>
            <Text className="text-gray-500 text-sm mt-0.5">
              Pick one item and the rest of the look is built to match it.
            </Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            className="bg-gray-100 w-9 h-9 rounded-full items-center justify-center"
          >
            <Text className="text-gray-600 text-base font-semibold">✕</Text>
          </TouchableOpacity>
        </View>

        {/* ── Category filter ────────────────────────────────────────────── */}
        {availableCategories.length > 1 && (
          // Wraps rather than scrolls horizontally: with "All" plus up to seven
          // categories the row overflowed the screen, and the chips past the
          // edge looked cut off with nothing signalling they could be scrolled
          // to. Wrapping costs a little vertical space and shows every option.
          <View className="flex-row flex-wrap gap-2 px-5 py-2.5">
            <PickerChip
              label="All"
              selected={category === null}
              onPress={() => setCategory(null)}
            />
            {availableCategories.map((c) => (
              <PickerChip
                key={c}
                label={CATEGORY_LABELS[c]}
                selected={category === c}
                onPress={() => setCategory(c)}
              />
            ))}
          </View>
        )}

        {/* ── Grid ───────────────────────────────────────────────────────── */}
        {showSpinner ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#4f46e5" />
          </View>
        ) : error && items.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8 gap-3">
            <Text className="text-gray-600 text-sm text-center">{error}</Text>
            <TouchableOpacity
              onPress={fetchItems}
              className="px-4 py-2 rounded-lg bg-gray-100"
            >
              <Text className="text-gray-700 text-sm font-semibold">Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={visibleItems}
            keyExtractor={(item) => item.id}
            numColumns={3}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingBottom: insets.bottom + 24,
            }}
            columnWrapperStyle={{ gap: 10 }}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            // Paint the first two rows immediately instead of waiting on the
            // whole wardrobe to measure — the main cause of the open feeling slow.
            initialNumToRender={9}
            windowSize={5}
            removeClippedSubviews
            ListEmptyComponent={
              <View className="items-center py-24 gap-2">
                <Text className="text-4xl">👔</Text>
                <Text className="text-gray-500 text-sm text-center">
                  {items.length === 0
                    ? "Add some items to your closet first."
                    : "Nothing in that category yet."}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={{ flex: 1 / 3 }}
                activeOpacity={0.8}
                onPress={() => onSelect(item)}
                className="rounded-xl overflow-hidden border border-gray-100 bg-white"
              >
                {item.image_url ? (
                  <Image
                    source={{ uri: item.image_url }}
                    style={{ width: "100%", aspectRatio: 1 }}
                    resizeMode="cover"
                  />
                ) : (
                  <View
                    style={{ width: "100%", aspectRatio: 1 }}
                    className="bg-gray-100 items-center justify-center"
                  >
                    <Text className="text-gray-400 text-[10px]">No photo</Text>
                  </View>
                )}
                <View className="px-1.5 py-1.5">
                  <Text
                    className="text-[11px] font-semibold text-gray-700 capitalize"
                    numberOfLines={1}
                  >
                    {item.category ?? "—"}
                  </Text>
                  <Text
                    className="text-[10px] text-gray-400 capitalize"
                    numberOfLines={1}
                  >
                    {item.color ?? "—"}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

function PickerChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`px-3 py-1.5 rounded-full border ${
        selected ? "bg-indigo-600 border-indigo-600" : "bg-white border-gray-200"
      }`}
    >
      <Text
        className={`text-xs font-semibold ${
          selected ? "text-white" : "text-gray-600"
        }`}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
