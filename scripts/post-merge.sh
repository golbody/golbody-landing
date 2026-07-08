#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# Push to GitHub to keep the repo in sync with every merge
TOKEN="${GITHUB_TOKEN:-$GITHUB_PAT}"
if [ -n "$TOKEN" ]; then
  # ── Token health-check ────────────────────────────────────────────────────
  # Call the GitHub API before attempting the push.  A 401 means the token is
  # expired or revoked; any other non-2xx means a permission or network issue.
  set +e
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: token ${TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    https://api.github.com/user)
  set -e

  if [ "$HTTP_STATUS" = "401" ]; then
    echo "" >&2
    echo "╔══════════════════════════════════════════════════════════════════╗" >&2
    echo "║  🔑  GITHUB TOKEN EXPIRED OR REVOKED — sync cannot proceed  🔑  ║" >&2
    echo "╚══════════════════════════════════════════════════════════════════╝" >&2
    echo "" >&2
    echo "The token returned HTTP 401 (Unauthorized). It has likely expired" >&2
    echo "or been revoked." >&2
    echo "" >&2
    echo "To rotate the token:" >&2
    echo "  1. Go to https://github.com/settings/tokens" >&2
    echo "     (or https://github.com/settings/tokens?type=beta for fine-grained)" >&2
    echo "  2. Generate a new token with 'repo' (or 'Contents: Read & Write') scope" >&2
    echo "     targeting the golbody/golbody-landing repository." >&2
    echo "  3. Open the Replit Secrets panel and update GITHUB_TOKEN (or GITHUB_PAT)" >&2
    echo "     with the new value." >&2
    echo "  4. Re-run the sync manually once to confirm:" >&2
    echo "     git push https://<NEW_TOKEN>@github.com/golbody/golbody-landing.git main" >&2
    echo "" >&2
    echo "Run scripts/check-github-token.sh at any time to verify token health" >&2
    echo "before the next merge." >&2
    echo "" >&2

    if [ -n "$SLACK_WEBHOOK_URL" ]; then
      SLACK_TEXT=":key: *GolBody GitHub token expired or revoked.* The post-merge sync cannot push to GitHub until the token is rotated. See Replit Secrets → GITHUB_TOKEN."
      if command -v jq > /dev/null 2>&1; then
        PAYLOAD=$(jq -n --arg text "$SLACK_TEXT" '{text: $text}')
      else
        PAYLOAD="{\"text\":\":key: GolBody GitHub token expired or revoked. Update GITHUB_TOKEN in Replit Secrets to restore the sync.\"}"
      fi
      curl -s -X POST "$SLACK_WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD" || echo "Warning: Slack webhook request failed." >&2
    fi

    exit 1
  fi

  if [ "$HTTP_STATUS" != "200" ]; then
    echo "" >&2
    echo "╔═══════════════════════════════════════════════════════════════════╗" >&2
    echo "║  ⚠  GITHUB TOKEN CHECK FAILED (HTTP ${HTTP_STATUS}) — skipping sync  ⚠  ║" >&2
    echo "╚═══════════════════════════════════════════════════════════════════╝" >&2
    echo "" >&2
    echo "The GitHub API returned HTTP ${HTTP_STATUS} when verifying the token." >&2
    echo "This may be a network issue or the token may lack the required scopes." >&2
    echo "" >&2
    echo "Required scopes: 'repo' (classic) or 'Contents: Read & Write' (fine-grained)" >&2
    echo "Run scripts/check-github-token.sh for a detailed diagnosis." >&2
    echo "" >&2
    exit 1
  fi
  # ── Token OK — proceed with the push ─────────────────────────────────────

  # Disable errexit around the push so we can handle the failure ourselves.
  set +e
  PUSH_ERROR=$(git push "https://${TOKEN}@github.com/golbody/golbody-landing.git" main 2>&1)
  PUSH_EXIT=$?
  set -e

  if [ $PUSH_EXIT -ne 0 ]; then
    echo "" >&2
    echo "╔══════════════════════════════════════════════════════════════╗" >&2
    echo "║  ⚠  GITHUB SYNC FAILED — Vercel will not see this merge  ⚠  ║" >&2
    echo "╚══════════════════════════════════════════════════════════════╝" >&2
    echo "" >&2
    echo "git push output:" >&2
    echo "$PUSH_ERROR" >&2
    echo "" >&2
    echo "Action needed: Check GITHUB_TOKEN / GITHUB_PAT, repo permissions," >&2
    echo "or network access, then re-run the GitHub sync manually:" >&2
    echo "  git push https://<TOKEN>@github.com/golbody/golbody-landing.git main" >&2
    echo "" >&2

    if [ -n "$SLACK_WEBHOOK_URL" ]; then
      SLACK_TEXT=":warning: *GolBody GitHub sync failed* after a merge. Vercel has not received the latest code. Check token/permissions and push manually."
      SNIPPET=$(echo "$PUSH_ERROR" | head -3)
      # Build JSON safely with jq to handle quotes, backslashes, etc.
      if command -v jq > /dev/null 2>&1; then
        PAYLOAD=$(jq -n \
          --arg text "$SLACK_TEXT" \
          --arg snippet "$SNIPPET" \
          '{text: ($text + "\nError: `" + $snippet + "`")}')
      else
        # Fallback: omit raw git output to stay valid JSON
        PAYLOAD="{\"text\":\":warning: GolBody GitHub sync failed after a merge. Vercel has not received the latest code. Check token/permissions and push manually.\"}"
      fi
      curl -s -X POST "$SLACK_WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD" || echo "Warning: Slack webhook request failed." >&2
    fi

    exit $PUSH_EXIT
  fi
else
  echo "Warning: No GitHub token found (GITHUB_TOKEN or GITHUB_PAT). Skipping GitHub sync." >&2
  exit 1
fi
