import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";

// ── Suppress one benign Supabase startup log ────────────────────────────────
// When the client initializes with a stale or missing refresh token in storage,
// GoTrueClient._recoverAndRefresh() calls the refresh endpoint, gets back
// "Invalid Refresh Token: Refresh Token Not Found", and logs it via a hard-coded
// console.error() with no option to disable. The session is then cleared and a
// SIGNED_OUT event fires, which we handle gracefully in App.tsx — so this log is
// pure noise. We filter out only this specific, expected message; every other
// console.error passes through untouched. Installed before createClient() below
// because the log fires during client initialization.
const REFRESH_TOKEN_NOISE =
  /invalid refresh token|refresh token not found|refresh_token_not_found/i;
const originalConsoleError = console.error.bind(console);
console.error = (...args) => {
  const first = args[0];
  const text =
    typeof first === "string"
      ? first
      : first && typeof first === "object" && "message" in first
        ? String(first.message)
        : "";
  if (REFRESH_TOKEN_NOISE.test(text)) return;
  originalConsoleError(...args);
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase env vars. Copy .env.example to .env and fill in " +
      "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Prevents Supabase from trying to read tokens from the URL,
    // which doesn't apply in React Native.
    detectSessionInUrl: false,
  },
});

// Pause token auto-refresh while the app is backgrounded and resume when it
// returns to the foreground. Without this the refresh timer fires while the
// app is suspended, which can produce stale-token errors.
AppState.addEventListener("change", (state) => {
  if (state === "active") {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
