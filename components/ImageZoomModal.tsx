import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  Modal,
  ScrollView,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useWindowDimensions,
  Platform,
  StatusBar,
} from "react-native";

/**
 * Full-screen image viewer with pinch- and double-tap zoom.
 *
 * Deliberately built on RN's own ScrollView rather than
 * react-native-gesture-handler: the app ships without that dependency, and
 * adding it would force a native rebuild of a release that's already live.
 * ScrollView's maximumZoomScale gives real pinch-zoom on iOS for free; Android
 * has no equivalent, so it falls back to a double-tap size toggle inside
 * nested scrollers, which still allows panning around a magnified photo.
 */

const MAX_ZOOM = 4;
/** Scale applied by a double-tap. Below MAX_ZOOM so pinch still has headroom. */
const DOUBLE_TAP_ZOOM = 2.5;
/** Two taps closer together than this count as a double-tap. */
const DOUBLE_TAP_MS = 280;

export default function ImageZoomModal({
  uri,
  caption,
  onClose,
}: {
  /** Null closes the modal — mirrors the item-driven ItemDetailModal API. */
  uri: string | null;
  caption?: string | null;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const lastTapAt = useRef(0);
  // iOS reports live zoom through onScroll; we keep it in a ref because only
  // the double-tap handler reads it and re-rendering on every pinch frame
  // would be wasteful.
  const zoomScale = useRef(1);
  // Android has no native ScrollView zoom, so its magnification is state-driven.
  const [androidZoomed, setAndroidZoomed] = useState(false);

  const isIOS = Platform.OS === "ios";

  // Reset zoom whenever a different photo is opened, otherwise the next image
  // inherits the previous one's magnification and content offset.
  useEffect(() => {
    if (!uri) return;
    zoomScale.current = 1;
    setAndroidZoomed(false);
    scrollRef.current?.scrollTo({ x: 0, y: 0, animated: false });
  }, [uri]);

  const handleTap = useCallback(
    (touchX: number, touchY: number) => {
      const now = Date.now();
      const isDoubleTap = now - lastTapAt.current < DOUBLE_TAP_MS;
      lastTapAt.current = now;
      if (!isDoubleTap) return;
      // Reset so a third tap doesn't immediately register as another double.
      lastTapAt.current = 0;

      if (!isIOS) {
        setAndroidZoomed((z) => !z);
        return;
      }

      // scrollResponderZoomTo takes the rect (in content coordinates) to fill
      // the viewport, so zooming in means asking for a proportionally smaller
      // rect centred on the tap.
      const zoomingIn = zoomScale.current <= 1.05;
      const targetScale = zoomingIn ? DOUBLE_TAP_ZOOM : 1;
      const rectWidth = width / targetScale;
      const rectHeight = height / targetScale;

      scrollRef.current?.scrollResponderZoomTo({
        x: clamp(touchX - rectWidth / 2, 0, Math.max(width - rectWidth, 0)),
        y: clamp(touchY - rectHeight / 2, 0, Math.max(height - rectHeight, 0)),
        width: rectWidth,
        height: rectHeight,
        animated: true,
      });
      zoomScale.current = targetScale;
    },
    [height, isIOS, width],
  );

  if (!uri) return null;

  // On Android the magnified image is genuinely larger than the viewport, which
  // is what makes panning possible; on iOS the ScrollView scales it for us.
  const androidScale = androidZoomed ? DOUBLE_TAP_ZOOM : 1;
  const imageStyle = isIOS
    ? { width, height }
    : { width: width * androidScale, height: height * androidScale };

  const photo = (
    <TouchableWithoutFeedback
      onPress={(e) =>
        handleTap(e.nativeEvent.locationX ?? 0, e.nativeEvent.locationY ?? 0)
      }
    >
      <Image source={{ uri }} style={imageStyle} resizeMode="contain" />
    </TouchableWithoutFeedback>
  );

  return (
    <Modal
      visible
      transparent={false}
      animationType="fade"
      supportedOrientations={["portrait"]}
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, backgroundColor: "black" }}>
        {isIOS ? (
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ width, height }}
            maximumZoomScale={MAX_ZOOM}
            minimumZoomScale={1}
            bouncesZoom
            centerContent
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={(e) => {
              zoomScale.current = e.nativeEvent.zoomScale ?? 1;
            }}
          >
            {photo}
          </ScrollView>
        ) : (
          // Nested scrollers: a single ScrollView only pans one axis, and a
          // zoomed photo needs both.
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={
              androidZoomed ? undefined : { flex: 1, justifyContent: "center" }
            }
            showsVerticalScrollIndicator={false}
          >
            <ScrollView
              horizontal
              contentContainerStyle={
                androidZoomed ? undefined : { flex: 1, justifyContent: "center" }
              }
              showsHorizontalScrollIndicator={false}
            >
              {photo}
            </ScrollView>
          </ScrollView>
        )}

        {/* ── Close ──────────────────────────────────────────────────────── */}
        <TouchableOpacity
          onPress={onClose}
          accessibilityLabel="Close photo"
          accessibilityRole="button"
          style={{ position: "absolute", top: 56, right: 20 }}
          className="bg-surface/20 w-10 h-10 rounded-full items-center justify-center"
        >
          <Text className="text-white text-lg font-semibold">✕</Text>
        </TouchableOpacity>

        {/* ── Caption + hint ─────────────────────────────────────────────── */}
        <View
          style={{ position: "absolute", left: 0, right: 0, bottom: 44 }}
          className="items-center gap-1 px-8"
        >
          {caption ? (
            <Text
              className="text-white text-sm font-medium capitalize text-center"
              numberOfLines={2}
            >
              {caption}
            </Text>
          ) : null}
          <Text className="text-white/50 text-xs text-center">
            {isIOS ? "Pinch or double-tap to zoom" : "Double-tap to zoom"}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
