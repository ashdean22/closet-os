import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import type { ReactNode } from "react";

// Bottom edge is intentionally omitted from the default so the
// app-level tab bar can own the bottom safe-area inset.
const DEFAULT_EDGES: Edge[] = ["top", "left", "right"];

type Props = {
  children: ReactNode;
  className?: string;
  edges?: Edge[];
};

export default function ScreenWrapper({
  children,
  className = "",
  edges = DEFAULT_EDGES,
}: Props) {
  return (
    <SafeAreaView edges={edges} className={`flex-1 bg-white ${className}`}>
      {children}
    </SafeAreaView>
  );
}
