#!/bin/bash
# Download static FFmpeg binaries for Tauri sidecar bundling
# Run this script before building for production

set -e

BINARIES_DIR="src-tauri/binaries"
mkdir -p "$BINARIES_DIR"

echo "Downloading static FFmpeg binaries..."

# macOS ARM (Apple Silicon)
if [ ! -f "$BINARIES_DIR/ffmpeg-aarch64-apple-darwin" ]; then
  echo "-> macOS ARM64..."
  curl -L "https://www.osxexperts.net/ffmpeg71arm.zip" -o /tmp/ffmpeg-arm.zip
  unzip -o /tmp/ffmpeg-arm.zip -d /tmp/ffmpeg-arm
  cp /tmp/ffmpeg-arm/ffmpeg "$BINARIES_DIR/ffmpeg-aarch64-apple-darwin"
  chmod +x "$BINARIES_DIR/ffmpeg-aarch64-apple-darwin"
  rm -rf /tmp/ffmpeg-arm /tmp/ffmpeg-arm.zip
  echo "   Done: ffmpeg-aarch64-apple-darwin"
else
  echo "   Skip: ffmpeg-aarch64-apple-darwin (exists)"
fi

# macOS Intel
if [ ! -f "$BINARIES_DIR/ffmpeg-x86_64-apple-darwin" ]; then
  echo "-> macOS x86_64..."
  curl -L "https://www.osxexperts.net/ffmpeg71intel.zip" -o /tmp/ffmpeg-intel.zip
  unzip -o /tmp/ffmpeg-intel.zip -d /tmp/ffmpeg-intel
  cp /tmp/ffmpeg-intel/ffmpeg "$BINARIES_DIR/ffmpeg-x86_64-apple-darwin"
  chmod +x "$BINARIES_DIR/ffmpeg-x86_64-apple-darwin"
  rm -rf /tmp/ffmpeg-intel /tmp/ffmpeg-intel.zip
  echo "   Done: ffmpeg-x86_64-apple-darwin"
else
  echo "   Skip: ffmpeg-x86_64-apple-darwin (exists)"
fi

# Windows x64
if [ ! -f "$BINARIES_DIR/ffmpeg-x86_64-pc-windows-msvc.exe" ]; then
  echo "-> Windows x86_64..."
  curl -L "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -o /tmp/ffmpeg-win.zip
  unzip -o /tmp/ffmpeg-win.zip -d /tmp/ffmpeg-win
  FFMPEG_EXE=$(find /tmp/ffmpeg-win -name "ffmpeg.exe" -type f | head -1)
  if [ -n "$FFMPEG_EXE" ]; then
    cp "$FFMPEG_EXE" "$BINARIES_DIR/ffmpeg-x86_64-pc-windows-msvc.exe"
    echo "   Done: ffmpeg-x86_64-pc-windows-msvc.exe"
  else
    echo "   ERROR: ffmpeg.exe not found in archive"
  fi
  rm -rf /tmp/ffmpeg-win /tmp/ffmpeg-win.zip
else
  echo "   Skip: ffmpeg-x86_64-pc-windows-msvc.exe (exists)"
fi

echo ""
echo "FFmpeg binaries ready in $BINARIES_DIR:"
ls -lh "$BINARIES_DIR"/ffmpeg-* 2>/dev/null || echo "(none found)"
