/**
 * The two links App Review checks for.
 *
 * Guideline 3.1.2(c) requires an app selling auto-renewing subscriptions to
 * show functional links to both the privacy policy and the Terms of Use from
 * inside the purchase flow — not only in Settings, and not only in the App
 * Store listing. They live here so the paywall and Settings can never drift
 * apart on a URL, and so the App Store Connect metadata has one place to be
 * copied from.
 */

import { Alert, Linking } from "react-native";

export const PRIVACY_POLICY_URL = "https://ashdean22.github.io/closet-os/";

/**
 * Apple's standard EULA, which is what governs Capsule's subscriptions: no
 * custom terms have been written, and linking the standard document is the
 * option Apple explicitly offers for that case. If a custom EULA is ever
 * added, this URL and the App Store Connect EULA field both have to change.
 */
export const TERMS_OF_USE_URL =
  "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";

/** Opens a legal link, and says so plainly if the device refuses. */
export function openLegalLink(url: string) {
  Linking.openURL(url).catch(() => Alert.alert("Couldn't open link", url));
}
