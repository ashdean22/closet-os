/**
 * Saved outfits — persistence for looks the user wants to keep.
 *
 * Pieces reference items rather than snapshotting them (see the migration in
 * supabase/migrations/20260820000000_saved_outfits.sql for why). The practical
 * consequence for callers: `item` can be null on a piece whose garment was
 * deleted from the closet. That is a normal state, not an error — render it as
 * a missing piece rather than filtering it out, or the outfit silently shrinks.
 */

import { supabase } from "./supabase";

export type SavedPieceItem = {
  id: string;
  image_url: string | null;
  category: string | null;
  color: string | null;
  formality: string | null;
};

export type SavedPiece = {
  id: string;
  item_id: string | null;
  role: string | null;
  reason: string | null;
  is_anchor: boolean;
  position: number;
  /** Null when the garment has since been deleted from the closet. */
  item: SavedPieceItem | null;
};

export type SavedOutfit = {
  id: string;
  name: string;
  query: string | null;
  rationale: string | null;
  created_at: string;
  pieces: SavedPiece[];
};

/** Shape the save RPC expects for each piece. */
export type PieceInput = {
  item_id: string;
  role?: string | null;
  reason?: string | null;
  is_anchor?: boolean;
};

const SELECT = `
  id, name, query, rationale, created_at,
  pieces:saved_outfit_pieces (
    id, item_id, role, reason, is_anchor, position,
    item:items ( id, image_url, category, color, formality )
  )
` as const;

/**
 * Saves a look and returns its new id.
 *
 * Goes through the save_outfit RPC rather than two inserts so a failure
 * part-way can't leave a named outfit with no clothes in it. The RPC also
 * drops any piece the caller doesn't own.
 */
export async function saveOutfit(input: {
  name: string;
  query?: string | null;
  rationale?: string | null;
  pieces: PieceInput[];
}): Promise<string> {
  const { data, error } = await supabase.rpc("save_outfit", {
    p_name: input.name,
    p_query: input.query ?? null,
    p_rationale: input.rationale ?? null,
    p_pieces: input.pieces.map((p) => ({
      item_id: p.item_id,
      role: p.role ?? null,
      reason: p.reason ?? null,
      is_anchor: p.is_anchor ?? false,
    })),
  });

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Save returned no id.");
  return data as string;
}

/** Newest first. Pieces are sorted by their saved position. */
export async function listSavedOutfits(): Promise<SavedOutfit[]> {
  const { data, error } = await supabase
    .from("saved_outfits")
    .select(SELECT)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  // Sorting client-side keeps the query simple and the list is tiny; PostgREST
  // ordering on an embedded resource is easy to get subtly wrong.
  return (data ?? []).map((row) => {
    const r = row as unknown as SavedOutfit;
    return { ...r, pieces: [...(r.pieces ?? [])].sort((a, b) => a.position - b.position) };
  });
}

export async function renameSavedOutfit(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Give the outfit a name.");

  const { error } = await supabase
    .from("saved_outfits")
    .update({ name: trimmed })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function deleteSavedOutfit(id: string): Promise<void> {
  // Pieces go with it via ON DELETE CASCADE on outfit_id.
  const { error } = await supabase.from("saved_outfits").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** How many of a saved outfit's pieces are still in the closet. */
export function intactCount(outfit: SavedOutfit): { kept: number; total: number } {
  const total = outfit.pieces.length;
  const kept = outfit.pieces.filter((p) => p.item !== null).length;
  return { kept, total };
}
