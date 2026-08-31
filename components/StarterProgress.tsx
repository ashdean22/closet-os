import { useCallback, useEffect, useState } from "react";
import { View, Text } from "react-native";
import { supabase } from "../lib/supabase";
import { colors, fonts, radius, tracking } from "../lib/theme";
import { STARTER_GOAL } from "../lib/onboarding";

/**
 * Progress toward a closet the stylist can actually work with.
 *
 * The commonest first-run failure isn't confusion about the buttons — it's
 * asking for an outfit with four things in the closet and getting something
 * obvious back, which reads as the app being bad rather than the wardrobe
 * being thin. Saying so up front sets the expectation and gives a finish line.
 *
 * Disappears for good once the goal is met; there is no reason to keep
 * counting after that.
 */
export default function StarterProgress({ refreshKey }: { refreshKey: number }) {
  const [count, setCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    // head:true — we only want the count, never the rows.
    const { count: n, error } = await supabase
      .from("items")
      .select("id", { count: "exact", head: true });
    // On error leave `count` null so the bar simply doesn't render; a failed
    // count is not worth an error message on the Add screen.
    if (!error) setCount(n ?? 0);
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (count === null || count >= STARTER_GOAL) return null;

  const remaining = STARTER_GOAL - count;
  const pct = Math.max(0.04, count / STARTER_GOAL);

  return (
    <View className="w-full bg-surface border border-edge rounded p-4 gap-2">
      <View className="flex-row items-baseline justify-between">
        <Text
          style={{
            fontFamily: fonts.deco,
            fontSize: 12,
            letterSpacing: tracking.deco,
            color: colors.ink,
          }}
        >
          GETTING STARTED
        </Text>
        <Text className="text-ink-faint text-xs font-semibold">
          {count} of {STARTER_GOAL}
        </Text>
      </View>

      {/* Track + fill */}
      <View style={{ height: 4, backgroundColor: colors.sunken, borderRadius: radius.pill }}>
        <View
          style={{
            height: 4,
            width: `${pct * 100}%`,
            backgroundColor: colors.brass,
            borderRadius: radius.pill,
          }}
        />
      </View>

      <Text className="text-ink-soft text-sm leading-5">
        {count === 0
          ? "Add a few pieces and the stylist can start dressing you. Around eight is enough to work with."
          : remaining === 1
            ? "One more piece and the stylist has enough to build a full outfit."
            : `${remaining} more pieces and the stylist has enough to build a full outfit.`}
      </Text>
    </View>
  );
}
