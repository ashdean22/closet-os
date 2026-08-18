import React from "react";
import { View, Text, TouchableOpacity } from "react-native";

type Props = {
  children: React.ReactNode;
  /** Optional label shown in the fallback, e.g. "Outfit". */
  label?: string;
};

type State = {
  hasError: boolean;
  message: string | null;
};

/**
 * Catches render-time errors in its subtree and shows a friendly fallback
 * instead of letting React unmount the whole tree (which presents as a blank
 * white screen). "Try again" resets the boundary so the user can retry without
 * killing the app.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown, info: unknown) {
    // Surface to the Metro console for debugging; replace with a real
    // reporter (Sentry, etc.) if/when one is wired up.
    console.error("[ErrorBoundary]", this.props.label ?? "", error, info);
  }

  reset = () => this.setState({ hasError: false, message: null });

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View className="flex-1 items-center justify-center bg-ground px-8 gap-4">
        <Text className="text-4xl">⚠️</Text>
        <Text className="text-ink text-lg font-semibold text-center">
          Something broke on this screen
        </Text>
        <Text className="text-ink-soft text-sm text-center leading-5">
          {this.props.label
            ? `The ${this.props.label} screen hit an unexpected error. You can try again — the rest of the app is fine.`
            : "An unexpected error occurred. You can try again — the rest of the app is fine."}
        </Text>
        <TouchableOpacity
          onPress={this.reset}
          className="bg-rust px-6 py-3 rounded mt-2"
        >
          <Text className="text-ground text-base font-semibold">Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}
