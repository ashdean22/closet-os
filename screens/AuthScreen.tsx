import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";

type Mode = "signin" | "signup";

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
        setError("Incorrect email or password.");
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
      <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
        <Text className="text-4xl mb-4">📬</Text>
        <Text className="text-xl font-bold text-gray-800 text-center mb-2">
          Check your inbox
        </Text>
        <Text className="text-gray-500 text-sm text-center mb-8 leading-5">
          We sent a confirmation link to{" "}
          <Text className="font-semibold text-gray-700">{email.trim()}</Text>.
          {"\n"}Click it, then come back and sign in.
        </Text>
        <TouchableOpacity
          onPress={() => {
            setAwaitingConfirmation(false);
            setMode("signin");
          }}
          className="bg-indigo-600 px-8 py-3 rounded-xl"
        >
          <Text className="text-white font-semibold">Go to Sign In</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Main form ──────────────────────────────────────────────────────────────
  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 28 }}
        >
          {/* Brand */}
          <View className="items-center mb-10">
            <Text className="text-4xl font-bold text-indigo-600">closet‑os</Text>
            <Text className="text-gray-400 text-sm mt-1">
              Your AI-powered wardrobe
            </Text>
          </View>

          {/* Mode toggle */}
          <View className="flex-row bg-gray-100 rounded-xl p-1 mb-6">
            {(["signin", "signup"] as Mode[]).map((m) => (
              <TouchableOpacity
                key={m}
                onPress={() => switchMode(m)}
                className={`flex-1 py-2 rounded-lg items-center ${
                  mode === m ? "bg-white" : ""
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    mode === m ? "text-gray-800" : "text-gray-400"
                  }`}
                >
                  {m === "signin" ? "Sign In" : "Sign Up"}
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
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              returnKeyType="next"
              editable={!loading}
              style={{
                borderWidth: 1,
                borderColor: "#e5e7eb",
                borderRadius: 12,
                paddingHorizontal: 16,
                paddingVertical: 14,
                fontSize: 16,
                color: "#1f2937",
                backgroundColor: "#f9fafb",
              }}
            />
            <TextInput
              value={password}
              onChangeText={(t) => { setPassword(t); setError(null); }}
              placeholder="Password"
              placeholderTextColor="#9ca3af"
              secureTextEntry
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
              editable={!loading}
              style={{
                borderWidth: 1,
                borderColor: "#e5e7eb",
                borderRadius: 12,
                paddingHorizontal: 16,
                paddingVertical: 14,
                fontSize: 16,
                color: "#1f2937",
                backgroundColor: "#f9fafb",
              }}
            />
          </View>

          {/* Error — always visible, not behind a scroll */}
          {error ? (
            <View
              style={{
                backgroundColor: "#fef2f2",
                borderWidth: 1,
                borderColor: "#fecaca",
                borderRadius: 12,
                paddingHorizontal: 16,
                paddingVertical: 12,
                marginBottom: 16,
              }}
            >
              <Text style={{ color: "#dc2626", fontSize: 14 }}>{error}</Text>
            </View>
          ) : null}

          {/* Submit — plain style props to avoid any NativeWind touch-event conflict */}
          <TouchableOpacity
            onPress={handleSubmit}
            activeOpacity={0.8}
            disabled={loading}
            style={{
              backgroundColor: loading ? "#a5b4fc" : "#4f46e5",
              borderRadius: 12,
              paddingVertical: 16,
              alignItems: "center",
              flexDirection: "row",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {loading ? <ActivityIndicator size="small" color="white" /> : null}
            <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>
              {mode === "signin" ? "Sign In" : "Create Account"}
            </Text>
          </TouchableOpacity>

          <Text className="text-gray-400 text-xs text-center mt-6">
            {mode === "signin"
              ? "No account? Tap Sign Up above."
              : "Already have an account? Tap Sign In above."}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
