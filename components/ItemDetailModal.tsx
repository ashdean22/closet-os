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
  last_worn: string | null;
};

type Props = {
  item: DetailItem | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
  onDescriptionUpdated: (id: string, description: string) => void;
};

// ── Modal ─────────────────────────────────────────────────────────────────────

export default function ItemDetailModal({
  item,
  onClose,
  onDeleted,
  onDescriptionUpdated,
}: Props) {
  const insets = useSafeAreaInsets();
  const [draftDescription, setDraftDescription] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Sync local state when a new item is opened.
  // BUG 2 FIX: also reset `deleting` here. The Modal stays mounted when
  // hidden (visible=false), so state from a previous delete persists.
  // Without this reset, the Delete button renders as disabled ("Deleting…")
  // on every subsequent item opened after a successful delete.
  useEffect(() => {
    if (item) {
      setDraftDescription(item.description ?? "");
      setEditing(false);
      setDeleting(false);
    }
  }, [item?.id]);

  if (!item) return null;

  // ── description save ───────────────────────────────────────────────────────

  const handleSaveDescription = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("items")
        .update({ description: draftDescription.trim() })
        .eq("id", item.id);

      if (error) {
        Alert.alert("Save failed", error.message);
      } else {
        // NOTE: the embedding was generated from the OLD description. Updating
        // the text here does NOT regenerate the vector. Re-embedding on
        // description edit is a future improvement.
        onDescriptionUpdated(item.id, draftDescription.trim());
        setEditing(false);
      }
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
    // BUG 2 FIX: use try/finally so `deleting` always resets to false,
    // even on the success path. Previously the success branch called
    // onClose() and returned without resetting, leaving deleting=true
    // permanently in the still-mounted (but hidden) component.
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
      // Runs after both success and error so the button never stays stuck.
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
      {/*
       * BUG 1 FIX: KeyboardAvoidingView pushes the ScrollView up by the
       * keyboard height when the description TextInput is focused.
       * behavior="padding" is correct for iOS modals; "height" for Android.
       */}
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

        {/*
         * keyboardShouldPersistTaps="handled" lets touches on buttons
         * (Save / Cancel) register even while the keyboard is open.
         */}
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
            {/* ── Tags ─────────────────────────────────────────────────────── */}
            <View className="gap-2">
              <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Tags
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {item.category        && <TagPill label={item.category}        hue="sky"     />}
                {item.color           && <TagPill label={item.color}           hue="indigo"  />}
                {item.secondary_color && <TagPill label={item.secondary_color} hue="violet"  />}
                {item.formality       && <TagPill label={item.formality}       hue="amber"   />}
                {item.season          && <TagPill label={item.season}          hue="emerald" />}
                {item.material        && <TagPill label={item.material}        hue="rose"    />}
              </View>
            </View>

            {/* ── Description ──────────────────────────────────────────────── */}
            <View className="gap-2">
              <View className="flex-row items-center justify-between">
                <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  Description
                </Text>
                {!editing && (
                  <TouchableOpacity
                    onPress={() => setEditing(true)}
                    className="px-3 py-1 rounded-lg bg-gray-100"
                  >
                    <Text className="text-gray-600 text-xs font-medium">Edit</Text>
                  </TouchableOpacity>
                )}
              </View>

              {editing ? (
                <View className="gap-2">
                  <TextInput
                    value={draftDescription}
                    onChangeText={setDraftDescription}
                    multiline
                    autoFocus
                    scrollEnabled={false}
                    className="border border-gray-200 rounded-xl p-3 text-gray-800 text-sm leading-5 bg-gray-50"
                    style={{ minHeight: 80, textAlignVertical: "top" }}
                  />
                  <View className="flex-row gap-2">
                    <TouchableOpacity
                      onPress={() => {
                        setDraftDescription(item.description ?? "");
                        setEditing(false);
                      }}
                      className="flex-1 py-2.5 rounded-xl border border-gray-200 items-center"
                    >
                      <Text className="text-gray-500 text-sm font-medium">Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleSaveDescription}
                      disabled={saving}
                      className={`flex-1 py-2.5 rounded-xl items-center flex-row justify-center gap-1.5 ${
                        saving ? "bg-indigo-300" : "bg-indigo-600"
                      }`}
                    >
                      {saving && <ActivityIndicator size="small" color="white" />}
                      <Text className="text-white text-sm font-semibold">Save</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <Text className="text-gray-700 text-sm leading-6">
                  {item.description ?? (
                    <Text className="text-gray-400 italic">No description</Text>
                  )}
                </Text>
              )}
            </View>

            {/* ── Worn info ─────────────────────────────────────────────────── */}
            {item.last_worn && (
              <Text className="text-gray-400 text-xs">
                Last worn:{" "}
                {new Date(item.last_worn).toLocaleDateString(undefined, {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </Text>
            )}

            {/* ── Delete ───────────────────────────────────────────────────── */}
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
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
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
