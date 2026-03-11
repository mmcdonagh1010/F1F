#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/prepare-brand-assets.sh /absolute/path/to/source-image"
  exit 1
fi

src="$1"
workspace_root="/Users/markmcdonagh/Documents/VSCode/F1F_new"
public_dir="$workspace_root/frontend/public"
tmp_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp_dir"
}

trap cleanup EXIT

if [[ ! -f "$src" ]]; then
  echo "Source image not found: $src"
  exit 1
fi

mkdir -p "$public_dir"

width="$(sips -g pixelWidth "$src" 2>/dev/null | awk '/pixelWidth/ {print $2}')"
height="$(sips -g pixelHeight "$src" 2>/dev/null | awk '/pixelHeight/ {print $2}')"

if [[ -z "$width" || -z "$height" ]]; then
  echo "Failed to read image dimensions from: $src"
  exit 1
fi

square_size="$width"
if (( height < width )); then
  square_size="$height"
fi

square_base="$tmp_dir/square-base.png"
sips -s format png -c "$square_size" "$square_size" "$src" --out "$square_base" >/dev/null

resize_square() {
  local size="$1"
  local out="$2"
  sips -z "$size" "$size" "$square_base" --out "$out" >/dev/null
}

resize_cover() {
  local target_w="$1"
  local target_h="$2"
  local out="$3"
  local scaled="$tmp_dir/scaled-${target_w}x${target_h}.png"
  local crop="$tmp_dir/crop-${target_w}x${target_h}.png"
  local current_w current_h scale_w scale_h scale longest

  current_w="$width"
  current_h="$height"
  scale_w=$(( (target_w * 10000 + current_w - 1) / current_w ))
  scale_h=$(( (target_h * 10000 + current_h - 1) / current_h ))
  scale="$scale_w"
  if (( scale_h > scale_w )); then
    scale="$scale_h"
  fi

  longest=$(( (current_w * scale + 9999) / 10000 ))
  if (( current_h > current_w )); then
    longest=$(( (current_h * scale + 9999) / 10000 ))
  fi

  sips -s format png -Z "$longest" "$src" --out "$scaled" >/dev/null
  sips -s format png -c "$target_h" "$target_w" "$scaled" --out "$crop" >/dev/null
  cp "$crop" "$out"
}

resize_square 512 "$public_dir/icon-512.png"
resize_square 192 "$public_dir/icon-192.png"
resize_square 180 "$public_dir/apple-touch-icon.png"
resize_square 64 "$public_dir/favicon-64x64.png"
resize_square 32 "$public_dir/favicon-32x32.png"
resize_square 16 "$public_dir/favicon-16x16.png"
resize_square 512 "$public_dir/logo-mark-512.png"
resize_square 192 "$public_dir/logo-mark-192.png"
resize_cover 1200 630 "$public_dir/og-image.png"

echo "Generated brand assets in $public_dir"
echo "- icon-512.png"
echo "- icon-192.png"
echo "- apple-touch-icon.png"
echo "- favicon-64x64.png"
echo "- favicon-32x32.png"
echo "- favicon-16x16.png"
echo "- logo-mark-512.png"
echo "- logo-mark-192.png"
echo "- og-image.png"