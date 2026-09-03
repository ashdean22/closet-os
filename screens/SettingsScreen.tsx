import React, { useCallback, useEffect, useState } from "react";
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
import { invokeFunction } from "../lib/invokeFunction";
import { colors, fonts, tracking } from "../lib/theme";
import { readFunctionError } from "../lib/functionErrors";
import appJson from "../app.json";
import Paywall from "../components/Paywall";
import {
  FREE_STATUS,
  fetchOutfitStatus,
  planLabel,
  resetLabel,
  type OutfitStatus,
} from "../lib/entitlement";
import { usePurchases } from "../lib/usePurchases";
import { PURCHASES_AVAILABLE } from "../lib/products";

/**
 * Where Apple looks for the subscription disclosures.
 *
 * App Review requires a paid app to show, from inside the app, what the
 * subscription is and how to manage or cancel it, and to offer a way to
 * restore a purchase on a new device. All three live in the Plan section
 * below, which is why it sits above About rather than buried under it.
 */
const MANAGE_SUBSCRIPTION_URL = "https://apps.apple.com/account/subscriptions";

const PRIVACY_POLICY_URL = "https://ashdean22.github.io/closet-os/";
const APP_VERSION = appJson.expo.version;

type Props = {
  email: string | null;
};

export default function SettingsScreen({ email }: Props) {
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState<OutfitStatus>(FREE_STATUS);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await fetchOutfitStatus());
    } catch (err) {
      console.warn("[settings] status:", err);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const { prices, purchasing, purchaseError, buy, restore } = usePurchases({
    onEntitled: () => {
      void refreshStatus();
      setPaywallOpen(false);
    },
  });

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
      const { error } = await invokeFunction("delete-account", {
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

        {/* ── Plan ─────────────────────────────────────────────────────────── */}
        {/* Hidden entirely in a build that cannot sell anything — a plan
            section offering an upgrade that silently fails is worse than no
            plan section at all. */}
        {PURCHASES_AVAILABLE && (
        <View className="gap-2">
          <Text className="text-xs font-semibold text-ink-faint uppercase tracking-wide">
            Plan
          </Text>
          <View className="bg-surface border border-edge rounded overflow-hidden">
            <View className="px-4 py-3.5 border-b border-edge">
              <Text className="text-xs text-ink-faint mb-0.5">Current plan</Text>
              <Text className="text-ink text-sm font-medium">
                {planLabel(status.plan)}
              </Text>
              <Text className="text-ink-faint text-xs mt-1">
                {status.unlimited
                  ? "Unlimited outfit searches."
                  : `${status.left} of ${status.limit} outfit searches left today. ${resetLabel(status.resetsAt)}`}
              </Text>
            </View>

            {!status.unlimited && (
              <TouchableOpacity
                onPress={() => setPaywallOpen(true)}
                className="px-4 py-3.5 border-b border-edge"
              >
                <Text className="text-rust text-sm font-semibold">
                  Get unlimited searches
                </Text>
              </TouchableOpacity>
            )}

            {/* Apple requires a manage/cancel route from inside the app. This
                deep link opens the Subscriptions page of the user's Apple ID,
                which is the only place a subscription can actually be
                cancelled — Capsule cannot do it on their behalf. */}
            {(status.plan === "monthly" || status.plan === "yearly") && (
              <TouchableOpacity
                onPress={() =>
                  Linking.openURL(MANAGE_SUBSCRIPTION_URL).catch(() =>
                    Alert.alert("Couldn't open link", MANAGE_SUBSCRIPTION_URL),
                  )
                }
                className="px-4 py-3.5 border-b border-edge"
              >
                <Text className="text-ink text-sm font-medium">
                  Manage or cancel subscription
                </Text>
              </TouchableOpacity>
            )}

            {/* Also required: somebody reinstalling on a new phone needs a way
                to get back what they already paid for. */}
            <TouchableOpacity
              onPress={restore}
              disabled={purchasing !== null}
              className="px-4 py-3.5 flex-row items-center gap-2"
            >
              {purchasing === "restore" && (
                <ActivityIndicator size="small" color={colors.teal} />
              )}
              <Text
                className={`text-sm font-medium ${
                  purchasing !== null ? "text-ink-faint" : "text-ink"
                }`}
              >
                Restore purchases
              </Text>
            </TouchableOpacity>
          </View>

          {purchaseError ? (
            <Text className="text-danger text-xs leading-5 px-1">
              {purchaseError}
            </Text>
          ) : null}
        </View>
        )}

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

      <Paywall
        visible={paywallOpen}
        prices={prices}
        purchasing={purchasing}
        error={purchaseError}
        resetsAt={status.resetsAt}
        limit={status.limit}
        onPurchase={buy}
        onRestore={restore}
        onClose={() => setPaywallOpen(false)}
      />
    </ScreenWrapper>
  );
}
