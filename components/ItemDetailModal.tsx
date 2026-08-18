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
import { colors, fonts, tracking } from "../lib/theme";

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
            <View className="w-9 h-1 rounded-full bg-edge" />
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
                className="bg-sunken items-center justify-center"
              >
                <Text className="text-ink-faint">No photo</Text>
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
                    <Text className="text-xs font-semibold text-ink-faint uppercase tracking-wide">
                      Tags
                    </Text>
                    <TouchableOpacity
                      onPress={startEditing}
                      className="px-3 py-1 rounded bg-sunken"
                    >
                      <Text className="text-ink-soft text-xs font-medium">Edit tags</Text>
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
                  <Text className="text-xs font-semibold text-ink-faint uppercase tracking-wide">
                    Description
                  </Text>
                  <Text className="text-ink text-sm leading-6">
                    {item.description ?? (
                      <Text className="text-ink-faint italic">No description</Text>
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
                className="mt-2 py-4 rounded border border-danger-edge items-center flex-row justify-center gap-2"
              >
                {deleting && <ActivityIndicator size="small" color={colors.danger} />}
                <Text className="text-danger text-base font-semibold">
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
      <Text className="text-xs font-semibold text-ink-faint uppercase tracking-wide">
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
        <Text className="text-xs font-medium text-ink-soft">Description</Text>
        <TextInput
          value={draft.description}
          onChangeText={(t) => onChange("description", t)}
          multiline
          scrollEnabled={false}
          className="border border-edge rounded p-3 text-ink text-sm leading-5 bg-surface"
          style={{ minHeight: 80, textAlignVertical: "top" }}
        />
        <Text className="text-ink-faint text-xs">
          Used for outfit search — describe style, color, and occasion.
        </Text>
      </View>

      <View className="flex-row gap-2">
        <TouchableOpacity
          onPress={onCancel}
          disabled={saving}
          className="flex-1 py-3 rounded border border-edge items-center"
        >
          <Text className="text-ink-soft text-sm font-medium">Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onSave}
          disabled={saving}
          className={`flex-1 py-3 rounded items-center flex-row justify-center gap-1.5 ${
            saving ? "bg-rust-muted" : "bg-rust"
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
      <Text className="text-xs font-medium text-ink-soft">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((opt) => {
          const selected = opt === value;
          return (
            <TouchableOpacity
              key={opt}
              onPress={() => onSelect(opt)}
              className={`px-3 py-1.5 rounded-full border ${
                selected
                  ? "bg-rust border-rust"
                  : "bg-surface border-edge"
              }`}
            >
              <Text
                className={`text-xs font-medium capitalize ${
                  selected ? "text-white" : "text-ink-soft"
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
      <Text className="text-xs font-medium text-ink-soft">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.inkFaint}
        autoCapitalize="none"
        className="border border-edge rounded px-3 py-2.5 text-ink text-sm bg-surface"
      />
    </View>
  );
}

// ── TagPill ───────────────────────────────────────────────────────────────────

type Hue = "sky" | "indigo" | "violet" | "amber" | "emerald" | "rose";

const hueStyles: Record<Hue, { bg: string; text: string }> = {
  sky:     { bg: "bg-chip-sky",     text: "text-chip-sky-ink"     },
  indigo:  { bg: "bg-chip-teal",  text: "text-chip-teal-ink"  },
  violet:  { bg: "bg-chip-plum",  text: "text-chip-plum-ink"  },
  amber:   { bg: "bg-chip-brass",   text: "text-chip-brass-ink"   },
  emerald: { bg: "bg-chip-olive", text: "text-chip-olive-ink" },
  rose:    { bg: "bg-chip-rust",    text: "text-chip-rust-ink"    },
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
