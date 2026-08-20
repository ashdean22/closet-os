import { useEffect, useRef } from "react";
import { View, Text, Image, TouchableOpacity, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, fonts, tracking } from "../lib/theme";

/**
 * The one-screen explanation shown after a first sign-up.
 *
 * Deliberately not a swipeable carousel. A deck of slides gets swiped past
 * without being read, because there is nothing on screen for it to point at
 * yet — the app only makes sense once there are clothes in it. So this says the
 * three things that matter in about fifteen words and puts the user on the
 * camera, where the concept explains itself.
 */

const STEPS = [
  {
    n: "1",
    title: "Photograph your clothes",
    body: "One shot per piece. No forms to fill in.",
  },
  {
    n: "2",
    title: "Capsule tags them",
    body: "Colour, fabric, how dressy — worked out for you.",
  },
  {
    n: "3",
    title: "Ask what to wear",
    body: "“65° and rainy, job interview.” You get a full outfit from your own closet.",
  },
] as const;

export default function WelcomeSheet({ onStart }: { onStart: () => void }) {
  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(rise, {
        toValue: 0,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [fade, rise]);

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.tealDeep }}>
      <Animated.View
        style={{ flex: 1, opacity: fade, transform: [{ translateY: rise }] }}
        className="px-7 justify-center"
      >
        {/* Brand — same lockup language as the sign-in screen */}
        <View className="items-center mb-8">
          <Image
            source={require("../assets/logo-mark.png")}
            style={{ width: 46, height: 68, tintColor: colors.ground }}
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel="Capsule"
          />
          <Text
            style={{
              fontFamily: fonts.display,
              fontSize: 30,
              lineHeight: 38,
              color: colors.ground,
              marginTop: 14,
            }}
          >
            Capsule
          </Text>
          <View className="flex-row items-center gap-3 mt-2">
            <View style={{ height: 1, width: 40, backgroundColor: colors.brass }} />
            <View
              style={{
                width: 7,
                height: 7,
                backgroundColor: colors.brass,
                transform: [{ rotate: "45deg" }],
              }}
            />
            <View style={{ height: 1, width: 40, backgroundColor: colors.brass }} />
          </View>
        </View>

        <Text
          className="text-center mb-7"
          style={{ color: colors.tealTint, fontSize: 15, lineHeight: 22 }}
        >
          Outfits built from the clothes you already own.
        </Text>

        <View className="gap-5 mb-9">
          {STEPS.map((step) => (
            <View key={step.n} className="flex-row gap-4 items-start">
              <View
                style={{
                  width: 30,
                  height: 30,
                  borderWidth: 1,
                  borderColor: colors.brass,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{
                    fontFamily: fonts.deco,
                    fontSize: 13,
                    color: colors.brass,
                  }}
                >
                  {step.n}
                </Text>
              </View>
              <View className="flex-1 gap-1">
                <Text
                  style={{
                    fontFamily: fonts.deco,
                    fontSize: 14,
                    letterSpacing: tracking.deco,
                    color: colors.ground,
                  }}
                >
                  {step.title}
                </Text>
                <Text style={{ color: colors.sky, fontSize: 14, lineHeight: 20 }}>
                  {step.body}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <TouchableOpacity
          onPress={onStart}
          className="py-4 rounded items-center"
          style={{ backgroundColor: colors.rust }}
          accessibilityRole="button"
        >
          <Text
            style={{
              fontFamily: fonts.deco,
              fontSize: 14,
              letterSpacing: tracking.decoWide,
              color: colors.ground,
            }}
          >
            ADD MY FIRST PIECE
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  );
}
