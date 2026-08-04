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
import SettingsScreen from "./screens/SettingsScreen";

type Tab = "home" | "closet" | "outfit" | "settings";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [tab, setTab] = useState<Tab>("home");
  // Incrementing this triggers a silent re-fetch in ClosetScreen so new items
  // appear immediately after a successful add without a manual pull-to-refresh.
  const [closetRefreshKey, setClosetRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    // Restore persisted session from AsyncStorage on first mount. A stale or
    // missing refresh token surfaces here (or via the SIGNED_OUT event below)
    // as an AuthApiError; we treat it as "no active session", clear the unusable
    // tokens locally, and route to sign-in instead of letting it bubble up.
    (async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (active) setSession(session);
      } catch (err) {
        if (isInvalidRefreshToken(err)) {
          // Drop the unusable stored session locally — no server round-trip,
          // so this can't fail on a dead/expired token.
          await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        } else {
          console.warn("[auth] Could not restore session:", err);
        }
        if (active) setSession(null);
      } finally {
        if (active) setInitializing(false);
      }
    })();

    // React to sign-in / sign-out events anywhere in the app. SIGNED_OUT also
    // fires when a background token refresh fails with an invalid/expired
    // refresh token — we clear local session state the same as a normal logout.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!active) return;
        if (event === "SIGNED_OUT") {
          setSession(null);
          return;
        }
        setSession(session);
      },
    );

    return () => {
      active = false;
      subscription.unsubscribe();
    };
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
        <View style={{ flex: 1, display: tab === "settings" ? "flex" : "none" }}>
          <SettingsScreen email={session.user?.email ?? null} />
        </View>

        <TabBar active={tab} onPress={setTab} />
      </View>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

// ── Auth helpers ────────────────────────────────────────────────────────────

/**
 * True when an error represents a stale/missing refresh token, e.g.
 * "Invalid Refresh Token: Refresh Token Not Found". These are benign — they
 * just mean there's no usable session — so we route to sign-in rather than
 * treat them as real failures.
 */
function isInvalidRefreshToken(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  return (
    e.code === "refresh_token_not_found" ||
    /invalid refresh token|refresh token not found/i.test(e.message ?? "")
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
      <TabItem
        label="Settings"
        glyph="⚙"
        active={active === "settings"}
        onPress={() => onPress("settings")}
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
