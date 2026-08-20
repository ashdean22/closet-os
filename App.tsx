import "./global.css";
import { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  BackHandler,
  Platform,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { colors, fonts, tracking } from "./lib/theme";
import AuthScreen from "./screens/AuthScreen";
import HomeScreen from "./screens/HomeScreen";
import ClosetScreen from "./screens/ClosetScreen";
import OutfitScreen from "./screens/OutfitScreen";
import SettingsScreen from "./screens/SettingsScreen";
import WelcomeSheet from "./components/WelcomeSheet";
import { hasSeen, markSeen } from "./lib/onboarding";

type Tab = "home" | "closet" | "outfit" | "settings";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [tab, setTab] = useState<Tab>("home");
  // Incrementing this triggers a silent re-fetch in ClosetScreen so new items
  // appear immediately after a successful add without a manual pull-to-refresh.
  const [closetRefreshKey, setClosetRefreshKey] = useState(0);
  // null until the flag has been read, so the app never flashes on screen
  // before the welcome card appears over it.
  const [needsWelcome, setNeedsWelcome] = useState<boolean | null>(null);

  // Loaded at runtime rather than embedded via the expo-font config plugin so
  // type changes ship over EAS Update. The native module is already in the
  // binary (expo depends on it), so no rebuild is needed.
  const [fontsLoaded, fontError] = useFonts({
    [fonts.display]: require("./assets/fonts/FascinateInline-Regular.ttf"),
    [fonts.deco]: require("./assets/fonts/Limelight-Regular.ttf"),
  });

  useEffect(() => {
    let active = true;

    // Restore persisted session from AsyncStorage on first mount. A stale or
    // missing refresh token surfaces here (or via the SIGNED_OUT event below)
    // as an AuthApiError; we treat it as "no active session", clear the unusable
    // tokens locally, and route to sign-in instead of letting it bubble up.
    (async () => {
      try {
        const [{ data: { session }, error }, seen] = await Promise.all([
          supabase.auth.getSession(),
          hasSeen("welcome"),
        ]);
        if (active) setNeedsWelcome(!seen);
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
        if (active) {
          setSession(null);
          // Fail open — never hold someone on a spinner over a hint.
          setNeedsWelcome((prev) => prev ?? false);
        }
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

  // ── Android hardware/gesture back ──────────────────────────────────────────
  // Without this, back exits the app from any tab — the single most common
  // Android complaint about tab apps ported from iOS. Back now walks to the
  // Add Item tab first; pressing it again there falls through to the system
  // default and leaves the app, which is what Android users expect from a
  // root screen. Modals are unaffected: RN's <Modal> intercepts back itself
  // and every one of ours sets onRequestClose.
  useEffect(() => {
    if (Platform.OS !== "android" || !session) return;

    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (tab !== "home") {
        setTab("home");
        return true; // consumed
      }
      return false; // let Android close the app
    });

    return () => sub.remove();
  }, [tab, session]);

  // Render on a font error too — falling back to the system face is far better
  // than holding the app on a spinner forever.
  const fontsReady = fontsLoaded || !!fontError;

  if (initializing || !fontsReady || needsWelcome === null) {
    return (
      <SafeAreaProvider>
        <View className="flex-1 items-center justify-center bg-ground">
          <ActivityIndicator size="large" color={colors.rust} />
        </View>
      </SafeAreaProvider>
    );
  }

  if (!session) {
    return (
      <SafeAreaProvider>
        <AuthScreen />
        {/* Auth sits on the deep teal ground, so the status bar inverts here. */}
        <StatusBar style="light" />
      </SafeAreaProvider>
    );
  }

  if (needsWelcome) {
    return (
      <SafeAreaProvider>
        <WelcomeSheet
          onStart={() => {
            markSeen("welcome");
            setNeedsWelcome(false);
            setTab("home");
          }}
        />
        <StatusBar style="light" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <View className="flex-1 bg-ground">
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
      <StatusBar style="dark" />
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
    <View style={{ backgroundColor: colors.surface, paddingBottom: insets.bottom }}>
      {/* Doubled rule — the Deco signature: a hairline, a gap, then the edge. */}
      <View style={{ height: 2, backgroundColor: colors.brass }} />
      <View style={{ height: 3, backgroundColor: colors.surface }} />
      <View style={{ height: 1, backgroundColor: colors.edge }} />

      <View className="flex-row">
      <TabItem
        label="Add Item"
        glyph={"\uFF0B\uFE0E"}
        active={active === "home"}
        onPress={() => onPress("home")}
      />
      <TabItem
        label="Closet"
        glyph={"\u25A4\uFE0E"}
        active={active === "closet"}
        onPress={() => onPress("closet")}
      />
      <TabItem
        label="Outfit"
        glyph={"\u2726\uFE0E"}
        active={active === "outfit"}
        onPress={() => onPress("outfit")}
      />
      <TabItem
        label="Settings"
        glyph={"\u2699\uFE0E"}
        active={active === "settings"}
        onPress={() => onPress("settings")}
      />
      </View>
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
  const tint = active ? colors.rust : colors.inkFaint;

  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-1 items-center justify-center pt-2 pb-3"
    >
      {/* Brass cap over the active tab; a transparent twin keeps rows aligned. */}
      <View
        style={{
          height: 2,
          width: 22,
          marginBottom: 6,
          backgroundColor: active ? colors.brass : "transparent",
        }}
      />
      <Text style={{ fontSize: 20, lineHeight: 24, color: tint }}>{glyph}</Text>
      <Text
        style={{
          fontFamily: fonts.deco,
          fontSize: 9,
          letterSpacing: tracking.deco,
          marginTop: 3,
          color: tint,
        }}
      >
        {label.toUpperCase()}
      </Text>
    </TouchableOpacity>
  );
}
