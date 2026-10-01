#!/usr/bin/env bash
# Upload the hosted demo to the demos bucket (demos.maptoolkit.net/legend/).
#
# The page is self-contained: the controls come from npm (jsDelivr), the
# styles from styles.maptoolkit.org. Only index.html is uploaded.
#
# Credentials for the Hetzner Object Storage bucket, never committed:
#   DEMOS_S3_KEY=… DEMOS_S3_SECRET=… demo/hosted/upload.sh
#
# curl signs the requests itself (SigV4) — no S3 tooling needed. The bucket
# proxy resolves no index files, so the page's URL names the file:
#   https://demos.maptoolkit.net/legend/index.html
set -euo pipefail

: "${DEMOS_S3_KEY:?set DEMOS_S3_KEY}"
: "${DEMOS_S3_SECRET:?set DEMOS_S3_SECRET}"
BUCKET_URL="https://mtk-demos-zitnog-kyfwuc-omysv.fsn1.your-objectstorage.com"
PREFIX="legend"

HERE="$(cd "$(dirname "$0")" && pwd)"

put() { # put <local file> <remote name> <content type>
  local file="$1" name="$2" type="$3"
  [ -f "$file" ] || { echo "missing: $file" >&2; exit 1; }
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --user "$DEMOS_S3_KEY:$DEMOS_S3_SECRET" --aws-sigv4 "aws:amz:fsn1:s3" \
    -X PUT -H "Content-Type: $type" -H "Cache-Control: public, max-age=300" --data-binary "@$file" \
    "$BUCKET_URL/$PREFIX/$name")
  echo "$code  $PREFIX/$name  ($type, $(wc -c <"$file") bytes)"
  [ "$code" = "200" ] || exit 1
}

put "$HERE/index.html" index.html "text/html; charset=utf-8"

echo "→ https://demos.maptoolkit.net/$PREFIX/index.html"
