#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# Push to GitHub to keep the repo in sync with every merge
TOKEN="${GITHUB_TOKEN:-$GITHUB_PAT}"
if [ -n "$TOKEN" ]; then
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
