#!/bin/bash

# ProjectLens ビルドスクリプト
# 使い方: ./build.sh
#
# 環境変数（任意）:
#   SKIP_AI_SIDECAR=1        AI sidecar のビルド・同梱を明示的にスキップする
#                            （macOS 26 SDK が無い検証機などで使う）
#   TAURI_ENV_TARGET_TRIPLE  externalBin に付与するターゲットトリプルを上書きする
#                            （未指定時は rustc から自動判定）
#   APPLE_SIGNING_IDENTITY   sidecar の codesign に使う署名 ID
#                            （未指定時はアドホック署名 "-" を使用）

set -e

echo "🔨 ProjectLens をビルドしています..."

# バージョン情報を取得
VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
echo "📦 バージョン: $VERSION"

# ----------------------------------------------------------------------------
# AI sidecar (FoundationModels / Swift) のビルド・同梱
#
# tauri.conf.json の bundle.externalBin に "binaries/projectlens-ai-sidecar" を
# 登録しているため、Tauri はビルド時に
#   src-tauri/binaries/projectlens-ai-sidecar-<target-triple>
# という名前の実体を要求する（<target-triple> は rustc のホストトリプル、
# 例: aarch64-apple-darwin）。ここで Swift sidecar をビルドし、その名前で配置・署名する。
#
# ビルド要件: Xcode 26 以上 / macOS 26 SDK（FoundationModels を含む）。
# 検証機（macOS 26 + Apple Intelligence）が無い環境を考慮し、sidecar のビルドに
# 失敗した場合は AI 機能なしでアプリ本体のビルドを継続する（フォールバック）。
# AI 非対応環境でも既存機能はすべて動作するため（NFR-V03-002）、これで問題ない。
# ----------------------------------------------------------------------------

SIDECAR_DIR="src-tauri/sidecar"
BINARIES_DIR="src-tauri/binaries"
SIDECAR_BIN_NAME="projectlens-ai-sidecar"

# externalBin に付与するターゲットトリプルを決定する。
# Tauri と同じく rustc のホストトリプル（例: aarch64-apple-darwin）を使う。
# Swift の triple（arm64-apple-macosx）ではない点に注意。
resolve_target_triple() {
    if [ -n "$TAURI_ENV_TARGET_TRIPLE" ]; then
        echo "$TAURI_ENV_TARGET_TRIPLE"
        return 0
    fi
    if command -v rustc >/dev/null 2>&1; then
        rustc -vV | sed -n 's/^host: //p'
        return 0
    fi
    return 1
}

