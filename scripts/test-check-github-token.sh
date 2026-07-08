#!/bin/bash
# test-check-github-token.sh — tests for the failure-detection paths in check-github-token.sh
#
# Stubs curl and jq via PATH injection so no real network calls are made.
# Each test checks the expected exit code and a key phrase in stderr.
#
# Usage:
#   bash scripts/test-check-github-token.sh
#
# Exit codes:
#   0 — all tests passed
#   1 — one or more tests failed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_TOKEN="$SCRIPT_DIR/check-github-token.sh"
PASS=0
FAIL=0

# ---------------------------------------------------------------------------
# run_test <name> <expected_exit> <stderr_phrase> [NAME=VALUE ...]
#
# Stubs are controlled via env vars:
#   STUB_USER_STATUS  — HTTP status for GET /user         (default: 200)
#   STUB_REPO_STATUS  — HTTP status for GET /repos/…      (default: 200)
#   STUB_PUSH         — value of permissions.push in repo response (default: true)
# ---------------------------------------------------------------------------
run_test() {
  local name="$1"
  local expected_exit="$2"
  local grep_phrase="$3"
  shift 3

  local tmp
  tmp=$(mktemp -d)

  # --- stub: curl -----------------------------------------------------------
  # Determines which call is being made by inspecting the URL argument.
  # Writes a minimal JSON body to the -o file and prints the status code.
  cat > "$tmp/curl" << 'STUB'
#!/bin/bash
# Parse curl args: track prev arg to capture -o value and the trailing URL.
output_file=""
url=""
prev=""
for arg in "$@"; do
  case "$prev" in
    -o) output_file="$arg" ;;
  esac
  case "$arg" in
    http*|https*) url="$arg" ;;
  esac
  prev="$arg"
done

if [[ "$url" == *"api.github.com/user"* ]]; then
  status="${STUB_USER_STATUS:-200}"
  if [ -n "$output_file" ]; then
    printf '{"login":"testuser"}' > "$output_file"
  fi
elif [[ "$url" == *"/repos/"* ]]; then
  status="${STUB_REPO_STATUS:-200}"
  if [ -n "$output_file" ]; then
    push_val="${STUB_PUSH:-true}"
    printf '{"full_name":"golbody/golbody-landing","permissions":{"push":%s,"pull":true}}' \
      "$push_val" > "$output_file"
  fi
else
  status="200"
fi

printf '%s' "$status"
exit 0
STUB

  # --- stub: jq -----------------------------------------------------------
  # Supports the two filter patterns used by check-github-token.sh:
  #   jq -r '.login' <file>
  #   jq -r '.permissions.push // false' <file>
  cat > "$tmp/jq" << 'STUB'
#!/bin/bash
# Called as: jq -r '<filter>' <file>
filter="$2"
file="$3"
content=$(cat "$file" 2>/dev/null || echo '{}')

case "$filter" in
  '.login')
    echo "$content" | grep -o '"login":"[^"]*"' | head -1 | sed 's/"login":"//;s/"//'
    ;;
  '.permissions.push // false')
    echo "$content" | grep -o '"push":[^,}]*' | head -1 | sed 's/"push"://' | tr -d ' '
    ;;
  *)
    echo "null"
    ;;
esac
exit 0
STUB

  chmod +x "$tmp/curl" "$tmp/jq"

  local stderr_file
  stderr_file=$(mktemp)
  local actual_exit=0

  # -u GITHUB_TOKEN / -u GITHUB_PAT ensure neither leaks from the outer shell;
  # per-test overrides supplied via "$@" can then re-set them.
  env \
    -u GITHUB_TOKEN \
    -u GITHUB_PAT \
    "$@" \
    PATH="$tmp:$PATH" \
    bash "$CHECK_TOKEN" 2>"$stderr_file" || actual_exit=$?

  local stderr_content
  stderr_content=$(cat "$stderr_file")
  rm -rf "$tmp" "$stderr_file"

  local ok=true

  if [ "$actual_exit" != "$expected_exit" ]; then
    ok=false
    printf '  ✗ exit code: expected %s, got %s\n' "$expected_exit" "$actual_exit"
  fi

  if ! printf '%s' "$stderr_content" | grep -qF "$grep_phrase"; then
    ok=false
    printf '  ✗ stderr missing phrase: %s\n' "$grep_phrase"
    printf '  stderr was:\n%s\n' "$stderr_content"
  fi

  if $ok; then
    PASS=$((PASS + 1))
    printf '  ✓ %s\n' "$name"
  else
    FAIL=$((FAIL + 1))
    printf '  ✗ %s\n' "$name"
  fi
}

# ---------------------------------------------------------------------------
# Test suite
# ---------------------------------------------------------------------------
printf '\n=== check-github-token.sh — failure detection tests ===\n\n'

# 1. No token set
#    Neither GITHUB_TOKEN nor GITHUB_PAT is present.
run_test \
  "no token set — exits 1 with no-token message" \
  1 \
  "No token found" \
  STUB_USER_STATUS=200 \
  STUB_REPO_STATUS=200 \
  STUB_PUSH=true

# 2. Expired / revoked token (GitHub returns HTTP 401 on /user)
run_test \
  "expired/revoked token (HTTP 401) — exits 1 with expired banner" \
  1 \
  "EXPIRED or REVOKED" \
  GITHUB_TOKEN=fake_token_for_testing \
  STUB_USER_STATUS=401 \
  STUB_REPO_STATUS=200 \
  STUB_PUSH=true

# 3. Repository not found (HTTP 404 on /repos/…)
#    /user succeeds (200) but the repo lookup returns 404.
run_test \
  "repo not found (HTTP 404) — exits 1 with not-found message" \
  1 \
  "not found" \
  GITHUB_TOKEN=fake_token_for_testing \
  STUB_USER_STATUS=200 \
  STUB_REPO_STATUS=404 \
  STUB_PUSH=true

# 4. Token lacks push access
#    Both API calls succeed but permissions.push is false in the repo response.
run_test \
  "insufficient push permissions — exits 1 with no-push-access message" \
  1 \
  "does NOT have push access" \
  GITHUB_TOKEN=fake_token_for_testing \
  STUB_USER_STATUS=200 \
  STUB_REPO_STATUS=200 \
  STUB_PUSH=false

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
printf '\n'
if [ "$FAIL" -eq 0 ]; then
  printf 'All %s tests passed.\n\n' "$PASS"
  exit 0
else
  printf '%s/%s tests failed.\n\n' "$FAIL" "$((PASS + FAIL))"
  exit 1
fi
