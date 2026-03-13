#!/bin/bash
# Alpha Rebrand Script
# Applies Alpha identity on top of the OpenClaw codebase
# Run this after cherry-picking upstream changes to re-apply branding
#
# Usage: bash scripts/rebrand.sh [--dry-run]

set -euo pipefail

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

CHANGED=0

echo "⚡ Alpha Rebrand Script"
echo "======================="
echo ""

if $DRY_RUN; then
  echo "[DRY RUN MODE]"
  echo ""
fi

# 1. CLI Banner
echo "1. CLI Banner & Taglines..."
if [ -f src/cli/banner.ts ] && ! $DRY_RUN; then
  sed -i 's/🦞 OPENCLAW/⚡ ALPHA/g' src/cli/banner.ts
  sed -i 's/🦞/⚡/g' src/cli/banner.ts
  CHANGED=$((CHANGED + 2))
fi

if [ -f src/cli/tagline.ts ] && ! $DRY_RUN; then
  sed -i 's/openclaw/alpha/g' src/cli/tagline.ts
  CHANGED=$((CHANGED + 1))
fi

# 2. CLI Name
echo "2. CLI Name..."
if [ -f src/cli/cli-name.ts ] && ! $DRY_RUN; then
  sed -i 's/"openclaw"/"alpha"/g' src/cli/cli-name.ts
  CHANGED=$((CHANGED + 1))
fi

# 3. Config Paths (surgical — only user-facing constants, not internal variable names)
echo "3. Config Paths..."
if [ -f src/config/paths.ts ] && ! $DRY_RUN; then
  sed -i 's/const NEW_STATE_DIRNAME = ".openclaw"/const NEW_STATE_DIRNAME = ".alpha"/' src/config/paths.ts
  sed -i 's/const NEW_STATE_DIRNAME = ".nicholsbot"/const NEW_STATE_DIRNAME = ".alpha"/' src/config/paths.ts
  sed -i 's/const CONFIG_FILENAME = "openclaw.json"/const CONFIG_FILENAME = "alpha.json"/' src/config/paths.ts
  sed -i 's/const CONFIG_FILENAME = "nicholsbot.json"/const CONFIG_FILENAME = "alpha.json"/' src/config/paths.ts
  sed -i 's/`openclaw-${uid}`/`alpha-${uid}`/' src/config/paths.ts
  sed -i 's/`nicholsbot-${uid}`/`alpha-${uid}`/' src/config/paths.ts
  sed -i 's/: "openclaw";$/: "alpha";/' src/config/paths.ts
  sed -i 's/: "nicholsbot";$/: "alpha";/' src/config/paths.ts
  CHANGED=$((CHANGED + 4))
fi

# 4. Daemon Identity
echo "4. Daemon Identity..."
if [ -f src/daemon/constants.ts ] && ! $DRY_RUN; then
  sed -i 's/openclaw-gateway/alpha-gateway/g' src/daemon/constants.ts
  sed -i 's/nicholsbot-gateway/alpha-gateway/g' src/daemon/constants.ts
  sed -i 's/"openclaw"/"alpha"/g' src/daemon/constants.ts
  sed -i 's/"nicholsbot"/"alpha"/g' src/daemon/constants.ts
  CHANGED=$((CHANGED + 2))
fi

# 5. Workspace Paths
echo "5. Workspace Paths..."
if [ -f src/agents/workspace.ts ] && ! $DRY_RUN; then
  sed -i 's/.openclaw/.alpha/g' src/agents/workspace.ts
  sed -i 's/.nicholsbot/.alpha/g' src/agents/workspace.ts
  CHANGED=$((CHANGED + 1))
fi

# 6. Entry Point (careful: don't rebrand internal module imports)
echo "6. Entry Point..."
if [ -f src/entry.ts ] && ! $DRY_RUN; then
  sed -i 's/wrapperBasename: "openclaw/wrapperBasename: "alpha/g' src/entry.ts
  sed -i 's/wrapperBasename: "nicholsbot/wrapperBasename: "alpha/g' src/entry.ts
  sed -i 's/process\.title = "openclaw"/process.title = "alpha"/g' src/entry.ts
  sed -i 's/process\.title = "nicholsbot"/process.title = "alpha"/g' src/entry.ts
  sed -i 's/\[openclaw\]/[alpha]/g' src/entry.ts
  sed -i 's/\[nicholsbot\]/[alpha]/g' src/entry.ts
  CHANGED=$((CHANGED + 3))
fi

# 7. Gateway
echo "7. Gateway..."
if [ -f src/gateway/server-startup.ts ] && ! $DRY_RUN; then
  # Only user-facing strings, not function names or types
  sed -i 's/loadNicholsBotPlugins/loadAlphaPlugins/g' src/gateway/server-startup.ts 2>/dev/null || true
  CHANGED=$((CHANGED + 1))
fi

# 8. WebChat UI
echo "8. WebChat UI..."
if [ -f ui/index.html ] && ! $DRY_RUN; then
  sed -i 's/OpenClaw/Alpha/g' ui/index.html
  sed -i 's/NicholsBot/Alpha/g' ui/index.html
  sed -i 's/openclaw/alpha/g' ui/index.html
  sed -i 's/nicholsbot/alpha/g' ui/index.html
  CHANGED=$((CHANGED + 2))
fi

echo ""
if $DRY_RUN; then
  echo "Dry run complete. ~$CHANGED replacements would be made."
else
  echo "✅ Rebrand complete. ~$CHANGED replacements made."
  echo ""
  echo "Next steps:"
  echo "  1. Review changes: git diff"
  echo "  2. Test: pnpm build"
  echo "  3. Commit: git add -A && git commit -m 'chore: rebrand to Alpha'"
fi
