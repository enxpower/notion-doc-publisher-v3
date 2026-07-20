#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <artifact-root>" >&2
  exit 1
fi

artifact_root="$1"

if [ ! -d "$artifact_root" ]; then
  echo "Artifact root does not exist: $artifact_root" >&2
  exit 1
fi

printf 'docs.arcbos.com\n' > "$artifact_root/CNAME"
touch "$artifact_root/.nojekyll"

find "$artifact_root" -type f \( \
  -name '*.typ' -o -name '.env' -o -name '.env.*' \
  -o -iname '*backup*' -o -iname '*audit*' -o -iname '*diagnostic*' \
  -o -path '*/reports/*' -o -path '*/diagnostics/*' \
\) -delete

blocked_count="$(find "$artifact_root" -type f \( \
  -name '*.typ' -o -name '.env' -o -name '.env.*' \
  -o -iname '*backup*' -o -iname '*audit*' -o -iname '*diagnostic*' \
  -o -path '*/reports/*' -o -path '*/diagnostics/*' \
\) | wc -l | tr -d ' ')"
if [ "$blocked_count" != "0" ]; then
  echo "Blocked files remain in ARCBOS Pages artifact: $blocked_count" >&2
  exit 1
fi

secret_match_count="$({ grep -RIE 'github_pat_|gh[pousr]_|ntn_|Bearer[[:space:]]+[A-Za-z0-9._-]{20,}' "$artifact_root" || true; } | wc -l | tr -d ' ')"
if [ "$secret_match_count" != "0" ]; then
  echo "Credential-shaped content blocked from ARCBOS Pages artifact: $secret_match_count" >&2
  exit 1
fi

missing=""
[ -f "$artifact_root/CNAME" ] || missing="$missing CNAME"
[ -f "$artifact_root/.nojekyll" ] || missing="$missing .nojekyll"
[ -f "$artifact_root/assets/arcbos-favicon.svg" ] || missing="$missing assets/arcbos-favicon.svg"
html_count="$(find "$artifact_root" -type f -name '*.html' | wc -l | tr -d ' ')"
if [ "$html_count" = "0" ]; then
  missing="$missing *.html"
fi
if [ -n "$missing" ]; then
  echo "ARCBOS Pages artifact is missing required content:$missing" >&2
  exit 1
fi

html_missing_favicon_ref="$(find "$artifact_root" -type f -name '*.html' -print0 | xargs -0 grep -IL 'arcbos-favicon.svg' 2>/dev/null | wc -l | tr -d ' ')"
if [ "$html_missing_favicon_ref" != "0" ]; then
  echo "ARCBOS Pages artifact HTML is missing arcbos-favicon.svg references: $html_missing_favicon_ref" >&2
  exit 1
fi

echo "ARCBOS Pages artifact prepared and verified: $artifact_root ($html_count HTML file(s), CNAME=docs.arcbos.com, favicon=assets/arcbos-favicon.svg)"
