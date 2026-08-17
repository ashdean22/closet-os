import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  COLOR_LABELS,
  COLOR_SWATCHES,
  SEASONS,
  SEASON_LABELS,
  SORT_OPTIONS,
  activeFilterCount,
  colorBucket,
  filtersAreEmpty,
  toggleFilter,
  type Category,
  type ClosetFilters,
  type ColorBucket,
  type Season,
  type SortKey,
} from "../lib/wardrobe";

type CountableItem = {
  category: string | null;
  color: string | null;
  season: string | null;
};

/**
 * Sort + filter controls for the closet grid.
 *
 * Only offers values the wardrobe actually contains — a closet with no dresses
 * shouldn't advertise a Dresses filter that always returns nothing.
 */
export default function ClosetFilterBar({
  items,
  filters,
  sort,
  onChangeFilters,
  onChangeSort,
}: {
  items: CountableItem[];
  filters: ClosetFilters;
  sort: SortKey;
  onChangeFilters: (next: ClosetFilters) => void;
  onChangeSort: (next: SortKey) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const activeCount = activeFilterCount(filters);

  // Counts drive both which chips exist and the "(4)" hint on each one.
  const counts = useMemo(() => {
    const category = new Map<string, number>();
    const color = new Map<string, number>();
    const season = new Map<string, number>();

    for (const item of items) {
      bump(category, item.category ?? "other");
      bump(color, colorBucket(item.color));
      // An all-season piece is available in every weather, so it counts
      // toward each bucket rather than forming its own island.
      if (item.season === "all-season") {
        for (const s of SEASONS) bump(season, s);
      } else if (item.season) {
        bump(season, item.season);
        bump(season, "all-season");
      }
    }
    return { category, color, season };
  }, [items]);

  const availableCategories = CATEGORIES.filter((c) => counts.category.has(c));
  const availableColors = ([...counts.color.keys()] as ColorBucket[]).sort(
    (a, b) => (counts.color.get(b) ?? 0) - (counts.color.get(a) ?? 0),
  );
  const availableSeasons = SEASONS.filter((s) => counts.season.has(s));

  return (
    <View className="gap-3 mb-4">
      {/* ── Sort row + filter toggle ──────────────────────────────────────── */}
      <View className="flex-row items-center gap-2">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingRight: 8 }}
          style={{ flex: 1 }}
        >
          {SORT_OPTIONS.map((option) => (
            <Chip
              key={option.key}
              label={option.label}
              selected={sort === option.key}
              onPress={() => onChangeSort(option.key)}
            />
          ))}
        </ScrollView>

        <TouchableOpacity
          onPress={() => setExpanded((e) => !e)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Hide filters" : "Show filters"}
          className={`px-3 py-1.5 rounded-full border flex-row items-center gap-1 ${
            activeCount > 0
              ? "bg-indigo-600 border-indigo-600"
              : "bg-white border-gray-200"
          }`}
        >
          <Text
            className={`text-xs font-semibold ${
              activeCount > 0 ? "text-white" : "text-gray-600"
            }`}
          >
            Filter{activeCount > 0 ? ` (${activeCount})` : ""}
          </Text>
          <Text
            className={`text-[10px] ${
              activeCount > 0 ? "text-white" : "text-gray-400"
            }`}
          >
            {expanded ? "▲" : "▼"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Filter panel ──────────────────────────────────────────────────── */}
      {expanded && (
        <View className="bg-gray-50 border border-gray-100 rounded-2xl p-3 gap-4">
          <FilterGroup
            title="Type"
            values={availableCategories}
            selected={filters.categories}
            labelFor={(c) => CATEGORY_LABELS[c as Category]}
            countFor={(c) => counts.category.get(c) ?? 0}
            onToggle={(c) =>
              onChangeFilters({
                ...filters,
                categories: toggleFilter(filters.categories, c as Category),
              })
            }
          />

          <FilterGroup
            title="Colour"
            values={availableColors}
            selected={filters.colors}
            labelFor={(c) => COLOR_LABELS[c as ColorBucket]}
            countFor={(c) => counts.color.get(c) ?? 0}
            swatchFor={(c) => COLOR_SWATCHES[c as ColorBucket]}
            onToggle={(c) =>
              onChangeFilters({
                ...filters,
                colors: toggleFilter(filters.colors, c as ColorBucket),
              })
            }
          />

          <FilterGroup
            title="Weather"
            // Said plainly: this reads the season tag, it is not a forecast.
            subtitle="From each item's season tag"
            values={availableSeasons}
            selected={filters.seasons}
            labelFor={(s) => SEASON_LABELS[s as Season]}
            countFor={(s) => counts.season.get(s) ?? 0}
            onToggle={(s) =>
              onChangeFilters({
                ...filters,
                seasons: toggleFilter(filters.seasons, s as Season),
              })
            }
          />

          {!filtersAreEmpty(filters) && (
            <TouchableOpacity
              onPress={() =>
                onChangeFilters({ categories: [], colors: [], seasons: [] })
              }
              className="self-start px-3 py-1.5 rounded-lg bg-white border border-gray-200"
            >
              <Text className="text-gray-600 text-xs font-semibold">
                Clear all filters
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

// ── FilterGroup ───────────────────────────────────────────────────────────────

function FilterGroup({
  title,
  subtitle,
  values,
  selected,
  labelFor,
  countFor,
  swatchFor,
  onToggle,
}: {
  title: string;
  subtitle?: string;
  values: readonly string[];
  selected: readonly string[];
  labelFor: (value: string) => string;
  countFor: (value: string) => number;
  swatchFor?: (value: string) => string;
  onToggle: (value: string) => void;
}) {
  if (values.length === 0) return null;

  return (
    <View className="gap-2">
      <View className="flex-row items-baseline gap-2">
        <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-[10px] text-gray-400">{subtitle}</Text>
        ) : null}
      </View>
      <View className="flex-row flex-wrap gap-2">
        {values.map((value) => (
          <Chip
            key={value}
            label={`${labelFor(value)} ${countFor(value)}`}
            swatch={swatchFor?.(value)}
            selected={selected.includes(value)}
            onPress={() => onToggle(value)}
          />
        ))}
      </View>
    </View>
  );
}

// ── Chip ──────────────────────────────────────────────────────────────────────

function Chip({
  label,
  selected,
  swatch,
  onPress,
}: {
  label: string;
  selected: boolean;
  swatch?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`px-3 py-1.5 rounded-full border flex-row items-center gap-1.5 ${
        selected
          ? "bg-indigo-600 border-indigo-600"
          : "bg-white border-gray-200"
      }`}
    >
      {swatch ? (
        <View
          style={{ backgroundColor: swatch }}
          className="w-3 h-3 rounded-full border border-black/10"
        />
      ) : null}
      <Text
        className={`text-xs font-semibold ${
          selected ? "text-white" : "text-gray-600"
        }`}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}
