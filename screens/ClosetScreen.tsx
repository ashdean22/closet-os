import React, { useEffect, useState, useCallback } from "react";
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
import { supabase } from "../lib/supabase";
import { colors, fonts, tracking } from "../lib/theme";

// ── Types ─────────────────────────────────────────────────────────────────────

// DetailItem (imported) is the full shape; Item extends it with list-only fields.
type Item = DetailItem & { created_at: string };

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ClosetScreen({ refreshKey = 0 }: { refreshKey?: number }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);

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
        data={items}
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
        ListHeaderComponent={<ClosetHeader count={items.length} />}
        ListEmptyComponent={
          <View className="items-center justify-center py-24">
            <Text className="text-5xl mb-5">👔</Text>
            <Text
              style={{
                fontFamily: fonts.deco,
                fontSize: 16,
                letterSpacing: tracking.deco,
                color: colors.ink,
                textAlign: "center",
              }}
            >
              Nothing Here Yet
            </Text>
            <Text
              style={{ color: colors.inkSoft, fontSize: 14, textAlign: "center", marginTop: 6 }}
            >
              Add your first piece to get started.
            </Text>
          </View>
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

function ClosetHeader({ count }: { count: number }) {
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
            {count} {count === 1 ? "ITEM" : "ITEMS"}
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
