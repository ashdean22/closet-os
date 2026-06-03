#!/usr/bin/env bash
# Backfill embeddings for any items row whose embedding column is NULL.
# Run from the project root:  bash scripts/backfill-embeddings.sh
set -uo pipefail   # removed -e so a failed curl doesn't abort the loop

# Load env vars from .env so we don't hard-code credentials.
if [[ -f .env ]]; then
  set -o allexport
  source .env
  set +o allexport
fi

: "${EXPO_PUBLIC_SUPABASE_URL:?Set EXPO_PUBLIC_SUPABASE_URL in .env}"
: "${EXPO_PUBLIC_SUPABASE_ANON_KEY:?Set EXPO_PUBLIC_SUPABASE_ANON_KEY in .env}"

BASE_URL="$EXPO_PUBLIC_SUPABASE_URL"
ANON_KEY="$EXPO_PUBLIC_SUPABASE_ANON_KEY"

echo "Fetching items with null embedding from $BASE_URL …"

# -f removed so a non-2xx from the REST API is still captured, not swallowed.
ITEMS_JSON=$(curl -s \
  "${BASE_URL}/rest/v1/items?select=id&embedding=is.null" \
  -H "apikey: ${ANON_KEY}" \
  -H "Authorization: Bearer ${ANON_KEY}")

ITEM_IDS=$(echo "$ITEMS_JSON" | python3 -c \
  "import sys, json; ids = [r['id'] for r in json.load(sys.stdin)]; print('\n'.join(ids))" 2>/dev/null || true)

if [[ -z "$ITEM_IDS" ]]; then
  echo "✓ No items need embedding (or REST query failed — raw response below):"
  echo "$ITEMS_JSON"
  exit 0
fi

COUNT=$(echo "$ITEM_IDS" | wc -l | tr -d ' ')
echo "Found $COUNT item(s) to embed."
echo ""

FUNCTION_URL="${BASE_URL}/functions/v1/embed-item"
SUCCESS=0
FAIL=0

while IFS= read -r ITEM_ID; do
  [[ -z "$ITEM_ID" ]] && continue
  echo "── item $ITEM_ID"

  # -w writes the HTTP status code on its own line after the body.
  # -s suppresses the progress meter.
  # No -f, so non-2xx responses are still printed rather than discarded.
  RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "$FUNCTION_URL" \
    -H "Content-Type: application/json" \
    -H "apikey: ${ANON_KEY}" \
    -d "{\"item_id\": \"${ITEM_ID}\"}" 2>&1)

  # Split body and status code.
  BODY="${RESPONSE%$'\nHTTP_STATUS:'*}"
  HTTP_STATUS="${RESPONSE##*HTTP_STATUS:}"

  echo "   status : $HTTP_STATUS"
  echo "   body   : $BODY"

  if [[ "$HTTP_STATUS" == "200" ]]; then
    echo "   result : ✓ success"
    (( SUCCESS++ )) || true
  else
    echo "   result : ✗ FAILED"
    (( FAIL++ )) || true
  fi
  echo ""
done <<< "$ITEM_IDS"

echo "Done — $SUCCESS succeeded, $FAIL failed."
