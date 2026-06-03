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

  const handleDescriptionUpdated = useCallback((id: string, description: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, description } : item)),
    );
    setSelectedItem((prev) => (prev?.id === id ? { ...prev, description } : prev));
  }, []);

  const handleDeleted = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // ── render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <ScreenWrapper>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#4f46e5" />
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
            tintColor="#4f46e5"
          />
        }
        ListHeaderComponent={<ClosetHeader />}
        ListEmptyComponent={
          <View className="items-center justify-center py-24">
            <Text className="text-5xl mb-4">👔</Text>
            <Text className="text-gray-500 text-base text-center">
              No items yet —{"\n"}add your first piece
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
        onDescriptionUpdated={handleDescriptionUpdated}
      />
    </ScreenWrapper>
  );
}

// ── ClosetHeader ──────────────────────────────────────────────────────────────

function ClosetHeader() {
  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert("Sign out error", error.message);
  };

  return (
    <View className="flex-row items-center justify-between mb-4">
      <Text className="text-2xl font-bold text-gray-800">My Closet</Text>
      <TouchableOpacity
        onPress={handleSignOut}
        className="px-3 py-1.5 rounded-lg bg-gray-100"
      >
        <Text className="text-gray-500 text-xs font-medium">Log Out</Text>
      </TouchableOpacity>
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
      style={{ flex: 1 }}
      activeOpacity={0.85}
      onPress={() => onPress(item)}
      className="bg-white rounded-2xl overflow-hidden border border-gray-100"
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
          <Text className="text-gray-400 text-xs">No image</Text>
        </View>
      )}

      <View className="px-2 py-2 gap-0.5">
        <Text
          className="text-sm font-semibold text-gray-800 capitalize"
          numberOfLines={1}
        >
          {item.category ?? "—"}
        </Text>
        <Text className="text-xs text-gray-500 capitalize" numberOfLines={1}>
          {item.color ?? "—"}
        </Text>
        <Text className="text-xs text-gray-400 capitalize" numberOfLines={1}>
          {item.formality ?? "—"}
        </Text>
      </View>
    </TouchableOpacity>
  );
}
