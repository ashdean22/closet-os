import { View, Text } from "react-native";
import { colors, fonts, tracking } from "../lib/theme";

/**
 * Screen title set in Limelight over a doubled rule — the Art Deco convention
 * of a heavy line shadowed by a fine metallic one. Shared so every tab's header
 * stays identical; ClosetScreen inlines its own variant because it also carries
 * an item count on the right.
 */
export default function DecoHeader({
  title,
  align = "left",
}: {
  title: string;
  align?: "left" | "center";
}) {
  return (
    <View style={{ width: "100%", alignItems: align === "center" ? "center" : "stretch" }}>
      <Text
        style={{
          fontFamily: fonts.deco,
          fontSize: 24,
          letterSpacing: tracking.deco,
          color: colors.ink,
          textAlign: align,
        }}
      >
        {title}
      </Text>
      <View style={{ height: 2, backgroundColor: colors.ink, marginTop: 8 }} />
      <View style={{ height: 1, backgroundColor: colors.brass, marginTop: 2 }} />
    </View>
  );
}
