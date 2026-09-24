#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

fail() {
  printf '{"ok":false,"command":"setup","error":{"code":"%s","message":"%s"}}\n' "$1" "$2"
  exit 1
}

command -v node >/dev/null 2>&1 || fail "NodeMissing" "Node.js 20 or newer is required"
command -v npm >/dev/null 2>&1 || fail "NpmMissing" "npm is required"

node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 20 ] || fail "NodeTooOld" "Node.js 20 or newer is required, found $(node -v)"

lock_hash="$(node -e 'const c=require("crypto"),f=require("fs");process.stdout.write(c.createHash("sha256").update(f.readFileSync("package-lock.json")).digest("hex"))')"
stamp="node_modules/.setup-stamp"
installed="skipped"

if [ ! -f "$stamp" ] || [ "$(cat "$stamp")" != "$lock_hash" ]; then
  npm ci --no-audit --no-fund 1>&2 || fail "InstallFailed" "npm ci failed"
  printf '%s' "$lock_hash" > "$stamp"
  installed="installed"
fi

npm run build --silent 1>&2 || fail "BuildFailed" "npm run build failed"
node dist/cli.js --help >/dev/null || fail "SmokeFailed" "dist/cli.js does not start"

if [ -n "${WIKIMEDIA_CONTACT:-}" ]; then
  contact="set"
else
  contact="default"
  echo "warning: WIKIMEDIA_CONTACT is not set; the default contact https://github.com/RobertUkr is used. Set your own email or URL in a fork." 1>&2
fi

printf '{"ok":true,"command":"setup","node":"%s","dependencies":"%s","contact":"%s","cli":"%s"}\n' \
  "$(node -v)" "$installed" "$contact" "$(pwd)/dist/cli.js"