build_ai_sidecar() {
    if [ "$SKIP_AI_SIDECAR" = "1" ]; then
        echo "⏭️  SKIP_AI_SIDECAR=1 のため AI sidecar のビルドをスキップします。"
        return 1
    fi

    if ! command -v swift >/dev/null 2>&1; then
        echo "⚠️  swift が見つかりません。AI sidecar をスキップします（AI 機能なしで継続）。"
        return 1
    fi

    local triple
    triple=$(resolve_target_triple) || {
        echo "⚠️  ターゲットトリプルを判定できません（rustc 不在）。AI sidecar をスキップします。"
        return 1
    }
    echo "🎯 ターゲットトリプル: $triple"

    echo "🧠 AI sidecar (FoundationModels) をビルドしています..."
    # macOS 26 SDK が無い環境ではここで失敗する。set -e 下でも継続するため
    # サブシェルで実行し、戻り値で判定する。
    if ! ( cd "$SIDECAR_DIR" && swift build -c release ); then
        echo "⚠️  AI sidecar のビルドに失敗しました（macOS 26 SDK が必要）。"
        echo "    AI 機能なしでアプリ本体のビルドを継続します。"
        return 1
    fi

    # swift build の出力（.build/release/projectlens-ai-sidecar）を
    # Tauri が要求するトリプル付きの名前で binaries/ に配置する。
    local built="$SIDECAR_DIR/.build/release/$SIDECAR_BIN_NAME"
    if [ ! -f "$built" ]; then
        echo "⚠️  sidecar のビルド成果物が見つかりません: $built。AI 機能なしで継続します。"
        return 1
    fi

    mkdir -p "$BINARIES_DIR"
    local dest="$BINARIES_DIR/${SIDECAR_BIN_NAME}-${triple}"
    cp "$built" "$dest"
    chmod +x "$dest"
    echo "📂 sidecar を配置しました: $dest"

    # ---- 埋め込みモデルのリソースバンドル同梱（v0.4 / FR-V04-001） -----------
    # Package.swift が Resources/ を .copy で同梱しているため、SwiftPM は
    #   .build/release/projectlens-ai-sidecar_projectlens-ai-sidecar.bundle
    # というリソースバンドルを生成する。multilingual-e5-small（.mlmodelc）は
    # この bundle 内 Resources/ に入る。`Bundle.module` は **実行ファイルの隣** に
    # この .bundle が在ることを前提に解決するため、Tauri が externalBin を配置する
    # 実行ファイルの隣（バンドル後は *.app/Contents/MacOS/）に同名で運ぶ必要がある。
    # ここでは binaries/ にも複製して同梱漏れを防ぐ（Tauri が externalBin と一緒に拾えるよう前段で用意）。
    #
    # 注意（配布サイズ NFR-V04-004）: モデル本体（100〜250MB）を Resources/ に配置すると
    # この .bundle がその分肥大し、最終 .app / .dmg のサイズ増につながる。モデル未配置時は
    # bundle はほぼ空（Resources/README.md のみ）でサイズ増は無い。
    local res_bundle_name="${SIDECAR_BIN_NAME}_${SIDECAR_BIN_NAME}.bundle"
    local res_bundle_src="$SIDECAR_DIR/.build/release/$res_bundle_name"
    if [ -d "$res_bundle_src" ]; then
        local res_bundle_dest="$BINARIES_DIR/$res_bundle_name"
        rm -rf "$res_bundle_dest"
        cp -R "$res_bundle_src" "$res_bundle_dest"
        echo "📦 埋め込みリソースバンドルを配置しました: $res_bundle_dest"
        # モデル本体が含まれるか（同梱状況）を表示し、配布サイズ増の確認に供する。
        if find "$res_bundle_dest" -name '*.mlmodelc' -print -quit | grep -q .; then
            local bundle_size
            bundle_size=$(du -sh "$res_bundle_dest" 2>/dev/null | cut -f1)
            echo "🧬 埋め込みモデルを同梱します（バンドルサイズ: ${bundle_size:-?}。NFR-V04-004: 配布100〜250MB増の確認対象）。"
        else
            echo "ℹ️  埋め込みモデル（.mlmodelc）は未配置です。検索機能は degrade します（Resources/README.md 参照）。"
        fi
    else
        echo "ℹ️  リソースバンドルが見つかりません（$res_bundle_src）。埋め込みモデルなしで継続します。"
    fi

    # codesign で署名する。
    # APPLE_SIGNING_IDENTITY が指定されていればそれを、無ければアドホック署名 "-" を使う。
    # アドホック署名でもローカル / CI でのビルドは通る（配布にはハードンドランタイムでの
    # Developer ID 署名 + notarization が別途必要 → 後述の未解決事項を参照）。
    local identity="${APPLE_SIGNING_IDENTITY:--}"
    echo "🔏 sidecar に codesign します (identity: $identity)..."
    if ! codesign --force --timestamp --options runtime --sign "$identity" "$dest" 2>/dev/null; then
        # --timestamp / --options runtime はアドホック署名では失敗することがあるため、
        # その場合は素のアドホック署名にフォールバックする。
        echo "    ハードンドランタイム付き署名に失敗。アドホック署名にフォールバックします。"
        codesign --force --sign "$identity" "$dest"
    fi
    echo "✅ AI sidecar の準備が完了しました。"

    # ---- 未解決事項: リソースバンドルの .app 同梱（リリース統合・別作業項目） --------
    # Tauri の externalBin は「名前付き実行ファイル」のみを *.app/Contents/MacOS/ に運ぶ。
    # 上で binaries/ に複製した埋め込みリソースバンドル
    # （projectlens-ai-sidecar_projectlens-ai-sidecar.bundle）を、最終 .app 内の
    # 実行ファイルの隣（Contents/MacOS/）へ確実に運ぶ結線（tauri.conf.json の resources、
    # または tauri:build 後のフックでのコピー）は別作業項目（リリースビルド統合）で行う。
    # `Bundle.module` は実行ファイルの隣にこの .bundle が在ることを前提に解決するため、
    # 実機での埋め込み動作にはこの同梱結線が必須。詳細は src-tauri/sidecar/README.md を参照。

    # ---- 未解決事項: notarization（検証機依存） -----------------------------
    # 配布用に Apple へ notarization するには、検証機（macOS 26）での以下が必要:
    #   1. Developer ID Application 証明書で署名（APPLE_SIGNING_IDENTITY を指定）
    #   2. .app 全体（sidecar 含む）を Tauri がバンドル後、xcrun notarytool で提出:
    #        xcrun notarytool submit ProjectLens.app.zip \
    #          --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" \
    #          --password "$APPLE_APP_PASSWORD" --wait
    #   3. xcrun stapler staple ProjectLens.app
    # 現時点では検証機未確保のため手順明文化のみ。詳細は src-tauri/sidecar/README.md と
    # BUILD.md を参照。
    return 0
}

# AI sidecar を準備（失敗しても本体ビルドは継続）
if build_ai_sidecar; then
    echo "🟢 AI 機能を同梱してビルドします。"
else
    echo "🟡 AI 機能なしでビルドを継続します。"
fi

# ビルド実行
pnpm run tauri:build

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
