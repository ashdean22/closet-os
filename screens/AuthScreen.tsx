import React, { useState } from "react";
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { colors, fonts, tracking } from "../lib/theme";

type Mode = "signin" | "signup";

/** Shared field styling — the inputs stay on the system face for legibility. */
const inputStyle = {
  borderWidth: 1,
  borderColor: colors.edge,
  borderRadius: 4,
  paddingHorizontal: 16,
  paddingVertical: 14,
  fontSize: 16,
  color: colors.ink,
  backgroundColor: colors.surface,
} as const;

export default function AuthScreen() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown when sign-up succeeds but email confirmation is still required.
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setAwaitingConfirmation(false);
  };

  const handleSubmit = async () => {
    // Diagnostic: confirm the handler fires and which branch we're in.
    console.log("[AuthScreen] handleSubmit fired, mode:", mode);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Please enter your email and password.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    setError(null);
    setAwaitingConfirmation(false);

    try {
      if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });

        console.log("[AuthScreen] signUp result — session:", !!data.session, "user:", !!data.user, "error:", signUpError?.message);

        if (signUpError) throw signUpError;

        if (data.session) {
          // Email confirmation is disabled — session is live immediately.
          // onAuthStateChange in App.tsx detects it and unmounts this screen.
          console.log("[AuthScreen] session created, App.tsx will navigate");
        } else if (data.user) {
          // Email confirmation is ENABLED on this Supabase project.
          // signUp succeeded but the session won't exist until the user
          // clicks the confirmation link in their inbox.
          setAwaitingConfirmation(true);
        } else {
          // Unexpected: no user and no error.
          setError("Sign up failed — please try again.");
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });

        console.log("[AuthScreen] signInWithPassword error:", signInError?.message ?? "none");

        if (signInError) throw signInError;
        // Success: onAuthStateChange in App.tsx fires and unmounts this screen.
      }
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      console.log("[AuthScreen] caught error:", raw);

      // Map Supabase's terse messages to user-friendly strings.
      if (raw.includes("Invalid login credentials")) {
        // Supabase intentionally returns the same error for a wrong password
        // and a nonexistent account (no email enumeration), so the hint has to
        // cover both without confirming whether the email is registered.
        setError(
          "We couldn't sign you in. Check your password — or if you're new here, tap Sign Up above to create an account.",
        );
      } else if (raw.includes("User already registered")) {
        setError("An account with this email already exists — try signing in.");
      } else if (raw.includes("Password should be at least")) {
        setError("Password must be at least 6 characters.");
      } else if (raw.includes("Unable to validate email address")) {
        setError("Please enter a valid email address.");
      } else {
        // Show raw message so nothing fails silently.
        setError(raw);
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Email confirmation pending ──────────────────────────────────────────────
  if (awaitingConfirmation) {
    return (
      <SafeAreaView
        className="flex-1 items-center justify-center px-8"
        style={{ backgroundColor: colors.tealDeep }}
      >
        <Text className="text-4xl mb-5">📬</Text>
        <Text
          style={{
            fontFamily: fonts.deco,
            fontSize: 22,
            letterSpacing: tracking.deco,
            color: colors.ground,
            textAlign: "center",
            marginBottom: 10,
          }}
        >
          Check Your Inbox
        </Text>
        <Text
          style={{ color: colors.sky, fontSize: 14, textAlign: "center", lineHeight: 21 }}
          className="mb-8"
        >
          We sent a confirmation link to{" "}
          <Text style={{ color: colors.brass, fontWeight: "600" }}>{email.trim()}</Text>.
          {"\n"}Click it, then come back and sign in.
        </Text>
        <TouchableOpacity
          onPress={() => {
            setAwaitingConfirmation(false);
            setMode("signin");
          }}
          activeOpacity={0.85}
          style={{
            backgroundColor: colors.rust,
            borderRadius: 4,
            paddingHorizontal: 32,
            paddingVertical: 14,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.deco,
              fontSize: 13,
              letterSpacing: tracking.decoWide,
              color: colors.ground,
            }}
          >
            GO TO SIGN IN
          </Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Main form ──────────────────────────────────────────────────────────────
  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.tealDeep }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 28 }}
        >
          {/* Brand */}
          <View className="items-center mb-9">
            <LogoMark />
            <Text
              style={{
                fontFamily: fonts.display,
                fontSize: 42,
                lineHeight: 48,
                color: colors.ground,
                textAlign: "center",
              }}
            >
              Capsule
            </Text>
            {/* Deco rule: brass line, diamond, brass line. */}
            <View className="flex-row items-center mt-1 mb-2" style={{ gap: 8 }}>
              <View style={{ height: 1, width: 44, backgroundColor: colors.brass }} />
              <View
                style={{
                  width: 6,
                  height: 6,
                  backgroundColor: colors.brass,
                  transform: [{ rotate: "45deg" }],
                }}
              />
              <View style={{ height: 1, width: 44, backgroundColor: colors.brass }} />
            </View>
            <Text
              style={{
                fontFamily: fonts.deco,
                fontSize: 11,
                letterSpacing: tracking.decoWide,
                color: colors.sky,
              }}
            >
              YOUR AI-POWERED WARDROBE
            </Text>
          </View>

          {/* Mode toggle */}
          <View
            className="flex-row p-1 mb-6"
            style={{ backgroundColor: colors.tealDeep, borderRadius: 4, borderWidth: 1, borderColor: colors.teal }}
          >
            {(["signin", "signup"] as Mode[]).map((m) => (
              <TouchableOpacity
                key={m}
                onPress={() => switchMode(m)}
                className="flex-1 py-2.5 items-center"
                style={{
                  borderRadius: 2,
                  backgroundColor: mode === m ? colors.ground : "transparent",
                }}
              >
                <Text
                  style={{
                    fontFamily: fonts.deco,
                    fontSize: 12,
                    letterSpacing: tracking.deco,
                    color: mode === m ? colors.ink : colors.sky,
                  }}
                >
                  {m === "signin" ? "SIGN IN" : "SIGN UP"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Inputs */}
          <View className="gap-3 mb-5">
            <TextInput
              value={email}
              onChangeText={(t) => { setEmail(t); setError(null); }}
              placeholder="Email"
              placeholderTextColor={colors.inkFaint}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              returnKeyType="next"
              editable={!loading}
              style={inputStyle}
            />
            <TextInput
              value={password}
              onChangeText={(t) => { setPassword(t); setError(null); }}
              placeholder="Password"
              placeholderTextColor={colors.inkFaint}
              secureTextEntry
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
              editable={!loading}
              style={inputStyle}
            />
          </View>

          {/* Error — always visible, not behind a scroll */}
          {error ? (
            <View
              style={{
                backgroundColor: colors.dangerTint,
                borderWidth: 1,
                borderColor: colors.dangerEdge,
                borderRadius: 4,
                paddingHorizontal: 16,
                paddingVertical: 12,
                marginBottom: 16,
              }}
            >
              <Text style={{ color: colors.danger, fontSize: 14 }}>{error}</Text>
            </View>
          ) : null}

          {/* Submit — plain style props to avoid any NativeWind touch-event conflict */}
          <TouchableOpacity
            onPress={handleSubmit}
            activeOpacity={0.8}
            disabled={loading}
            style={{
              backgroundColor: loading ? colors.rustMuted : colors.rust,
              borderRadius: 4,
              paddingVertical: 16,
              alignItems: "center",
              flexDirection: "row",
              justifyContent: "center",
              gap: 10,
            }}
          >
            {loading ? <ActivityIndicator size="small" color={colors.ground} /> : null}
            <Text
              style={{
                fontFamily: fonts.deco,
                fontSize: 14,
                letterSpacing: tracking.decoWide,
                color: colors.ground,
              }}
            >
              {mode === "signin" ? "SIGN IN" : "CREATE ACCOUNT"}
            </Text>
          </TouchableOpacity>

          <Text
            style={{ color: colors.sky, fontSize: 12, textAlign: "center", marginTop: 24 }}
          >
            {mode === "signin"
              ? "No account? Tap Sign Up above."
              : "Already have an account? Tap Sign In above."}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Ellipse the rays sit on — sized to clear the mark on every side. */
const RAY_RING = { rx: 54, ry: 68 };
const RAY_COUNT = 16;

/**
 * Atomic-age starburst ringing the mark. Each ray is placed on an ellipse
 * rather than a circle so it keeps an even distance from the pill, which is
 * much taller than it is wide; a circular ring would crowd the top and bottom
 * while leaving gaps at the sides. Rays alternate long/short the way period
 * sunburst motifs do. Plain Views, so no SVG dependency and nothing to rebuild.
 */
function Sunburst() {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        ...StyleSheet.absoluteFillObject,
        alignItems: "center",
        justifyContent: "center",
        opacity: 0.45,
      }}
    >
      {Array.from({ length: RAY_COUNT }, (_, i) => {
        const deg = (360 / RAY_COUNT) * i;
        const rad = (deg * Math.PI) / 180;
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              width: 1,
              height: i % 2 === 0 ? 16 : 8,
              backgroundColor: colors.brass,
              transform: [
                // 0° points up, so x tracks sin and y tracks -cos.
                { translateX: RAY_RING.rx * Math.sin(rad) },
                { translateY: -RAY_RING.ry * Math.cos(rad) },
                { rotate: `${deg}deg` },
              ],
            }}
          />
        );
      })}
    </View>
  );
}

/**
 * The Capsule mark — hanger and star inside a pill — cropped from the app
 * icon's Android foreground layer, the only icon asset that ships the artwork
 * on transparency. Tinted to the wordmark's cream so the two read as one
 * lockup rather than an app icon pasted above a title.
 */
function LogoMark() {
  return (
    <View
      style={{
        width: 150,
        height: 174,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Sunburst />
      <Image
        source={require("../assets/logo-mark.png")}
        style={{ width: 62, height: 92, tintColor: colors.ground }}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="Capsule"
      />
    </View>
  );
}
