/**
 * First-run state.
 *
 * Deliberately AsyncStorage rather than a column on the user: it needs no
 * migration, ships over EAS Update, and works before the first network round
 * trip — the welcome card should never wait on a request. The trade-off is
 * that a reinstall replays the intro, which is the harmless direction to err.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEYS = {
  welcome: "capsule.onboarding.welcome.v1",
  outfitCoach: "capsule.onboarding.outfitCoach.v1",
} as const;

export type OnboardingFlag = keyof typeof KEYS;

/**
 * Reads a flag. Treats a storage failure as "already seen" so a broken
 * AsyncStorage can never trap someone behind an intro they can't dismiss.
 */
export async function hasSeen(flag: OnboardingFlag): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEYS[flag])) !== null;
  } catch {
    return true;
  }
}

export async function markSeen(flag: OnboardingFlag): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS[flag], String(Date.now()));
  } catch {
    // Non-fatal: worst case the hint shows again next launch.
  }
}

/**
 * How many pieces the stylist wants before it can build a full outfit.
 *
 * Not arbitrary: find-outfit needs candidates for top, bottom and shoes at
 * minimum, and enough spare in each slot to offer genuinely different looks.
 * Below roughly this many items it can only return one obvious answer, which
 * reads as the app being broken rather than the closet being thin.
 */
export const STARTER_GOAL = 8;
