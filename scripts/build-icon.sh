#!/bin/sh
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MASTER="$ROOT/Assets/AppIcon-1024.png"
ICONSET="$ROOT/Assets/AppIcon.iconset"
ICNS="$ROOT/Assets/AppIcon.icns"

if [ ! -f "$MASTER" ]; then
  echo "Missing master icon: $MASTER" >&2
  exit 1
fi

rm -rf "$ICONSET"
mkdir -p "$ICONSET"

for spec in \
  "16:icon_16x16.png" \
  "32:icon_16x16@2x.png" \
  "32:icon_32x32.png" \
  "64:icon_32x32@2x.png" \
  "128:icon_128x128.png" \
  "256:icon_128x128@2x.png" \
  "256:icon_256x256.png" \
  "512:icon_256x256@2x.png" \
  "512:icon_512x512.png" \
  "1024:icon_512x512@2x.png"
do
  size="${spec%%:*}"
  name="${spec#*:}"
  sips -z "$size" "$size" "$MASTER" --out "$ICONSET/$name" >/dev/null
done

iconutil -c icns "$ICONSET" -o "$ICNS"
echo "$ICNS"
