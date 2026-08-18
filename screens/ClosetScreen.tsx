import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  Image,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Alert,
  TouchableOpacity,
} from "react-native";
import ScreenWrapper from "../components/ScreenWrapper";
import ItemDetailModal, { type DetailItem } from "../components/ItemDetailModal";
import ClosetFilterBar from "../components/ClosetFilterBar";
import { supabase } from "../lib/supabase";
import { colors, fonts, tracking } from "../lib/theme";
import {
  EMPTY_FILTERS,
  filterItems,
  filtersAreEmpty,
  sortItems,
  type ClosetFilters,
  type SortKey,
} from "../lib/wardrobe";

// ── Types ─────────────────────────────────────────────────────────────────────

// DetailItem (imported) is the full shape; Item extends it with list-only fields.
type Item = DetailItem & { created_at: string };

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ClosetScreen({ refreshKey = 0 }: { refreshKey?: number }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [filters, setFilters] = useState<ClosetFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>("newest");

  // Filtering and sorting are both client-side: the whole closet is already in
  // memory after fetchItems, so a round-trip per chip press would be slower and
  // would spend requests to re-fetch rows we're holding.
  const visibleItems = useMemo(
    () => sortItems(filterItems(items, filters), sort),
    [items, filters, sort],
  );

  const fetchItems = useCallback(async () => {
    const { data, error } = await supabase
      .from("items")
      .select(
        "id, image_url, color, secondary_color, category, formality, season, " +
          "material, description, created_at",
      )
      .order("created_at", { ascending: false });

    if (error) {
      Alert.alert("Fetch error", error.message);
      return;
    }

    setItems((data ?? []) as unknown as Item[]);
  }, []);

  useEffect(() => {
    // refreshKey > 0 means an item was just added — fetch silently (no spinner).
    // refreshKey === 0 is the initial mount, which needs the loading spinner.
    if (refreshKey > 0) {
      fetchItems();
    } else {
      fetchItems().finally(() => setLoading(false));
    }
  }, [fetchItems, refreshKey]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchItems();
    setRefreshing(false);
  }, [fetchItems]);

  // ── modal callbacks ───────────────────────────────────────────────────────

  const handleItemUpdated = useCallback((id: string, patch: Partial<DetailItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
    setSelectedItem((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
  }, []);

  const handleDeleted = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // ── render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <ScreenWrapper>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.rust} />
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <FlatList
        data={visibleItems}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
        columnWrapperStyle={{ gap: 12 }}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.rust}
          />
        }
        // Passed as an element, not a render function: an inline arrow would be
        // a new component type every render and would reset the filter panel's
        // open/closed state on each keystroke of interaction.
        ListHeaderComponent={
          <View>
            <ClosetHeader
              count={items.length}
              showing={visibleItems.length}
              filtered={!filtersAreEmpty(filters)}
            />
            {items.length > 0 && (
              <ClosetFilterBar
                items={items}
                filters={filters}
                sort={sort}
                onChangeFilters={setFilters}
                onChangeSort={setSort}
              />
            )}
          </View>
        }
        ListEmptyComponent={
          items.length > 0 ? (
            // The closet has items, they're just all filtered out — say that
            // rather than showing the "add your first piece" empty state.
            <View className="items-center justify-center py-20 gap-3">
              <Text className="text-4xl">🔍</Text>
              <Text className="text-ink-soft text-base text-center">
                Nothing matches those filters.
              </Text>
              <TouchableOpacity
                onPress={() => setFilters(EMPTY_FILTERS)}
                className="px-4 py-2 rounded bg-sunken"
              >
                <Text className="text-ink text-sm font-semibold">
                  Clear filters
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View className="items-center justify-center py-24">
              <Text className="text-5xl mb-5">👔</Text>
              <Text
                style={{
                  fontFamily: fonts.deco,
                  fontSize: 16,
                  letterSpacing: tracking.deco,
                  color: colors.ink,
                }}
              >
                Nothing Here Yet
              </Text>
              <Text
                style={{ color: colors.inkSoft, fontSize: 14, marginTop: 6 }}
              >
                Add your first piece to get started.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <ItemCard item={item} onPress={setSelectedItem} />
        )}
      />

      <ItemDetailModal
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        onDeleted={handleDeleted}
        onItemUpdated={handleItemUpdated}
      />
    </ScreenWrapper>
  );
}

// ── ClosetHeader ──────────────────────────────────────────────────────────────
// Log Out lives on the Settings tab now — this header is title-only.

function ClosetHeader({
  count,
  showing,
  filtered,
}: {
  count: number;
  showing: number;
  filtered: boolean;
}) {
  return (
    <View className="mb-5">
      <View className="flex-row items-baseline justify-between">
        <Text
          style={{
            fontFamily: fonts.deco,
            fontSize: 24,
            letterSpacing: tracking.deco,
            color: colors.ink,
          }}
        >
          My Closet
        </Text>
        {count > 0 && (
          <Text
            style={{
              fontFamily: fonts.deco,
              fontSize: 12,
              letterSpacing: tracking.deco,
              color: colors.rust,
            }}
          >
            {filtered
              ? `${showing} OF ${count}`
              : `${count} ${count === 1 ? "ITEM" : "ITEMS"}`}
          </Text>
        )}
      </View>
      {/* Doubled Deco rule under the title. */}
      <View style={{ height: 2, backgroundColor: colors.ink, marginTop: 8 }} />
      <View style={{ height: 1, backgroundColor: colors.brass, marginTop: 2 }} />
    </View>
  );
}

// ── ItemCard ──────────────────────────────────────────────────────────────────

function ItemCard({
  item,
  onPress,
}: {
  item: Item;
  onPress: (item: Item) => void;
}) {
  return (
    <TouchableOpacity
      style={{ flex: 1, borderRadius: 4 }}
      activeOpacity={0.85}
      onPress={() => onPress(item)}
      className="bg-surface overflow-hidden border border-edge"
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
          className="bg-sunken items-center justify-center"
        >
          <Text className="text-ink-faint text-xs">No image</Text>
        </View>
      )}

      {/* Brass hairline separating the photo from its label plate. */}
      <View style={{ height: 1, backgroundColor: colors.brass }} />

      <View className="px-2.5 py-2">
        <Text
          style={{
            fontFamily: fonts.deco,
            fontSize: 12,
            letterSpacing: tracking.deco,
            color: colors.ink,
            textTransform: "capitalize",
          }}
          numberOfLines={1}
        >
          {item.category ?? "—"}
        </Text>
        <Text
          className="capitalize"
          style={{ fontSize: 12, color: colors.inkSoft, marginTop: 2 }}
          numberOfLines={1}
        >
          {item.color ?? "—"}
        </Text>
        <Text
          className="capitalize"
          style={{ fontSize: 11, color: colors.inkFaint }}
          numberOfLines={1}
        >
          {item.formality ?? "—"}
        </Text>
      </View>
    </TouchableOpacity>
  );
}
