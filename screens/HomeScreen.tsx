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
import { supabase } from "../lib/supabase";

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
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── pick helpers ─────────────────────────────────────────────────────────

  const openCamera = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Camera access is needed to take photos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
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
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
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
      if (tagError) throw tagError;
      if (!tagData) throw new Error("tag-item returned no data");

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
      setSaveError(friendlySaveError(raw));
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
        <Text className="text-2xl font-bold text-gray-800">Add Item</Text>

        {/* Photo preview */}
        {asset ? (
          <Image
            source={{ uri: asset.uri }}
            className="w-72 h-72 rounded-2xl"
            resizeMode="cover"
          />
        ) : (
          <View className="w-72 h-72 rounded-2xl bg-gray-100 items-center justify-center">
            <Text className="text-gray-400 text-base">No photo selected</Text>
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
          <View className="w-full bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <Text className="text-red-700 text-sm font-semibold mb-0.5">
              Couldn't save item
            </Text>
            <Text className="text-red-600 text-sm leading-5">{saveError}</Text>
          </View>
        )}

        {/* Tip + pick buttons */}
        <View className="w-full gap-5">
          <Text className="text-gray-400 text-xs text-center">
            Tip: good lighting and the full item in frame gives the best tags
          </Text>

          <View className="gap-4">
            <TouchableOpacity
              onPress={openCamera}
              disabled={saving}
              className={`py-4 rounded-xl w-full items-center ${
                saving ? "bg-indigo-300" : "bg-indigo-600"
              }`}
            >
              <Text className="text-white text-base font-semibold">Take Picture</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={openLibrary}
              disabled={saving}
              className="py-4 rounded-xl w-full items-center bg-gray-100"
            >
              <Text className="text-gray-700 text-base font-semibold">
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
            className={`px-8 py-4 rounded-xl w-full items-center flex-row justify-center gap-2 ${
              asset && !saving ? "bg-emerald-600" : "bg-gray-300"
            }`}
          >
            {saving ? (
              <>
                <ActivityIndicator size="small" color="white" />
                <Text className="text-white text-base font-semibold">Saving…</Text>
              </>
            ) : (
              <Text className="text-white text-base font-semibold">Save to Closet</Text>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>
    </ScreenWrapper>
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
      <View className="bg-amber-50 border border-amber-200 rounded-2xl p-4 gap-1">
        <Text className="text-amber-800 text-base font-semibold">
          You may already own something similar
        </Text>
        <Text className="text-amber-600 text-sm">
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
          labelBg="bg-indigo-100"
          labelText="text-indigo-700"
        />
        <ItemCompareCard
          imageUrl={match.image_url}
          category={match.category}
          color={match.color}
          label="Existing"
          labelBg="bg-gray-100"
          labelText="text-gray-600"
        />
      </View>

      {/* Actions */}
      <TouchableOpacity
        onPress={onKeep}
        className="bg-emerald-600 py-4 rounded-xl w-full items-center"
      >
        <Text className="text-white text-base font-semibold">Keep both</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={handleRemove}
        disabled={removing}
        className="border border-red-300 py-4 rounded-xl w-full items-center flex-row justify-center gap-2"
      >
        {removing && <ActivityIndicator size="small" color="#dc2626" />}
        <Text className="text-red-600 text-base font-semibold">
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
    <View className="flex-1 rounded-2xl overflow-hidden border border-gray-100 bg-white">
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          style={{ width: "100%", aspectRatio: 1 }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={{ width: "100%", aspectRatio: 1 }}
          className="bg-gray-100 items-center justify-center"
        >
          <Text className="text-gray-400 text-xs">No photo</Text>
        </View>
      )}
      <View className="p-2 gap-1">
        <View className={`self-start px-2 py-0.5 rounded-full ${labelBg}`}>
          <Text className={`text-xs font-semibold ${labelText}`}>{label}</Text>
        </View>
        <Text className="text-xs font-semibold text-gray-800 capitalize" numberOfLines={1}>
          {category ?? "—"}
        </Text>
        <Text className="text-xs text-gray-500 capitalize" numberOfLines={1}>
          {color ?? "—"}
        </Text>
      </View>
    </View>
  );
}

// ── TagCard ───────────────────────────────────────────────────────────────────

function TagCard({ tags }: { tags: ItemTags }) {
  return (
    <View className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-4 gap-3">
      <View className="flex-row flex-wrap gap-2">
        <Pill label={tags.color} color="indigo" />
        {tags.secondaryColor ? <Pill label={tags.secondaryColor} color="violet" /> : null}
        <Pill label={tags.category} color="sky" />
        <Pill label={tags.formality} color="amber" />
        <Pill label={tags.season} color="emerald" />
        <Pill label={tags.material} color="rose" />
      </View>
      <Text className="text-gray-600 text-sm leading-5 italic">{tags.description}</Text>
    </View>
  );
}

type PillColor = "indigo" | "violet" | "sky" | "amber" | "emerald" | "rose";

const pillStyles: Record<PillColor, { bg: string; text: string }> = {
  indigo:  { bg: "bg-indigo-100",  text: "text-indigo-700"  },
  violet:  { bg: "bg-violet-100",  text: "text-violet-700"  },
  sky:     { bg: "bg-sky-100",     text: "text-sky-700"     },
  amber:   { bg: "bg-amber-100",   text: "text-amber-700"   },
  emerald: { bg: "bg-emerald-100", text: "text-emerald-700" },
  rose:    { bg: "bg-rose-100",    text: "text-rose-700"    },
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

function friendlySaveError(raw: string): string {
  if (/network|fetch|failed to fetch|offline|internet/i.test(raw))
    return "No internet connection. Check your network and try again.";
  if (/storage|bucket|upload/i.test(raw))
    return "Photo upload failed. Check your connection and try again.";
  if (/unauthorized|401|jwt|token/i.test(raw))
    return "Your session expired — sign out and back in, then try again.";
  if (/tag-item|tagging/i.test(raw))
    return "Couldn't tag the photo. Make sure the item is clearly visible and retry.";
  return "Something went wrong saving this item. Please try again.";
}
