#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# Push to GitHub to keep the repo in sync with every merge
TOKEN="${GITHUB_TOKEN:-$GITHUB_PAT}"
if [ -n "$TOKEN" ]; then
  git push "https://${TOKEN}@github.com/golbody/golbody-landing.git" main
else
  echo "Warning: No GitHub token found (GITHUB_TOKEN or GITHUB_PAT). Skipping GitHub sync." >&2
  exit 1
fi
