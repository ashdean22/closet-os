import React, { useState, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DetailItem = {
  id: string;
  image_url: string | null;
  color: string | null;
  secondary_color: string | null;
  category: string | null;
  formality: string | null;
  season: string | null;
  material: string | null;
  description: string | null;
};

type Props = {
  item: DetailItem | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
  onItemUpdated: (id: string, patch: Partial<DetailItem>) => void;
};

// Enum values must match the tag-item tool schema exactly — edited values feed
// the same search/styling pipeline as model-generated ones.
const CATEGORIES = ["top", "bottom", "outerwear", "shoes", "accessory", "dress", "other"] as const;
const FORMALITIES = ["casual", "smart-casual", "business", "formal", "athletic"] as const;
const SEASONS = ["spring", "summer", "fall", "winter", "all-season"] as const;

type Draft = {
  category: string;
  color: string;
  secondary_color: string;
  formality: string;
  season: string;
  material: string;
  description: string;
};

function draftFromItem(item: DetailItem): Draft {
  return {
    category: item.category ?? "other",
    color: item.color ?? "",
    secondary_color: item.secondary_color ?? "",
    formality: item.formality ?? "casual",
    season: item.season ?? "all-season",
    material: item.material ?? "",
    description: item.description ?? "",
  };
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export default function ItemDetailModal({
  item,
  onClose,
  onDeleted,
  onItemUpdated,
}: Props) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset edit state when a new item is opened. Also resets `deleting` so the
  // Delete button is never stuck in a "Deleting…" state after the modal reopens.
  useEffect(() => {
    if (item) {
      setDraft(null);
      setEditing(false);
      setDeleting(false);
    }
  }, [item?.id]);

  if (!item) return null;

  // ── tag editing ────────────────────────────────────────────────────────────

  const startEditing = () => {
    setDraft(draftFromItem(item));
    setEditing(true);
  };

  const cancelEditing = () => {
    setDraft(null);
    setEditing(false);
  };

  const setField = (field: keyof Draft, value: string) =>
    setDraft((d) => (d ? { ...d, [field]: value } : d));

  const handleSaveTags = async () => {
    if (!draft) return;
    // User-corrected tags are ground truth for this item — they overwrite the
    // model's output. NOTE: these corrections are intentionally kept as future
    // fine-tuning training data (model tags vs. human-corrected tags).
    const patch: Partial<DetailItem> = {
      category: draft.category,
      color: draft.color.trim(),
      secondary_color: draft.secondary_color.trim(),
      formality: draft.formality,
      season: draft.season,
      material: draft.material.trim(),
      description: draft.description.trim(),
    };

    setSaving(true);
    try {
      const { error } = await supabase.from("items").update(patch).eq("id", item.id);
      if (error) {
        Alert.alert("Save failed", error.message);
        return;
      }

      // The stored vector was embedded from the old description; regenerate it
      // so semantic search reflects the edit. Best-effort — search still works
      // on the stale vector if this fails.
      if (patch.description !== (item.description ?? "")) {
        supabase.functions
          .invoke("embed-item", { body: { item_id: item.id } })
          .then(({ error: embedError }) => {
            if (embedError) console.warn("[embed-item] re-embed:", embedError.message);
          });
      }

      onItemUpdated(item.id, patch);
      setEditing(false);
      setDraft(null);
    } finally {
      setSaving(false);
    }
  };

  // ── delete ─────────────────────────────────────────────────────────────────

  const handleDelete = () => {
    Alert.alert(
      "Delete item",
      "This will permanently remove the item and its photo. Are you sure?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: confirmDelete },
      ],
    );
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      // 1. Remove image from Storage (non-fatal if already gone)
      if (item.image_url) {
        const path = storagePathFromUrl(item.image_url);
        if (path) {
          const { error: storageError } = await supabase.storage
            .from("wardrobe-items")
            .remove([path]);
          if (storageError) console.warn("[delete] storage:", storageError.message);
        }
      }

      // 2. Delete the DB row
      const { error: dbError } = await supabase
        .from("items")
        .delete()
        .eq("id", item.id);

      if (dbError) {
        Alert.alert("Delete failed", dbError.message);
        return;
      }

      onDeleted(item.id);
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={!!item}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1, backgroundColor: "white" }}
      >
        {/* Drag handle (iOS pageSheet) */}
        {Platform.OS === "ios" && (
          <View className="items-center pt-3 pb-1">
            <View className="w-9 h-1 rounded-full bg-gray-300" />
          </View>
        )}

        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        >
          {/* ── Photo ──────────────────────────────────────────────────────── */}
          <View className="relative">
            {item.image_url ? (
              <Image
                source={{ uri: item.image_url }}
                style={{ width: "100%", height: 320 }}
                resizeMode="cover"
              />
            ) : (
              <View
                style={{ width: "100%", height: 320 }}
                className="bg-gray-100 items-center justify-center"
              >
                <Text className="text-gray-400">No photo</Text>
              </View>
            )}
            <TouchableOpacity
              onPress={onClose}
              style={{ position: "absolute", top: 12, right: 12 }}
              className="bg-black/40 w-9 h-9 rounded-full items-center justify-center"
            >
              <Text className="text-white text-base font-semibold">✕</Text>
            </TouchableOpacity>
          </View>

          <View className="px-5 pt-5 gap-5">
            {editing && draft ? (
              <TagEditor
                draft={draft}
                saving={saving}
                onChange={setField}
                onCancel={cancelEditing}
                onSave={handleSaveTags}
              />
            ) : (
              <>
                {/* ── Tags (read-only) ─────────────────────────────────────── */}
                <View className="gap-2">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      Tags
                    </Text>
                    <TouchableOpacity
                      onPress={startEditing}
                      className="px-3 py-1 rounded-lg bg-gray-100"
                    >
                      <Text className="text-gray-600 text-xs font-medium">Edit tags</Text>
                    </TouchableOpacity>
                  </View>
                  <View className="flex-row flex-wrap gap-2">
                    {item.category        && <TagPill label={item.category}        hue="sky"     />}
                    {item.color           && <TagPill label={item.color}           hue="indigo"  />}
                    {item.secondary_color && <TagPill label={item.secondary_color} hue="violet"  />}
                    {item.formality       && <TagPill label={item.formality}       hue="amber"   />}
                    {item.season          && <TagPill label={item.season}          hue="emerald" />}
                    {item.material        && <TagPill label={item.material}        hue="rose"    />}
                  </View>
                </View>

                {/* ── Description ──────────────────────────────────────────── */}
                <View className="gap-2">
                  <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    Description
                  </Text>
                  <Text className="text-gray-700 text-sm leading-6">
                    {item.description ?? (
                      <Text className="text-gray-400 italic">No description</Text>
                    )}
                  </Text>
                </View>
              </>
            )}

            {/* ── Delete ───────────────────────────────────────────────────── */}
            {!editing && (
              <TouchableOpacity
                onPress={handleDelete}
                disabled={deleting}
                className="mt-2 py-4 rounded-xl border border-red-200 items-center flex-row justify-center gap-2"
              >
                {deleting && <ActivityIndicator size="small" color="#dc2626" />}
                <Text className="text-red-600 text-base font-semibold">
                  {deleting ? "Deleting…" : "Delete from Closet"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── TagEditor ─────────────────────────────────────────────────────────────────

function TagEditor({
  draft,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  draft: Draft;
  saving: boolean;
  onChange: (field: keyof Draft, value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <View className="gap-5">
      <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
        Edit tags
      </Text>

      <EnumPicker
        label="Category"
        options={CATEGORIES}
        value={draft.category}
        onSelect={(v) => onChange("category", v)}
      />
      <EnumPicker
        label="Formality"
        options={FORMALITIES}
        value={draft.formality}
        onSelect={(v) => onChange("formality", v)}
      />
      <EnumPicker
        label="Season"
        options={SEASONS}
        value={draft.season}
        onSelect={(v) => onChange("season", v)}
      />

      <FieldInput
        label="Color"
        value={draft.color}
        placeholder="e.g. navy blue"
        onChangeText={(t) => onChange("color", t)}
      />
      <FieldInput
        label="Secondary color (optional)"
        value={draft.secondary_color}
        placeholder="e.g. white stripes — leave empty if solid"
        onChangeText={(t) => onChange("secondary_color", t)}
      />
      <FieldInput
        label="Material"
        value={draft.material}
        placeholder="e.g. cotton, denim, leather"
        onChangeText={(t) => onChange("material", t)}
      />

      <View className="gap-1.5">
        <Text className="text-xs font-medium text-gray-500">Description</Text>
        <TextInput
          value={draft.description}
          onChangeText={(t) => onChange("description", t)}
          multiline
          scrollEnabled={false}
          className="border border-gray-200 rounded-xl p-3 text-gray-800 text-sm leading-5 bg-gray-50"
          style={{ minHeight: 80, textAlignVertical: "top" }}
        />
        <Text className="text-gray-400 text-xs">
          Used for outfit search — describe style, color, and occasion.
        </Text>
      </View>

      <View className="flex-row gap-2">
        <TouchableOpacity
          onPress={onCancel}
          disabled={saving}
          className="flex-1 py-3 rounded-xl border border-gray-200 items-center"
        >
          <Text className="text-gray-500 text-sm font-medium">Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onSave}
          disabled={saving}
          className={`flex-1 py-3 rounded-xl items-center flex-row justify-center gap-1.5 ${
            saving ? "bg-indigo-300" : "bg-indigo-600"
          }`}
        >
          {saving && <ActivityIndicator size="small" color="white" />}
          <Text className="text-white text-sm font-semibold">Save</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function EnumPicker({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onSelect: (value: string) => void;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-xs font-medium text-gray-500">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((opt) => {
          const selected = opt === value;
          return (
            <TouchableOpacity
              key={opt}
              onPress={() => onSelect(opt)}
              className={`px-3 py-1.5 rounded-full border ${
                selected
                  ? "bg-indigo-600 border-indigo-600"
                  : "bg-white border-gray-200"
              }`}
            >
              <Text
                className={`text-xs font-medium capitalize ${
                  selected ? "text-white" : "text-gray-600"
                }`}
              >
                {opt}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function FieldInput({
  label,
  value,
  placeholder,
  onChangeText,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (text: string) => void;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-xs font-medium text-gray-500">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        autoCapitalize="none"
        className="border border-gray-200 rounded-xl px-3 py-2.5 text-gray-800 text-sm bg-gray-50"
      />
    </View>
  );
}

// ── TagPill ───────────────────────────────────────────────────────────────────

type Hue = "sky" | "indigo" | "violet" | "amber" | "emerald" | "rose";

const hueStyles: Record<Hue, { bg: string; text: string }> = {
  sky:     { bg: "bg-sky-100",     text: "text-sky-700"     },
  indigo:  { bg: "bg-indigo-100",  text: "text-indigo-700"  },
  violet:  { bg: "bg-violet-100",  text: "text-violet-700"  },
  amber:   { bg: "bg-amber-100",   text: "text-amber-700"   },
  emerald: { bg: "bg-emerald-100", text: "text-emerald-700" },
  rose:    { bg: "bg-rose-100",    text: "text-rose-700"    },
};

function TagPill({ label, hue }: { label: string; hue: Hue }) {
  const { bg, text } = hueStyles[hue];
  return (
    <View className={`px-3 py-1 rounded-full ${bg}`}>
      <Text className={`text-xs font-medium capitalize ${text}`}>{label}</Text>
    </View>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function storagePathFromUrl(url: string): string | null {
  const marker = "/wardrobe-items/";
  const idx = url.indexOf(marker);
  return idx >= 0 ? url.slice(idx + marker.length) : null;
}
