#!/usr/bin/env bash
# 一键：打包 → 覆盖安装到 /Applications → 启动。
# 用法：pnpm run desktop:install（或直接 ./scripts/desktop-install.sh）
set -euo pipefail
cd "$(dirname "$0")/.."

APP_SRC="release/mac-arm64/Apothecary.app"
APP_DST="/Applications/Apothecary.app"

echo "▶ 打包（tsc + vite + electron-builder --dir）"
pnpm run build
pnpm exec electron-builder --dir

echo "▶ 安装到 /Applications"
# 正在运行的实例会占着旧 bundle，先礼貌退出，退不掉就强杀。
osascript -e 'tell application "Apothecary" to quit' >/dev/null 2>&1 || true
sleep 1
pkill -f "Apothecary.app/Contents/MacOS/Apothecary" 2>/dev/null || true
rm -rf "$APP_DST"
ditto "$APP_SRC" "$APP_DST"

echo "▶ 启动 Apothecary"
open "$APP_DST"
echo "✓ 完成：新版本已安装并启动（启动台同步更新）"
