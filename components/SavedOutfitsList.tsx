import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { colors, fonts, tracking } from "../lib/theme";
import {
  listSavedOutfits,
  renameSavedOutfit,
  deleteSavedOutfit,
  intactCount,
  type SavedOutfit,
  type SavedPiece,
} from "../lib/savedOutfits";

/**
 * The SAVED half of the Outfit tab.
 *
 * Rendered inside the parent ScrollView, so this deliberately uses plain Views
 * rather than a FlatList — nesting a vertical scroller inside another one
 * breaks momentum on Android and clips on iOS. Saved outfits are a handful per
 * user, so there is nothing to virtualise.
 */
export default function SavedOutfitsList({
  refreshKey,
  onFindOutfit,
}: {
  refreshKey: number;
  onFindOutfit: () => void;
}) {
  const [outfits, setOutfits] = useState<SavedOutfit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<SavedOutfit | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setOutfits(await listSavedOutfits());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load saved outfits.");
      setOutfits([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const handleDelete = useCallback(
    (outfit: SavedOutfit) => {
      Alert.alert(
        "Delete this outfit?",
        `"${outfit.name}" will be removed. The clothes stay in your closet.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              // Drop it locally first so the list doesn't sit there looking
              // broken while the round-trip completes; reload on failure.
              setOutfits((prev) => prev?.filter((o) => o.id !== outfit.id) ?? prev);
              try {
                await deleteSavedOutfit(outfit.id);
              } catch {
                load();
              }
            },
          },
        ],
      );
    },
    [load],
  );

  if (outfits === null) {
    return (
      <View className="items-center py-16">
        <ActivityIndicator size="large" color={colors.rust} />
      </View>
    );
  }

  if (error) {
    return (
      <View className="bg-danger-tint border border-danger-edge rounded p-4 gap-3">
        <Text className="text-danger text-sm font-semibold">
          Couldn't load your saved outfits
        </Text>
        <Text className="text-danger text-sm leading-5">{error}</Text>
        <TouchableOpacity onPress={load} className="self-start px-4 py-2 rounded bg-danger-tint">
          <Text className="text-danger text-sm font-semibold">Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (outfits.length === 0) {
    return (
      <View className="items-center py-16 gap-3">
        <Text style={{ fontSize: 36, color: colors.brass }}>{"✦︎"}</Text>
        <Text className="text-ink-soft text-base text-center">
          Nothing saved yet. When the stylist builds a look you like, tap Save
          and it'll wait for you here.
        </Text>
        <TouchableOpacity onPress={onFindOutfit} className="bg-rust px-5 py-3 rounded mt-1">
          <Text className="text-ground text-sm font-semibold">Find an outfit</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="gap-4">
      {outfits.map((outfit) => (
        <SavedCard
          key={outfit.id}
          outfit={outfit}
          onRename={() => setRenaming(outfit)}
          onDelete={() => handleDelete(outfit)}
        />
      ))}

      <RenameModal
        outfit={renaming}
        onClose={() => setRenaming(null)}
        onSaved={(id, name) => {
          setOutfits((prev) =>
            prev?.map((o) => (o.id === id ? { ...o, name } : o)) ?? prev,
          );
          setRenaming(null);
        }}
      />
    </View>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

function SavedCard({
  outfit,
  onRename,
  onDelete,
}: {
  outfit: SavedOutfit;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { kept, total } = intactCount(outfit);
  const missing = total - kept;

  return (
    <View className="bg-surface border border-edge rounded overflow-hidden">
      {/* Header — name, when it was saved, what was asked for */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => setExpanded((e) => !e)}
        className="px-4 pt-4 pb-3 gap-1"
        accessibilityRole="button"
        accessibilityLabel={`${outfit.name}. Tap to ${expanded ? "collapse" : "see the pieces"}`}
      >
        <View className="flex-row items-center gap-2">
          <Text
            style={{
              fontFamily: fonts.deco,
              fontSize: 17,
              letterSpacing: tracking.deco,
              color: colors.ink,
              flex: 1,
            }}
            numberOfLines={1}
          >
            {outfit.name}
          </Text>
          <Text className="text-ink-faint text-xs">{formatDate(outfit.created_at)}</Text>
        </View>

        {outfit.query ? (
          <Text className="text-ink-soft text-sm italic" numberOfLines={1}>
            "{outfit.query}"
          </Text>
        ) : null}

        {/* Only mention missing pieces — "4 of 4" is noise. */}
        {missing > 0 && (
          <Text className="text-notice text-xs font-semibold mt-0.5">
            {kept} of {total} pieces still in your closet
          </Text>
        )}
      </TouchableOpacity>

      {/* Brass hairline, matching the closet cards */}
      <View style={{ height: 1, backgroundColor: colors.brass, opacity: 0.5 }} />

      {expanded ? (
        <View className="p-4 gap-3">
          {outfit.rationale ? (
            <Text className="text-ink-soft text-sm leading-5">{outfit.rationale}</Text>
          ) : null}
          {outfit.pieces.map((piece) => (
            <SavedPieceRow key={piece.id} piece={piece} />
          ))}
        </View>
      ) : (
        <ThumbStrip pieces={outfit.pieces} />
      )}

      {/* Actions */}
      <View className="flex-row border-t border-edge">
        <TouchableOpacity onPress={onRename} className="flex-1 py-3 items-center">
          <Text className="text-teal text-sm font-semibold">Rename</Text>
        </TouchableOpacity>
        <View style={{ width: 1, backgroundColor: colors.edge }} />
        <TouchableOpacity onPress={onDelete} className="flex-1 py-3 items-center">
          <Text className="text-danger text-sm font-semibold">Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** Collapsed preview — just the photos, so a long list stays scannable. */
function ThumbStrip({ pieces }: { pieces: SavedPiece[] }) {
  return (
    <View className="flex-row flex-wrap gap-2 px-4 py-3">
      {pieces.map((piece) =>
        piece.item?.image_url ? (
          <Image
            key={piece.id}
            source={{ uri: piece.item.image_url }}
            style={{ width: 56, height: 56, borderRadius: 4 }}
            resizeMode="cover"
          />
        ) : (
          <View
            key={piece.id}
            style={{ width: 56, height: 56, borderRadius: 4 }}
            className="bg-sunken items-center justify-center"
          >
            <Text className="text-ink-faint text-[9px] text-center px-1">Removed</Text>
          </View>
        ),
      )}
    </View>
  );
}

function SavedPieceRow({ piece }: { piece: SavedPiece }) {
  const item = piece.item;

  return (
    <View className="flex-row gap-3 items-start">
      {item?.image_url ? (
        <Image
          source={{ uri: item.image_url }}
          style={{ width: 64, height: 64, borderRadius: 4 }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={{ width: 64, height: 64, borderRadius: 4 }}
          className="bg-sunken items-center justify-center"
        >
          <Text className="text-ink-faint text-[10px]">Gone</Text>
        </View>
      )}

      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text className="text-ink text-sm font-semibold capitalize">
            {piece.role ?? "Piece"}
          </Text>
          {piece.is_anchor && (
            <View className="px-2 py-0.5 rounded-full bg-rust">
              <Text className="text-ground text-[10px] font-semibold">Your pick</Text>
            </View>
          )}
        </View>

        {item ? (
          <Text className="text-ink-faint text-xs capitalize">
            {[item.color, item.category].filter(Boolean).join(" · ")}
          </Text>
        ) : (
          // The tombstone row: the piece is kept so the outfit doesn't
          // silently shrink, but it's honest about what happened.
          <Text className="text-notice text-xs font-medium">
            No longer in your closet
          </Text>
        )}

        {piece.reason ? (
          <Text className="text-ink-soft text-sm leading-5 mt-0.5">{piece.reason}</Text>
        ) : null}
      </View>
    </View>
  );
}

// ── Rename ────────────────────────────────────────────────────────────────────

function RenameModal({
  outfit,
  onClose,
  onSaved,
}: {
  outfit: SavedOutfit | null;
  onClose: () => void;
  onSaved: (id: string, name: string) => void;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset the field each time a different outfit is opened.
  useEffect(() => {
    setValue(outfit?.name ?? "");
  }, [outfit]);

  const submit = async () => {
    if (!outfit || saving) return;
    const trimmed = value.trim();
    if (!trimmed) return;

    setSaving(true);
    try {
      await renameSavedOutfit(outfit.id, trimmed);
      onSaved(outfit.id, trimmed);
    } catch (err) {
      Alert.alert("Couldn't rename", err instanceof Error ? err.message : "Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={outfit !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View className="flex-1 items-center justify-center px-8 bg-ink/50">
          <View className="w-full bg-surface rounded p-5 gap-4 border border-edge">
            <Text
              style={{
                fontFamily: fonts.deco,
                fontSize: 18,
                letterSpacing: tracking.deco,
                color: colors.ink,
              }}
            >
              Name this outfit
            </Text>

            <TextInput
              value={value}
              onChangeText={setValue}
              autoFocus
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={submit}
              maxLength={60}
              placeholder="e.g. Rainy interview"
              placeholderTextColor={colors.inkFaint}
              style={{
                borderWidth: 1,
                borderColor: colors.edge,
                borderRadius: 4,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 16,
                color: colors.ink,
                backgroundColor: colors.ground,
              }}
            />

            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={onClose}
                className="flex-1 py-3 rounded items-center bg-sunken"
              >
                <Text className="text-ink-soft text-sm font-semibold">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={submit}
                disabled={saving || !value.trim()}
                className={`flex-1 py-3 rounded items-center ${
                  saving || !value.trim() ? "bg-sunken" : "bg-rust"
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    saving || !value.trim() ? "text-ink-faint" : "text-ground"
                  }`}
                >
                  {saving ? "Saving…" : "Save"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
