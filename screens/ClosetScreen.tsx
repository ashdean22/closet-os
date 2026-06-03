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

type SortMode = "newest" | "least_worn";

// DetailItem (imported) is the full shape; Item is the same type used locally.
type Item = DetailItem & { created_at: string; secondary_color: string | null };

// ── Helpers ───────────────────────────────────────────────────────────────────

function wornLabel(lastWorn: string | null): string {
  if (!lastWorn) return "Never worn";
  const days = Math.floor(
    (Date.now() - new Date(lastWorn).getTime()) / 86_400_000,
  );
  if (days === 0) return "Wore today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function isWornToday(lastWorn: string | null): boolean {
  if (!lastWorn) return false;
  return Math.floor((Date.now() - new Date(lastWorn).getTime()) / 86_400_000) === 0;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ClosetScreen({ refreshKey = 0 }: { refreshKey?: number }) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);

  const fetchItems = useCallback(async (sort: SortMode) => {
    // For "least_worn", sort in the app after fetching so we avoid the
    // nullsFirst option (unsupported by supabase-js types without db codegen).
    const { data, error } = await supabase
      .from("items")
      .select(
        "id, image_url, color, secondary_color, category, formality, season, " +
          "material, description, last_worn, created_at",
      )
      .order("created_at", { ascending: false });

    if (error) {
      Alert.alert("Fetch error", error.message);
      return;
    }

    let rows = (data ?? []) as unknown as Item[];

    if (sort === "least_worn") {
      // null last_worn → treat as epoch 0 so nulls sort first (oldest/unworn)
      rows = [...rows].sort((a, b) => {
        const ta = a.last_worn ? new Date(a.last_worn).getTime() : 0;
        const tb = b.last_worn ? new Date(b.last_worn).getTime() : 0;
        return ta - tb;
      });
    }

    setItems(rows);
  }, []);

  useEffect(() => {
    // refreshKey > 0 means an item was just added — fetch silently (no spinner).
    // refreshKey === 0 is the initial mount, which needs the loading spinner.
    if (refreshKey > 0) {
      fetchItems(sortMode);
    } else {
      fetchItems(sortMode).finally(() => setLoading(false));
    }
  }, [fetchItems, sortMode, refreshKey]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchItems(sortMode);
    setRefreshing(false);
  }, [fetchItems, sortMode]);

  const handleWoreToday = useCallback(
    async (id: string, currentLastWorn: string | null) => {
      // Toggle: if already marked today, undo by setting null; otherwise mark now.
      const newValue = isWornToday(currentLastWorn) ? null : new Date().toISOString();
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, last_worn: newValue } : item)),
      );
      const { error } = await supabase
        .from("items")
        .update({ last_worn: newValue })
        .eq("id", id);
      if (error) {
        Alert.alert("Update failed", error.message);
        fetchItems(sortMode);
      }
    },
    [fetchItems, sortMode],
  );

  // ── modal callbacks ───────────────────────────────────────────────────────

  const handleDescriptionUpdated = useCallback((id: string, description: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, description } : item)),
    );
    // Keep the open modal in sync
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
        ListHeaderComponent={
          <ClosetHeader
            sortMode={sortMode}
            onToggleSort={() =>
              setSortMode((m) => (m === "newest" ? "least_worn" : "newest"))
            }
          />
        }
        ListEmptyComponent={
          <View className="items-center justify-center py-24">
            <Text className="text-5xl mb-4">👔</Text>
            <Text className="text-gray-500 text-base text-center">
              No items yet —{"\n"}add your first piece
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <ItemCard
            item={item}
            onPress={setSelectedItem}
            onWoreToday={(id) => handleWoreToday(id, item.last_worn)}
          />
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

function ClosetHeader({
  sortMode,
  onToggleSort,
}: {
  sortMode: SortMode;
  onToggleSort: () => void;
}) {
  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert("Sign out error", error.message);
  };

  return (
    <View className="gap-3 mb-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-2xl font-bold text-gray-800">My Closet</Text>
        <TouchableOpacity
          onPress={handleSignOut}
          className="px-3 py-1.5 rounded-lg bg-gray-100"
        >
          <Text className="text-gray-500 text-xs font-medium">Log Out</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        onPress={onToggleSort}
        className={`self-start flex-row items-center gap-1.5 px-3 py-1.5 rounded-full border ${
          sortMode === "least_worn"
            ? "bg-indigo-50 border-indigo-200"
            : "bg-gray-50 border-gray-200"
        }`}
      >
        <Text
          className={`text-xs font-semibold ${
            sortMode === "least_worn" ? "text-indigo-600" : "text-gray-400"
          }`}
        >
          {sortMode === "least_worn" ? "↑ Least recently worn" : "Sort: newest"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ── ItemCard ──────────────────────────────────────────────────────────────────

function ItemCard({
  item,
  onPress,
  onWoreToday,
}: {
  item: Item;
  onPress: (item: Item) => void;
  onWoreToday: (id: string) => void;
}) {
  const today = isWornToday(item.last_worn);
  const label = wornLabel(item.last_worn);

  return (
    <View
      style={{ flex: 1 }}
      className="bg-white rounded-2xl overflow-hidden border border-gray-100"
    >
      {/* Tappable area → opens detail modal */}
      <TouchableOpacity onPress={() => onPress(item)} activeOpacity={0.85}>
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

        <View className="px-2 pt-2 gap-0.5">
          <Text
            className="text-sm font-semibold text-gray-800 capitalize"
            numberOfLines={1}
          >
            {item.category ?? "—"}
          </Text>
          <Text className="text-xs text-gray-500 capitalize" numberOfLines={1}>
            {item.color ?? "—"}
          </Text>
          <Text
            className={`text-xs ${today ? "text-emerald-600" : "text-gray-400"}`}
            numberOfLines={1}
          >
            {today ? "✓ " : ""}
            {label}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Wore Today — separate touch target, does NOT open the modal.
          Tap when already marked today to undo (sets last_worn → null). */}
      <TouchableOpacity
        onPress={() => onWoreToday(item.id)}
        className={`mx-2 mb-2 mt-1.5 py-1 rounded-lg items-center ${
          today ? "bg-emerald-50" : "bg-gray-50"
        }`}
      >
        <Text
          className={`text-xs font-semibold ${
            today ? "text-emerald-600" : "text-gray-400"
          }`}
        >
          {today ? "Wore today ✓" : "Wore today"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
