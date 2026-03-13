#!/bin/bash
# NicholsBot Rebrand Script
# Applies NicholsBot identity on top of any OpenClaw upstream version
# Run this after merging upstream changes to re-apply branding
#
# Usage: bash scripts/rebrand.sh [--dry-run]

set -euo pipefail

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

CHANGED=0

rebrand_file() {
  local file="$1"
  shift
  if [ ! -f "$file" ]; then
    return
  fi
  for pattern in "$@"; do
    local from="${pattern%%=>*}"
    local to="${pattern##*=>}"
    if grep -q "$from" "$file" 2>/dev/null; then
      if $DRY_RUN; then
        echo "  [dry-run] Would replace '$from' → '$to' in $file"
      else
        sed -i "s|${from}|${to}|g" "$file"
      fi
      CHANGED=$((CHANGED + 1))
    fi
  done
}

echo "🦊 NicholsBot Rebrand Script"
echo "============================="
echo ""

# 1. CLI Banner
echo "1. CLI Banner & Taglines..."
rebrand_file src/cli/banner.ts \
  '🦞 OPENCLAW=>🦊 NICHOLSBOT' \
  '🦞=>🦊'

rebrand_file src/cli/tagline.ts \
  'openclaw=>nicholsbot'

# 2. CLI Name
echo "2. CLI Name..."
rebrand_file src/cli/cli-name.ts \
  "openclaw=>nicholsbot"

# 3. Config Paths (surgical — only user-facing constants, not internal variable names)
echo "3. Config Paths..."
if [ -f src/config/paths.ts ] && ! $DRY_RUN; then
  sed -i 's/const NEW_STATE_DIRNAME = ".openclaw"/const NEW_STATE_DIRNAME = ".nicholsbot"/' src/config/paths.ts
  sed -i 's/const CONFIG_FILENAME = "openclaw.json"/const CONFIG_FILENAME = "nicholsbot.json"/' src/config/paths.ts
  sed -i 's/`openclaw-${uid}`/`nicholsbot-${uid}`/' src/config/paths.ts
  sed -i 's/"openclaw";$/"nicholsbot";/' src/config/paths.ts
  CHANGED=$((CHANGED + 4))
fi

# 4. Daemon Identity  
echo "4. Daemon Identity..."
rebrand_file src/daemon/constants.ts \
  'openclaw-gateway=>nicholsbot-gateway' \
  'openclaw=>nicholsbot'

# 5. Workspace Paths
echo "5. Workspace Paths..."
rebrand_file src/agents/workspace.ts \
  '.openclaw=>.nicholsbot'

# 6. Entry Point (careful: don't rebrand internal module imports like openclaw-exec-env)
echo "6. Entry Point..."
if [ -f src/entry.ts ]; then
  # Only rebrand user-facing strings, not import paths
  if ! $DRY_RUN; then
    sed -i 's/wrapperBasename: "openclaw/wrapperBasename: "nicholsbot/g' src/entry.ts
    sed -i 's/process\.title = "openclaw"/process.title = "nicholsbot"/g' src/entry.ts
    sed -i 's/\[openclaw\]/[nicholsbot]/g' src/entry.ts
  fi
  CHANGED=$((CHANGED + 3))
fi

# 7. Gateway
echo "7. Gateway..."
rebrand_file src/gateway/server-startup.ts \
  'openclaw=>nicholsbot' \
  'OpenClaw=>NicholsBot'

# 8. WebChat UI
echo "8. WebChat UI..."
rebrand_file ui/index.html \
  'OpenClaw=>NicholsBot' \
  'openclaw=>nicholsbot'

# 9. Auto-reply (only user-facing strings, not TypeScript types like OpenClawConfig)
echo "9. Auto-reply Status..."
# Skip — this file imports OpenClawConfig type, rebranding breaks the build

echo ""
if $DRY_RUN; then
  echo "Dry run complete. $CHANGED replacements would be made."
else
  echo "✅ Rebrand complete. $CHANGED replacements made."
  echo ""
  echo "Next steps:"
  echo "  1. Review changes: git diff"
  echo "  2. Test: pnpm build"
  echo "  3. Commit: git add -A && git commit -m 'chore: re-apply NicholsBot rebrand'"
fi
