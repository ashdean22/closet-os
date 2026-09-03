/**
 * Buying Capsule Unlimited.
 *
 * The shape of the thing: the phone talks to StoreKit through RevenueCat, and
 * then Postgres is asked what the user is now entitled to. The purchase result
 * on the device is NEVER what unlocks the feature — find-outfit reads the
 * entitlements table and nothing else, so a phone that has been told it owns a
 * subscription still has to have that fact written down server-side before it
 * means anything.
 *
 * That leaves a race: StoreKit finishes, and RevenueCat's webhook may take a
 * second or two to reach us. Rather than poll or make the user wait on a
 * stranger's queue, the app asks its own backend to go and read the truth from
 * RevenueCat's API right now (sync-entitlement). The webhook then handles
 * everything that happens when the app ISN'T running: renewals, cancellations,
 * expiry, refunds.
 *
 * Native StoreKit does not exist in Expo Go. The hook reports that plainly
 * instead of crashing, so the rest of the app stays testable there.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { PRODUCTS, type Product } from "./products";
import { supabase } from "./supabase";
import { invokeFunction } from "./invokeFunction";

/** Set in app config; absent in a build that has not been given a key yet. */
const API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? "";

const NO_NATIVE_MODULE =
  "In-app purchases need the App Store build of Capsule — they can't run in Expo Go.";
const NOT_CONFIGURED =
  "Purchases aren't switched on in this build yet.";

type PurchasesModule = typeof import("react-native-purchases").default;

/**
 * getProducts defaults to SUBSCRIPTION and returns nothing else.
 *
 * That default is quietly wrong for us: the $49.99 lifetime unlock is a
 * non-consumable, so a single default call returns the two subscriptions and
 * silently omits the third plan — which would show a fallback price and then
 * fail to buy. Both categories are fetched, always.
 *
 * Passed as string literals rather than the PRODUCT_CATEGORY enum because the
 * module is loaded lazily (see loadPurchases) and importing the enum
 * statically would pull the native binding back in at module load.
 */
const SUBSCRIPTION = "SUBSCRIPTION" as never;
const NON_SUBSCRIPTION = "NON_SUBSCRIPTION" as never;

const SUBSCRIPTION_IDS = PRODUCTS.filter((p) => p.subscription).map((p) => p.id);
const ONE_TIME_IDS = PRODUCTS.filter((p) => !p.subscription).map((p) => p.id);

/** Every plan's store record, both categories, in one list. */
async function fetchAllProducts(Purchases: PurchasesModule) {
  const [subs, oneOff] = await Promise.all([
    SUBSCRIPTION_IDS.length
      ? Purchases.getProducts(SUBSCRIPTION_IDS, SUBSCRIPTION)
      : Promise.resolve([]),
    ONE_TIME_IDS.length
      ? Purchases.getProducts(ONE_TIME_IDS, NON_SUBSCRIPTION)
      : Promise.resolve([]),
  ]);
  return [...subs, ...oneOff];
}

/**
 * Loaded lazily and defensively.
 *
 * A static import would run RevenueCat's native binding at module load, which
 * throws in Expo Go and would take the whole screen down with it — including
 * the outfit features that have nothing to do with buying anything.
 */
function loadPurchases(): PurchasesModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("react-native-purchases").default as PurchasesModule;
  } catch {
    return null;
  }
}

export function usePurchases({ onEntitled }: { onEntitled: () => void }) {
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  const sdk = useRef<PurchasesModule | null>(null);
  const ready = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * Configures the SDK against the signed-in user.
   *
   * The RevenueCat app user id IS the Supabase user id. That single decision
   * is what lets the webhook find the right row later without any mapping
   * table, and what makes a restore on a new phone land on the same account.
   */
  const ensureReady = useCallback(async (): Promise<PurchasesModule | null> => {
    if (ready.current) return sdk.current;
    if (Platform.OS !== "ios") return null;

    const Purchases = sdk.current ?? loadPurchases();
    if (!Purchases) return null;
    sdk.current = Purchases;

    if (!API_KEY) return null;

    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid) return null;

    await Purchases.configure({ apiKey: API_KEY, appUserID: uid });
    ready.current = true;
    return Purchases;
  }, []);

  /** Pulls localised prices so the sheet shows what the store will charge. */
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const Purchases = await ensureReady();
        if (!Purchases || !active) return;
        const products = await fetchAllProducts(Purchases);
        if (!active || !mounted.current) return;
        setPrices(
          Object.fromEntries(
            products.map((p) => [p.identifier, p.priceString]),
          ),
        );
      } catch (err) {
        // Prices falling back to the hardcoded ones is a cosmetic problem, and
        // an alarming red box on a screen nobody asked to see would be worse.
        console.warn("[purchases] price load:", err);
      }
    })();
    return () => {
      active = false;
    };
  }, [ensureReady]);

  /**
   * Asks our own backend to read the current entitlement from RevenueCat and
   * write it down. This is what actually lifts the limit.
   */
  const syncEntitlement = useCallback(async () => {
    const { error } = await invokeFunction("sync-entitlement", { body: {} });
    if (error) throw new Error("Purchase went through, but activating it failed.");
  }, []);

  const buy = useCallback(
    async (product: Product) => {
      setPurchaseError(null);
      setPurchasing(product.id);
      try {
        const Purchases = await ensureReady();
        if (!Purchases) throw new Error(loadPurchases() ? NOT_CONFIGURED : NO_NATIVE_MODULE);

        const [storeProduct] = await Purchases.getProducts(
          [product.id],
          product.subscription ? SUBSCRIPTION : NON_SUBSCRIPTION,
        );
        if (!storeProduct) {
          throw new Error(
            "That plan isn't available from the App Store right now.",
          );
        }

        await Purchases.purchaseStoreProduct(storeProduct);
        await syncEntitlement();
        if (mounted.current) onEntitled();
      } catch (err) {
        if (!mounted.current) return;
        // A cancelled purchase is a decision, not a failure, and telling
        // somebody their deliberate "no" went wrong is just noise.
        if (isUserCancelled(err)) return;
        setPurchaseError(readableError(err));
      } finally {
        if (mounted.current) setPurchasing(null);
      }
    },
    [ensureReady, onEntitled, syncEntitlement],
  );

  const restore = useCallback(async () => {
    setPurchaseError(null);
    setPurchasing("restore");
    try {
      const Purchases = await ensureReady();
      if (!Purchases) throw new Error(loadPurchases() ? NOT_CONFIGURED : NO_NATIVE_MODULE);

      await Purchases.restorePurchases();
      await syncEntitlement();
      if (mounted.current) onEntitled();
    } catch (err) {
      if (!mounted.current) return;
      if (isUserCancelled(err)) return;
      setPurchaseError(readableError(err));
    } finally {
      if (mounted.current) setPurchasing(null);
    }
  }, [ensureReady, onEntitled, syncEntitlement]);

  return { prices, purchasing, purchaseError, buy, restore };
}

function isUserCancelled(err: unknown): boolean {
  const e = err as { userCancelled?: boolean; code?: string | number } | null;
  return e?.userCancelled === true || e?.code === "1";
}

function readableError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/network|connection|offline/i.test(raw)) {
    return "Couldn't reach the App Store. Check your connection and try again.";
  }
  return raw || "The purchase didn't go through. Nothing has been charged.";
}
