import "./global.css";
import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import AuthScreen from "./screens/AuthScreen";
import HomeScreen from "./screens/HomeScreen";
import ClosetScreen from "./screens/ClosetScreen";
import OutfitScreen from "./screens/OutfitScreen";

type Tab = "home" | "closet" | "outfit";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [tab, setTab] = useState<Tab>("home");
  // Incrementing this triggers a silent re-fetch in ClosetScreen so new items
  // appear immediately after a successful add without a manual pull-to-refresh.
  const [closetRefreshKey, setClosetRefreshKey] = useState(0);

  useEffect(() => {
    // Restore persisted session from AsyncStorage on first mount.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setInitializing(false);
    });

    // React to sign-in / sign-out events anywhere in the app.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
      },
    );

    return () => subscription.unsubscribe();
  }, []);

  if (initializing) {
    return (
      <SafeAreaProvider>
        <View className="flex-1 items-center justify-center bg-white">
          <ActivityIndicator size="large" color="#4f46e5" />
        </View>
      </SafeAreaProvider>
    );
  }

  if (!session) {
    return (
      <SafeAreaProvider>
        <AuthScreen />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <View className="flex-1 bg-white">
        {/*
         * All screens stay mounted so state isn't lost when switching tabs.
         * display:'none' removes the subtree from layout without unmounting.
         */}
        <View style={{ flex: 1, display: tab === "home" ? "flex" : "none" }}>
          <HomeScreen
            onNavigateToCloset={() => {
              setTab("closet");
              setClosetRefreshKey((k) => k + 1);
            }}
          />
        </View>
        <View style={{ flex: 1, display: tab === "closet" ? "flex" : "none" }}>
          <ClosetScreen refreshKey={closetRefreshKey} />
        </View>
        <View style={{ flex: 1, display: tab === "outfit" ? "flex" : "none" }}>
          <OutfitScreen />
        </View>

        <TabBar active={tab} onPress={setTab} />
      </View>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

// ── TabBar ────────────────────────────────────────────────────────────────────

function TabBar({
  active,
  onPress,
}: {
  active: Tab;
  onPress: (tab: Tab) => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-row border-t border-gray-200 bg-white"
      style={{ paddingBottom: insets.bottom }}
    >
      <TabItem
        label="Add Item"
        glyph="＋"
        active={active === "home"}
        onPress={() => onPress("home")}
      />
      <TabItem
        label="Closet"
        glyph="▤"
        active={active === "closet"}
        onPress={() => onPress("closet")}
      />
      <TabItem
        label="Outfit"
        glyph="✦"
        active={active === "outfit"}
        onPress={() => onPress("outfit")}
      />
    </View>
  );
}

function TabItem({
  label,
  glyph,
  active,
  onPress,
}: {
  label: string;
  glyph: string;
  active: boolean;
  onPress: () => void;
}) {
  const color = active ? "text-indigo-600" : "text-gray-400";

  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-1 items-center justify-center py-3 gap-0.5"
    >
      <Text className={`text-xl ${color}`}>{glyph}</Text>
      <Text className={`text-xs font-medium ${color}`}>{label}</Text>
    </TouchableOpacity>
  );
}
