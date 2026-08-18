import React, { useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import ScreenWrapper from "../components/ScreenWrapper";
import DecoHeader from "../components/DecoHeader";
import { supabase } from "../lib/supabase";
import { colors, fonts, tracking } from "../lib/theme";
import { readFunctionError, type FunctionErrorDetail } from "../lib/functionErrors";

// ── Types ─────────────────────────────────────────────────────────────────────

type ItemTags = {
  color: string;
  secondaryColor: string;
  category: string;
  formality: string;
  season: string;
  material: string;
  description: string;
};

type SimilarItem = {
  id: string;
  image_url: string | null;
  category: string | null;
  color: string | null;
  formality: string | null;
  similarity: number;
};

type DuplicateState = {
  newItemId: string;
  newImageUrl: string;
  newTags: ItemTags;
  match: SimilarItem;
};

type PickedAsset = ImagePicker.ImagePickerAsset;

type Props = {
  onNavigateToCloset: () => void;
};

// ── Screen ────────────────────────────────────────────────────────────────────

export default function HomeScreen({ onNavigateToCloset }: Props) {
  const [asset, setAsset] = useState<PickedAsset | null>(null);
  const [tags, setTags] = useState<ItemTags | null>(null);
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateState | null>(null);
  // reason is kept alongside the message so the render can react to specific
  // failures (e.g. no_item shows the prominent scan tips).
  const [saveError, setSaveError] = useState<{ message: string; reason: string | null } | null>(null);

  // ── pick helpers ─────────────────────────────────────────────────────────

  const openCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Camera access is needed to take photos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      setAsset(result.assets[0]);
      setTags(null);
      setDuplicate(null);
      setSaveError(null);
    }
  };

  const openLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Photo library access is needed.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      setAsset(result.assets[0]);
      setTags(null);
      setDuplicate(null);
      setSaveError(null);
    }
  };

  // ── save flow ─────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!asset) return;
    setSaving(true);
    setTags(null);
    setDuplicate(null);
    setSaveError(null);

    try {
      // 1. Upload photo to wardrobe-items bucket
      const mimeType = asset.mimeType ?? "image/jpeg";
      const ext = mimeType.split("/")[1] ?? "jpg";
      const path = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const imageResponse = await fetch(asset.uri);
      const arrayBuffer = await imageResponse.arrayBuffer();

      const { error: uploadError } = await supabase.storage
        .from("wardrobe-items")
        .upload(path, arrayBuffer, { contentType: mimeType });

      if (uploadError) throw uploadError;

      // 2. Get the public URL
      const { data: { publicUrl } } = supabase.storage
        .from("wardrobe-items")
        .getPublicUrl(path);

      // 3. Call tag-item Edge Function
      const { data: tagData, error: tagError } = await supabase.functions.invoke<ItemTags>(
        "tag-item",
        { body: { image_url: publicUrl } },
      );
      if (tagError || !tagData) {
        // Read the REAL status + body the function returned. The raw tagError is
        // just "Edge Function returned a non-2xx status code"; the cause lives in
        // its .context Response. We log it and map its reason code to an honest
        // message instead of blaming the photo.
        const detail = await readFunctionError(tagError);
        console.error(
          "[tag-item] failed:",
          detail.status ?? "(no status)",
          detail.reason ?? "(no reason)",
          detail.message,
        );
        // Tagging failed, so no item row will be created. Remove the photo we
        // just uploaded so a rejected image (e.g. a blank wall) leaves nothing
        // behind. Best-effort — a leftover orphan file is harmless.
        await supabase.storage.from("wardrobe-items").remove([path]).catch(() => {});
        setSaveError({ message: tagErrorMessage(detail), reason: detail.reason });
        setSaving(false);
        return;
      }

      // 4. Insert the item row, getting back the generated id
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id ?? null;

      const { data: newItem, error: insertError } = await supabase
        .from("items")
        .insert({
          user_id: userId,
          image_url: publicUrl,
          color: tagData.color,
          secondary_color: tagData.secondaryColor,
          category: tagData.category,
          formality: tagData.formality,
          season: tagData.season,
          material: tagData.material,
          description: tagData.description,
        })
        .select("id")
        .single();
      if (insertError) throw insertError;

      // 5. Embed the description (awaited — item must be vectorised before
      //    duplicate check runs, since find_similar_items compares embeddings)
      const { error: embedError } = await supabase.functions.invoke("embed-item", {
        body: { item_id: newItem.id },
      });
      if (embedError) {
        console.warn("[embed-item]", embedError.message);
      }

      // 6. Duplicate check — non-blocking; failure here must not lose the item
      try {
        const { data: similar } = await supabase.rpc("find_similar_items", {
          item_id: newItem.id,
          threshold: 0.85,
          max_count: 1,
        }) as { data: SimilarItem[] | null };

        if (similar && similar.length > 0) {
          // Surface the warning — user decides whether to keep or remove
          setDuplicate({ newItemId: newItem.id, newImageUrl: publicUrl, newTags: tagData, match: similar[0] });
          setSaving(false);
          return; // hold on this screen; don't navigate yet
        }
      } catch (dupErr) {
        // Duplicate check is best-effort; log and continue normally
        console.warn("[find_similar_items]", dupErr);
      }

      // 7. No duplicate — navigate to Closet
      setTags(tagData);
      onNavigateToCloset();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setSaveError({ message: friendlySaveError(raw), reason: null });
    } finally {
      setSaving(false);
    }
  };

  // ── duplicate actions ─────────────────────────────────────────────────────

  const handleKeepBoth = () => {
    if (!duplicate) return;
    setTags(duplicate.newTags);
    setDuplicate(null);
    onNavigateToCloset();
  };

  const handleRemoveDuplicate = async () => {
    if (!duplicate) return;
    const { error } = await supabase
      .from("items")
      .delete()
      .eq("id", duplicate.newItemId);
    if (error) {
      Alert.alert("Delete failed", error.message);
      return;
    }
    setDuplicate(null);
    setAsset(null);
    setTags(null);
    onNavigateToCloset();
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <ScreenWrapper>
      <ScrollView
        contentContainerClassName="items-center px-6 py-8 gap-6"
        showsVerticalScrollIndicator={false}
      >
        <DecoHeader title="Add Item" />

        {/* Photo preview */}
        {asset ? (
          <Image
            source={{ uri: asset.uri }}
            className="w-72 h-72 rounded"
            resizeMode="cover"
          />
        ) : (
          <View className="w-72 h-72 rounded bg-sunken items-center justify-center">
            <Text className="text-ink-faint text-base">No photo selected</Text>
          </View>
        )}

        {/* Duplicate warning — shown instead of tags when a match is found */}
        {duplicate ? (
          <DuplicateWarning
            newImageUrl={duplicate.newImageUrl}
            newTags={duplicate.newTags}
            match={duplicate.match}
            onKeep={handleKeepBoth}
            onRemove={handleRemoveDuplicate}
          />
        ) : (
          tags && <TagCard tags={tags} />
        )}

        {/* Inline save error */}
        {saveError && (
          <View className="w-full gap-3">
            <View className="bg-danger-tint border border-danger-edge rounded px-4 py-3">
              <Text className="text-danger text-sm font-semibold mb-0.5">
                Couldn't save item
              </Text>
              <Text className="text-danger text-sm leading-5">{saveError.message}</Text>
            </View>
            {/* Scan tips get top billing when the model couldn't find an item —
                black text, larger type, so testers actually read them. */}
            {saveError.reason === "no_item" && <ScanTips />}
          </View>
        )}

        {/* Tip + pick buttons */}
        <View className="w-full gap-5">
          <Text className="text-ink-faint text-xs text-center">
            Tip: good lighting and the full item in frame gives the best tags
          </Text>

          <View className="gap-4">
            <TouchableOpacity
              onPress={openCamera}
              disabled={saving}
              className={`py-4 rounded w-full items-center ${
                saving ? "bg-rust-muted" : "bg-rust"
              }`}
            >
              <Text className="text-ground text-base font-semibold">Take Picture</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={openLibrary}
              disabled={saving}
              className="py-4 rounded w-full items-center bg-sunken"
            >
              <Text className="text-ink text-base font-semibold">
                Choose from Library
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Save to Closet — hidden while duplicate decision is pending */}
        {!duplicate && (
          <TouchableOpacity
            onPress={handleSave}
            disabled={!asset || saving}
            className={`px-8 py-4 rounded w-full items-center flex-row justify-center gap-2 ${
              asset && !saving ? "bg-rust" : "bg-sunken"
            }`}
          >
            {saving ? (
              <>
                <ActivityIndicator size="small" color={colors.ground} />
                <Text className="text-ground text-base font-semibold">Saving…</Text>
              </>
            ) : (
              // Disabled sits on the sunken tone, so the label has to darken too
              // — white on tan was unreadable.
              <Text
                className={`text-base font-semibold ${
                  asset && !saving ? "text-ground" : "text-ink-faint"
                }`}
              >
                Save to Closet
              </Text>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>
    </ScreenWrapper>
  );
}

// ── ScanTips ──────────────────────────────────────────────────────────────────

function ScanTips() {
  return (
    <View className="w-full bg-surface border border-edge rounded px-4 py-4 gap-2">
      <Text className="text-ink text-base font-bold">
        Tips for a better scan
      </Text>
      {[
        "Lay the item flat or hang it against a plain background",
        "Use bright, even lighting — daylight works best",
        "Get the whole item in frame, filling most of the photo",
        "Photograph one item at a time",
      ].map((tip) => (
        <View key={tip} className="flex-row gap-2">
          <Text className="text-ink text-base leading-6">•</Text>
          <Text className="text-ink text-base leading-6 flex-1">{tip}</Text>
        </View>
      ))}
    </View>
  );
}

// ── DuplicateWarning ──────────────────────────────────────────────────────────

type DuplicateWarningProps = {
  newImageUrl: string;
  newTags: ItemTags;
  match: SimilarItem;
  onKeep: () => void;
  onRemove: () => Promise<void>;
};

function DuplicateWarning({ newImageUrl, newTags, match, onKeep, onRemove }: DuplicateWarningProps) {
  const [removing, setRemoving] = useState(false);
  const pct = Math.round(match.similarity * 100);

  const handleRemove = async () => {
    setRemoving(true);
    await onRemove();
    setRemoving(false);
  };

  return (
    <View className="w-full gap-4">
      {/* Header */}
      <View className="bg-notice-tint border border-notice-edge rounded p-4 gap-1">
        <Text className="text-notice text-base font-semibold">
          You may already own something similar
        </Text>
        <Text className="text-notice text-sm">
          The new item is {pct}% similar to an existing piece. Keep both or remove the new one.
        </Text>
      </View>

      {/* Side-by-side comparison */}
      <View className="flex-row gap-3">
        <ItemCompareCard
          imageUrl={newImageUrl}
          category={newTags.category}
          color={newTags.color}
          label="New"
          labelBg="bg-rust-tint"
          labelText="text-rust-deep"
        />
        <ItemCompareCard
          imageUrl={match.image_url}
          category={match.category}
          color={match.color}
          label="Existing"
          labelBg="bg-sunken"
          labelText="text-ink-soft"
        />
      </View>

      {/* Actions */}
      <TouchableOpacity
        onPress={onKeep}
        className="bg-rust py-4 rounded w-full items-center"
      >
        <Text className="text-ground text-base font-semibold">Keep both</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={handleRemove}
        disabled={removing}
        className="border border-danger-edge py-4 rounded w-full items-center flex-row justify-center gap-2"
      >
        {removing && <ActivityIndicator size="small" color={colors.danger} />}
        <Text className="text-danger text-base font-semibold">
          Remove new item
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function ItemCompareCard({
  imageUrl,
  category,
  color,
  label,
  labelBg,
  labelText,
}: {
  imageUrl: string | null;
  category: string | null;
  color: string | null;
  label: string;
  labelBg: string;
  labelText: string;
}) {
  return (
    <View className="flex-1 rounded overflow-hidden border border-edge bg-surface">
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          style={{ width: "100%", aspectRatio: 1 }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={{ width: "100%", aspectRatio: 1 }}
          className="bg-sunken items-center justify-center"
        >
          <Text className="text-ink-faint text-xs">No photo</Text>
        </View>
      )}
      <View className="p-2 gap-1">
        <View className={`self-start px-2 py-0.5 rounded-full ${labelBg}`}>
          <Text className={`text-xs font-semibold ${labelText}`}>{label}</Text>
        </View>
        <Text className="text-xs font-semibold text-ink capitalize" numberOfLines={1}>
          {category ?? "—"}
        </Text>
        <Text className="text-xs text-ink-soft capitalize" numberOfLines={1}>
          {color ?? "—"}
        </Text>
      </View>
    </View>
  );
}

// ── TagCard ───────────────────────────────────────────────────────────────────

function TagCard({ tags }: { tags: ItemTags }) {
  return (
    <View className="w-full bg-surface border border-edge rounded p-4 gap-3">
      <View className="flex-row flex-wrap gap-2">
        <Pill label={tags.color} color="indigo" />
        {tags.secondaryColor ? <Pill label={tags.secondaryColor} color="violet" /> : null}
        <Pill label={tags.category} color="sky" />
        <Pill label={tags.formality} color="amber" />
        <Pill label={tags.season} color="emerald" />
        <Pill label={tags.material} color="rose" />
      </View>
      <Text className="text-ink-soft text-sm leading-5 italic">{tags.description}</Text>
    </View>
  );
}

type PillColor = "indigo" | "violet" | "sky" | "amber" | "emerald" | "rose";

const pillStyles: Record<PillColor, { bg: string; text: string }> = {
  indigo:  { bg: "bg-chip-teal",  text: "text-chip-teal-ink"  },
  violet:  { bg: "bg-chip-plum",  text: "text-chip-plum-ink"  },
  sky:     { bg: "bg-chip-sky",     text: "text-chip-sky-ink"     },
  amber:   { bg: "bg-chip-brass",   text: "text-chip-brass-ink"   },
  emerald: { bg: "bg-chip-olive", text: "text-chip-olive-ink" },
  rose:    { bg: "bg-chip-rust",    text: "text-chip-rust-ink"    },
};

function Pill({ label, color }: { label: string; color: PillColor }) {
  const { bg, text } = pillStyles[color];
  return (
    <View className={`px-3 py-1 rounded-full ${bg}`}>
      <Text className={`text-xs font-medium capitalize ${text}`}>{label}</Text>
    </View>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Maps a tag-item failure to an honest user message. Only a genuine "no_item"
 * (the model couldn't find/identify a clothing item, or was low-confidence)
 * mentions lighting/framing — service and input failures say "try again".
 */
function tagErrorMessage(d: FunctionErrorDetail): string {
  switch (d.reason) {
    case "no_item":
      return "We couldn't identify a clothing item in this photo. Try better lighting and get the full item in frame.";
    case "image_too_large":
      return "That photo is too large to analyze. Try a slightly lower-resolution photo.";
    case "unsupported_format":
      return "That image format isn't supported. Take a new photo (JPEG or PNG) and try again.";
    case "image_rejected":
      return "The photo couldn't be processed. Try a different photo.";
    case "daily_limit":
      return "You've hit today's limit — it resets tomorrow.";
    case "rate_limited":
    case "overloaded":
      return "The tagging service is busy right now. Please wait a moment and try again.";
    case "timeout":
      return "Tagging timed out. Please try again.";
    case "service_config":
      return "Tagging is temporarily unavailable. Please try again later.";
    case "fetch_failed":
      return "We couldn't read the uploaded photo. Please try again.";
    case "network":
      return "Can't reach the tagging service. Check your connection and try again.";
    case "parse_error":
    case "unknown":
    default:
      return "Couldn't tag this photo. Please try again.";
  }
}

/** Friendly message for non-tagging save failures (upload, insert, etc.). */
function friendlySaveError(raw: string): string {
  if (/network|fetch|failed to fetch|offline|internet/i.test(raw))
    return "No internet connection. Check your network and try again.";
  if (/storage|bucket|upload/i.test(raw))
    return "Photo upload failed. Check your connection and try again.";
  if (/unauthorized|401|jwt|token/i.test(raw))
    return "Your session expired — sign out and back in, then try again.";
  return "Something went wrong saving this item. Please try again.";
}
