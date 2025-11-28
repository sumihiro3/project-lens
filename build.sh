#!/bin/bash

# ProjectLens ビルドスクリプト
# 使い方: ./build.sh

set -e

echo "🔨 ProjectLens をビルドしています..."

# バージョン情報を取得
VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
echo "📦 バージョン: $VERSION"

# ビルド実行
npm run tauri:build

# 出力ディレクトリを作成
DIST_DIR="dist/v${VERSION}"
mkdir -p "$DIST_DIR"

echo "📂 配布ファイルを整理しています..."

# macOS用のファイルを整理
if [ -d "src-tauri/target/release/bundle/dmg" ]; then
    cp src-tauri/target/release/bundle/dmg/*.dmg "$DIST_DIR/ProjectLens-${VERSION}-macOS.dmg" 2>/dev/null || true
fi

if [ -d "src-tauri/target/release/bundle/macos" ]; then
    # .appバンドルをzip化
    cd src-tauri/target/release/bundle/macos
    zip -r "../../../../../${DIST_DIR}/ProjectLens-${VERSION}-macOS.app.zip" ProjectLens.app
    cd -
fi

# Windows用のファイルを整理（将来用）
if [ -d "src-tauri/target/release/bundle/msi" ]; then
    cp src-tauri/target/release/bundle/msi/*.msi "$DIST_DIR/ProjectLens-${VERSION}-Windows.msi" 2>/dev/null || true
fi

echo "✅ ビルド完了！"
echo "📦 配布ファイル: $DIST_DIR"
ls -lh "$DIST_DIR"
