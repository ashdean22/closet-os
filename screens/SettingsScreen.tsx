import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
} from "react-native";
import ScreenWrapper from "../components/ScreenWrapper";
import DecoHeader from "../components/DecoHeader";
import { supabase } from "../lib/supabase";
import { colors, fonts, tracking } from "../lib/theme";
import { readFunctionError } from "../lib/functionErrors";
import appJson from "../app.json";

const PRIVACY_POLICY_URL = "https://ashdean22.github.io/closet-os/";
const APP_VERSION = appJson.expo.version;

type Props = {
  email: string | null;
};

export default function SettingsScreen({ email }: Props) {
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ── sign out ───────────────────────────────────────────────────────────────

  const handleSignOut = async () => {
    setSigningOut(true);
    const { error } = await supabase.auth.signOut();
    setSigningOut(false);
    if (error) Alert.alert("Sign out error", error.message);
    // Success: onAuthStateChange in App.tsx routes back to the auth screen.
  };

  // ── delete account ─────────────────────────────────────────────────────────

  const confirmDeleteAccount = () => {
    Alert.alert(
      "Delete your account?",
      "This permanently deletes your account, all closet items, and all photos. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Everything",
          style: "destructive",
          onPress: handleDeleteAccount,
        },
      ],
    );
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      const { error } = await supabase.functions.invoke("delete-account", {
        body: {},
      });

      if (error) {
        const detail = await readFunctionError(error);
        console.error(
          "[delete-account] failed:",
          detail.status ?? "(no status)",
          detail.reason ?? "(no reason)",
          detail.message,
        );
        // Partial failure guidance: data deletion is idempotent server-side,
        // so retrying is always safe.
        Alert.alert(
          "Couldn't delete your account",
          detail.reason === "network"
            ? "Can't reach the server. Check your connection and try again."
            : "Something went wrong deleting your account. Please try again — if it keeps failing, contact support and we'll remove it manually.",
        );
        return;
      }

      // Server has deleted the auth user; the local session is now orphaned.
      // scope: "local" clears stored tokens without a doomed server round-trip.
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      Alert.alert("Account deleted", "Your account and all data have been removed.");
    } finally {
      setDeleting(false);
    }
  };

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <ScreenWrapper>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 20, gap: 24 }}
      >
        <DecoHeader title="Settings" />

        {/* ── Account ──────────────────────────────────────────────────────── */}
        <View className="gap-2">
          <Text className="text-xs font-semibold text-ink-faint uppercase tracking-wide">
            Account
          </Text>
          <View className="bg-surface border border-edge rounded overflow-hidden">
            <View className="px-4 py-3.5 border-b border-edge">
              <Text className="text-xs text-ink-faint mb-0.5">Signed in as</Text>
              <Text className="text-ink text-sm font-medium">
                {email ?? "Unknown"}
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleSignOut}
              disabled={signingOut || deleting}
              className="px-4 py-3.5 flex-row items-center gap-2"
            >
              {signingOut && <ActivityIndicator size="small" color={colors.rust} />}
              <Text className="text-rust text-sm font-semibold">Log Out</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── About ────────────────────────────────────────────────────────── */}
        <View className="gap-2">
          <Text className="text-xs font-semibold text-ink-faint uppercase tracking-wide">
            About
          </Text>
          <View className="bg-surface border border-edge rounded overflow-hidden">
            <TouchableOpacity
              onPress={() =>
                Linking.openURL(PRIVACY_POLICY_URL).catch(() =>
                  Alert.alert("Couldn't open link", PRIVACY_POLICY_URL),
                )
              }
              className="px-4 py-3.5 border-b border-edge"
            >
              <Text className="text-ink text-sm font-medium">Privacy Policy</Text>
            </TouchableOpacity>
            <View className="px-4 py-3.5 flex-row justify-between items-center">
              <Text className="text-ink text-sm font-medium">Version</Text>
              <Text className="text-ink-faint text-sm">{APP_VERSION}</Text>
            </View>
          </View>
        </View>

        {/* ── Danger zone ──────────────────────────────────────────────────── */}
        <View className="gap-2">
          <Text className="text-xs font-semibold text-ink-faint uppercase tracking-wide">
            Danger zone
          </Text>
          <TouchableOpacity
            onPress={confirmDeleteAccount}
            disabled={deleting || signingOut}
            className="border border-danger-edge bg-danger-tint rounded px-4 py-3.5 flex-row items-center gap-2"
          >
            {deleting && <ActivityIndicator size="small" color={colors.danger} />}
            <View className="flex-1">
              <Text className="text-danger text-sm font-semibold">
                {deleting ? "Deleting account…" : "Delete Account"}
              </Text>
              <Text className="text-danger text-xs mt-0.5">
                Permanently removes your account, items, and photos
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}
