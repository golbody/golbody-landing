#!/bin/bash
# test-github-sync.sh — automated tests for the token detection paths in post-merge.sh
#
# Stubs curl and git via PATH injection so no real network calls or git operations
# are made.  Each test case checks the expected exit code and a key phrase in stderr.
#
# Usage:
#   bash scripts/test-github-sync.sh
#
# Exit codes:
#   0 — all tests passed
#   1 — one or more tests failed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POST_MERGE="$SCRIPT_DIR/post-merge.sh"
PASS=0
FAIL=0

# ---------------------------------------------------------------------------
# run_test <name> <expected_exit> <stderr_phrase> [NAME=VALUE ...]
#
# Runs post-merge.sh with stubbed external commands.  Any extra arguments are
# forwarded to `env` as environment overrides (e.g. GITHUB_TOKEN=fake).
#
# Stubs are controlled via two env vars:
#   STUB_CURL_STATUS — HTTP status code curl should "return"  (default: 200)
#   STUB_GIT_EXIT   — exit code git push should return        (default: 0)
# ---------------------------------------------------------------------------
run_test() {
  local name="$1"
  local expected_exit="$2"
  local grep_phrase="$3"
  shift 3

  local tmp
  tmp=$(mktemp -d)

  # --- stub: pnpm -----------------------------------------------------------
  # Succeeds silently so the `pnpm install` and `pnpm --filter db push` lines
  # at the top of post-merge.sh do not actually run.
  cat > "$tmp/pnpm" << 'STUB'
#!/bin/bash
exit 0
STUB

  # --- stub: curl -----------------------------------------------------------
  # Prints STUB_CURL_STATUS to stdout — this is what post-merge.sh captures
  # in HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" ...).
  # The real -o /dev/null suppresses body output; our stub produces no body
  # either, so the only stdout is the status code string.
  cat > "$tmp/curl" << 'STUB'
#!/bin/bash
printf '%s' "${STUB_CURL_STATUS:-200}"
exit 0
STUB

  # --- stub: git ------------------------------------------------------------
  # Exits with STUB_GIT_EXIT and, on non-zero, writes a plausible error to
  # stderr so the push-failure banner in post-merge.sh has something to echo.
  cat > "$tmp/git" << 'STUB'
#!/bin/bash
code="${STUB_GIT_EXIT:-0}"
if [ "$code" != "0" ]; then
  echo "error: failed to push some refs to 'github.com/golbody/golbody-landing.git'" >&2
fi
exit "$code"
STUB

  chmod +x "$tmp/pnpm" "$tmp/curl" "$tmp/git"

  local stderr_file
  stderr_file=$(mktemp)
  local actual_exit=0

  # -u GITHUB_TOKEN / -u GITHUB_PAT ensure neither leaks in from the outer
  # shell; per-test overrides supplied via "$@" can then re-set them.
  env \
    -u GITHUB_TOKEN \
    -u GITHUB_PAT \
    "$@" \
    PATH="$tmp:$PATH" \
    bash "$POST_MERGE" 2>"$stderr_file" || actual_exit=$?

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
printf '\n=== post-merge.sh — token detection tests ===\n\n'

# 1. No token set
#    Neither GITHUB_TOKEN nor GITHUB_PAT is present.
#    Expected: exit 1, warning printed to stderr.
run_test \
  "no token set — exits 1 with warning" \
  1 \
  "No GitHub token found" \
  STUB_CURL_STATUS=200 \
  STUB_GIT_EXIT=0

# 2. Expired / revoked token (GitHub returns HTTP 401)
#    Expected: exit 1, "TOKEN EXPIRED OR REVOKED" banner in stderr.
run_test \
  "expired token (HTTP 401) — exits 1 with expired banner" \
  1 \
  "TOKEN EXPIRED OR REVOKED" \
  GITHUB_TOKEN=fake_token_for_testing \
  STUB_CURL_STATUS=401 \
  STUB_GIT_EXIT=0

# 3. Token is healthy (HTTP 200) but git push fails
#    Expected: exit non-zero (propagated from git), sync-failed banner in stderr.
run_test \
  "push failure after healthy token — exits non-zero with sync-failed banner" \
  1 \
  "GITHUB SYNC FAILED" \
  GITHUB_TOKEN=fake_token_for_testing \
  STUB_CURL_STATUS=200 \
  STUB_GIT_EXIT=1

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
