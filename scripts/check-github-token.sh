#!/bin/bash
# check-github-token.sh
#
# On-demand health-check for the GitHub token used by the post-merge sync.
# Run this any time to verify the token is valid before the next merge.
#
# Usage:
#   bash scripts/check-github-token.sh
#
# Exit codes:
#   0 — token is valid and has push access
#   1 — token is missing, expired, revoked, or lacks required permissions

set -e

TOKEN="${GITHUB_TOKEN:-$GITHUB_PAT}"
REPO="golbody/golbody-landing"

echo ""
echo "=== GitHub Token Health Check ==="
echo ""

# ── 1. Token present? ─────────────────────────────────────────────────────────
if [ -z "$TOKEN" ]; then
  echo "❌  No token found." >&2
  echo "" >&2
  echo "    Neither GITHUB_TOKEN nor GITHUB_PAT is set in your environment." >&2
  echo "" >&2
  echo "    To fix:" >&2
  echo "      1. Go to https://github.com/settings/tokens and create a token" >&2
  echo "         with 'repo' scope (classic) or 'Contents: Read & Write' (fine-grained)." >&2
  echo "      2. Open the Replit Secrets panel and add it as GITHUB_TOKEN." >&2
  echo "" >&2
  exit 1
fi

echo "✔   Token variable is set ($(echo "$TOKEN" | cut -c1-4)…)."

# ── 2. Authenticate against GitHub API ───────────────────────────────────────
HTTP_STATUS=$(curl -s -o /tmp/gh_check_response.json -w "%{http_code}" \
  -H "Authorization: token ${TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/user)

if [ "$HTTP_STATUS" = "401" ]; then
  echo "" >&2
  echo "❌  Token is EXPIRED or REVOKED (HTTP 401)." >&2
  echo "" >&2
  echo "    How to rotate the token:" >&2
  echo "      1. Go to https://github.com/settings/tokens" >&2
  echo "         (fine-grained: https://github.com/settings/tokens?type=beta)" >&2
  echo "      2. Revoke the old token if it still appears in the list." >&2
  echo "      3. Generate a new token with 'repo' scope (classic) or" >&2
  echo "         'Contents: Read & Write' targeting ${REPO} (fine-grained)." >&2
  echo "      4. Open the Replit Secrets panel and update GITHUB_TOKEN" >&2
  echo "         (or GITHUB_PAT) with the new value." >&2
  echo "      5. Re-run this script to confirm, then your next merge will" >&2
  echo "         sync automatically." >&2
  echo "" >&2
  exit 1
fi

if [ "$HTTP_STATUS" != "200" ]; then
  echo "" >&2
  echo "❌  GitHub API returned HTTP ${HTTP_STATUS} — cannot verify token." >&2
  echo "" >&2
  echo "    This may be a temporary network issue or the token may lack" >&2
  echo "    the required scopes. API response:" >&2
  cat /tmp/gh_check_response.json >&2
  echo "" >&2
  echo "    Required scopes: 'repo' (classic) or 'Contents: Read & Write'" >&2
  echo "    targeting ${REPO} (fine-grained)." >&2
  echo "" >&2
  exit 1
fi

# Extract the authenticated login from the response
if command -v jq > /dev/null 2>&1; then
  GH_LOGIN=$(jq -r '.login' /tmp/gh_check_response.json)
else
  GH_LOGIN="(jq not available)"
fi

echo "✔   Token authenticates as: ${GH_LOGIN}"

# ── 3. Check push access to the target repo ──────────────────────────────────
REPO_STATUS=$(curl -s -o /tmp/gh_repo_response.json -w "%{http_code}" \
  -H "Authorization: token ${TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO}")

if [ "$REPO_STATUS" = "404" ]; then
  echo "" >&2
  echo "❌  Repository ${REPO} not found (HTTP 404)." >&2
  echo "" >&2
  echo "    Either the repo doesn't exist or the token lacks read access." >&2
  echo "    Make sure the token was created under the correct GitHub account" >&2
  echo "    and has 'repo' scope (classic) or at least 'Contents: Read'" >&2
  echo "    (fine-grained) for ${REPO}." >&2
  echo "" >&2
  exit 1
fi

if [ "$REPO_STATUS" != "200" ]; then
  echo "" >&2
  echo "❌  Could not read repo metadata (HTTP ${REPO_STATUS})." >&2
  cat /tmp/gh_repo_response.json >&2
  echo "" >&2
  exit 1
fi

echo "✔   Repository ${REPO} is accessible."

# Check the 'permissions.push' field in the repo response
if command -v jq > /dev/null 2>&1; then
  CAN_PUSH=$(jq -r '.permissions.push // false' /tmp/gh_repo_response.json)
  if [ "$CAN_PUSH" != "true" ]; then
    echo "" >&2
    echo "❌  Token does NOT have push access to ${REPO}." >&2
    echo "" >&2
    echo "    The token can read the repo but cannot write to it." >&2
    echo "    To fix:" >&2
    echo "      - Classic token: ensure the 'repo' scope is selected." >&2
    echo "      - Fine-grained token: set 'Contents' permission to 'Read & Write'" >&2
    echo "        and confirm the token targets ${REPO} (not a different repo)." >&2
    echo "" >&2
    exit 1
  fi
  echo "✔   Token has push access to ${REPO}."
else
  echo "ℹ   jq not available — skipping push-permission check."
  echo "    Install jq for a complete permission check."
fi

# ── 4. Summary ────────────────────────────────────────────────────────────────
echo ""
echo "✅  Token is healthy. The post-merge GitHub sync should work correctly."
echo ""
echo "    If the sync still fails, check that the branch name is 'main' and"
echo "    that no branch-protection rules block direct pushes from this token."
echo ""

# Clean up temp files
rm -f /tmp/gh_check_response.json /tmp/gh_repo_response.json

exit 0
