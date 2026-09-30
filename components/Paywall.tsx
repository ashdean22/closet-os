/**
 * The upgrade sheet.
 *
 * Shown when a free account runs out of searches, and reachable from Settings
 * before that happens. It states the limit plainly rather than dressing it up:
 * somebody who has just been refused already knows they were refused, and the
 * useful thing to tell them is the number and how to lift it.
 */

import React from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { PRODUCTS, type Product } from "../lib/products";
import { resetLabel } from "../lib/entitlement";
import {
  PRIVACY_POLICY_URL,
  TERMS_OF_USE_URL,
  openLegalLink,
} from "../lib/legal";
import { colors, fonts, radius, tracking } from "../lib/theme";

export default function Paywall({
  visible,
  /** Localised prices from the store, keyed by product id. Empty before load. */
  prices,
  /** The product currently being bought, if any. */
  purchasing,
  /** Set when the last attempt failed, so the sheet can say what went wrong. */
  error,
  /** Null when opened voluntarily rather than by hitting the limit. */
  resetsAt,
  limit,
  onPurchase,
  onRestore,
  onClose,
}: {
  visible: boolean;
  prices: Record<string, string>;
  purchasing: string | null;
  error: string | null;
  resetsAt: Date | null;
  limit: number;
  onPurchase: (product: Product) => void;
  onRestore: () => void;
  onClose: () => void;
}) {
  const busy = purchasing !== null;

  /**
   * Only offer what the store confirmed it will sell.
   *
   * PRODUCTS is a hardcoded list, so it goes on describing a plan that Apple
   * has pulled, has not approved yet, or does not offer in this user's region.
   * Showing one of those is a button that takes a tap and then apologises,
   * which reads as a broken app rather than an unavailable plan.
   *
   * An empty price map means something different — the store has not answered
   * yet, or could not be reached — and hiding every plan there would turn a
   * slow network into an empty sheet. The full list with fallback prices is
   * the better guess in that case.
   */
  const confirmed = PRODUCTS.filter((product) => prices[product.id]);
  const plans = confirmed.length > 0 ? confirmed : PRODUCTS;

  // The small print has to describe the plans actually on screen. Apple reads
  // this paragraph, and promising auto-renewal terms beside a single one-time
  // unlock is the kind of mismatch that gets a build sent back.
  const hasSubscription = plans.some((product) => product.subscription);
  const hasOneTime = plans.some((product) => !product.subscription);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: colors.ground }}>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
          {/* ── Header ──────────────────────────────────────────────────── */}
          <View className="gap-2 pt-2">
            <Text
              style={{
                fontFamily: fonts.deco,
                fontSize: 12,
                letterSpacing: tracking.deco,
                color: colors.brass,
              }}
            >
              CAPSULE UNLIMITED
            </Text>
            <Text
              style={{
                fontFamily: fonts.deco,
                fontSize: 26,
                lineHeight: 32,
                color: colors.ink,
              }}
            >
              Style as many outfits as you like
            </Text>
            <Text className="text-ink-soft text-base leading-6">
              The free plan builds{" "}
              <Text className="font-semibold">{limit} outfits a day</Text>.{" "}
              {resetsAt ? resetLabel(resetsAt) : "That resets every day."} Upgrade
              and the limit goes away.
            </Text>
          </View>

          {/* ── What you get ────────────────────────────────────────────── */}
          <View
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.edge,
              borderWidth: 1,
              borderRadius: radius.lg,
              padding: 16,
              gap: 10,
            }}
          >
            <Benefit text="Unlimited outfit searches" />
            <Benefit text="Instant refreshes — the next look is ready before you ask" />
            <Benefit text="Swap out anything in the laundry, as often as you need" />
            {/* Said out loud because it is the question people actually have
                when they see a limit on one feature: is the rest limited too? */}
            <Benefit text="Your closet is unlimited on every plan, free included" />
          </View>

          {/* ── Plans ───────────────────────────────────────────────────── */}
          <View className="gap-3">
            {plans.map((product) => (
              <PlanCard
                key={product.id}
                product={product}
                price={prices[product.id] ?? product.fallbackPrice}
                busy={busy}
                loading={purchasing === product.id}
                onPress={() => onPurchase(product)}
              />
            ))}
          </View>

          {error ? (
            <View
              style={{
                backgroundColor: colors.dangerTint,
                borderColor: colors.dangerEdge,
                borderWidth: 1,
                borderRadius: radius.md,
                padding: 12,
              }}
            >
              <Text className="text-danger text-sm leading-5">{error}</Text>
            </View>
          ) : null}

          {/* ── Small print ─────────────────────────────────────────────── */}
          <Text className="text-ink-faint text-xs leading-5">
            {hasSubscription
              ? "Subscriptions renew automatically until cancelled. Manage or cancel in your Apple ID settings at any time; cancelling stops the next charge and keeps your access until the period you have paid for ends. "
              : ""}
            {hasOneTime
              ? "The lifetime unlock is a single payment with nothing to cancel."
              : ""}
          </Text>

          {/* Guideline 3.1.2(c): both links have to be reachable from the
              purchase flow, not only from Settings. */}
          <View className="flex-row justify-center gap-5">
            <TouchableOpacity onPress={() => openLegalLink(TERMS_OF_USE_URL)}>
              <Text className="text-ink-soft text-xs underline">
                Terms of Use (EULA)
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => openLegalLink(PRIVACY_POLICY_URL)}>
              <Text className="text-ink-soft text-xs underline">
                Privacy Policy
              </Text>
            </TouchableOpacity>
          </View>

          <View className="flex-row justify-center gap-6 pb-4">
            <TouchableOpacity onPress={onRestore} disabled={busy}>
              <Text
                className={`text-sm font-semibold ${
                  busy ? "text-ink-faint" : "text-teal"
                }`}
              >
                Restore purchases
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} disabled={busy}>
              <Text
                className={`text-sm font-semibold ${
                  busy ? "text-ink-faint" : "text-ink-soft"
                }`}
              >
                Not now
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Benefit({ text }: { text: string }) {
  return (
    <View className="flex-row items-start gap-2.5">
      <Text style={{ color: colors.brass, fontSize: 14, lineHeight: 20 }}>
        {"✦︎"}
      </Text>
      <Text className="text-ink text-sm leading-5 flex-1">{text}</Text>
    </View>
  );
}

function PlanCard({
  product,
  price,
  busy,
  loading,
  onPress,
}: {
  product: Product;
  price: string;
  busy: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  const featured = product.badge.length > 0;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={`${product.title}, ${price}. ${
        product.duration ? `${product.duration}. ` : ""
      }${product.note}`}
      accessibilityState={{ disabled: busy, busy: loading }}
      style={{
        borderWidth: featured ? 2 : 1,
        borderColor: featured ? colors.rust : colors.edge,
        borderRadius: radius.lg,
        backgroundColor: colors.surface,
        padding: 16,
        opacity: busy && !loading ? 0.5 : 1,
      }}
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-1 gap-1">
          <View className="flex-row items-center gap-2">
            <Text className="text-ink text-base font-semibold">
              {product.title}
            </Text>
            {featured ? (
              <View
                style={{
                  backgroundColor: colors.rust,
                  borderRadius: radius.pill,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                }}
              >
                <Text className="text-ground text-[10px] font-semibold uppercase">
                  {product.badge}
                </Text>
              </View>
            ) : null}
          </View>
          <Text className="text-ink-faint text-xs">
            {product.duration ? `${product.duration} · ` : ""}
            {product.note}
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator size="small" color={colors.rust} />
        ) : (
          <Text className="text-ink text-lg font-semibold">{price}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}
