# ProjectLens ビルドガイド

## プロダクションビルド

### 方法1: pnpmスクリプトを使用（推奨）

```bash
pnpm run build:release
```

このコマンドは以下を実行します：

1. Nuxtアプリケーションの静的ファイルを生成
2. Tauriアプリケーションをビルド
3. 配布ファイルを `dist/vX.Y.Z/` ディレクトリに整理

### 方法2: 手動ビルド

```bash
# 基本的なビルド
pnpm run tauri:build

# または直接Tauriコマンドを実行
pnpm run generate
pnpm tauri build
```

## 出力ファイル

### 自動整理（`pnpm run build:release`使用時）

配布ファイルは `dist/vX.Y.Z/` ディレクトリに以下の形式で保存されます：

- **macOS DMG**: `ProjectLens-X.Y.Z-macOS.dmg`
- **macOS App Bundle (ZIP)**: `ProjectLens-X.Y.Z-macOS.app.zip`
- **Windows MSI** (将来): `ProjectLens-X.Y.Z-Windows.msi`

例：

```
dist/
└── v0.1.0/
    ├── ProjectLens-0.1.0-macOS.dmg
    └── ProjectLens-0.1.0-macOS.app.zip
```

### 標準出力（`pnpm run tauri:build`使用時）

ビルド成果物は以下のディレクトリに出力されます：

- **macOS**:
  - DMG: `src-tauri/target/release/bundle/dmg/`
  - App Bundle: `src-tauri/target/release/bundle/macos/`
- **Windows**:
  - MSI: `src-tauri/target/release/bundle/msi/`
  - NSIS: `src-tauri/target/release/bundle/nsis/`

## バージョン管理

バージョン番号は `src-tauri/tauri.conf.json` の `version` フィールドで管理されています。

```json
{
  "version": "0.1.0"
}
```

リリース前にこのバージョン番号を更新してください。

## トラブルシューティング

### ビルドが失敗する

1. 依存関係を再インストール:

   ```bash
   pnpm install
   ```

2. キャッシュをクリア:
   ```bash
   rm -rf node_modules/.cache
   rm -rf src-tauri/target
   ```

### カスタムアイコンが反映されない

プロダクションビルドでは `TrayIconTemplate.png` が正しく読み込まれます。開発環境（`pnpm run tauri:dev`）ではデフォルトアイコンが使用されます。

## 配布

### macOS

- **DMG**: ユーザーはDMGをマウントしてアプリケーションフォルダにドラッグ＆ドロップ
- **App Bundle (ZIP)**: 解凍後、アプリケーションフォルダに移動

### 署名とノータリゼーション

macOSで配布する場合、Apple Developer IDで署名し、ノータリゼーションを行うことを推奨します。詳細は[Tauriドキュメント](https://tauri.app/v1/guides/distribution/sign-macos)を参照してください。

## AI sidecar（FoundationModels）の同梱

v0.3 から、オンデバイス AI 推論用の Swift sidecar（`src-tauri/sidecar/`）を `externalBin` として同梱します。

- `tauri.conf.json` の `bundle.externalBin` に `binaries/projectlens-ai-sidecar` を登録しています。
- `build.sh` が `tauri:build` の前に sidecar をビルド・配置・署名します：
  1. `swift build -c release`（`src-tauri/sidecar/`）
  2. 出力を `src-tauri/binaries/projectlens-ai-sidecar-<target-triple>` に配置（`<target-triple>` は rustc のホストトリプル、例 `aarch64-apple-darwin`）
  3. `codesign` で署名（`APPLE_SIGNING_IDENTITY` 未指定時はアドホック署名 `-`）

### ビルド要件

- **Xcode 26 以上 / macOS 26 SDK**（FoundationModels を含む）。
- 上記 SDK が無い環境では sidecar のビルドに失敗しますが、`build.sh` は **AI 機能なしでアプリ本体のビルドを継続**します（AI 非対応環境でも既存機能はすべて動作します）。

### 環境変数

| 変数                      | 用途                                                                            |
| ------------------------- | ------------------------------------------------------------------------------- |
| `SKIP_AI_SIDECAR=1`       | AI sidecar のビルド・同梱を明示的にスキップする                                 |
| `TAURI_ENV_TARGET_TRIPLE` | externalBin に付与するターゲットトリプルを上書き（未指定時 rustc から自動判定） |
| `APPLE_SIGNING_IDENTITY`  | sidecar の codesign に使う署名 ID（未指定時はアドホック署名）                   |

### notarization（未解決事項・検証機依存）

検証機（macOS 26 + Developer ID）が未確保のため、現時点では手順明文化までを完了とします。配布時は Developer ID 署名後、`.app` 全体に対して以下を実施します：

```bash
# 1. APPLE_SIGNING_IDENTITY に Developer ID Application 証明書を指定して build.sh を実行
APPLE_SIGNING_IDENTITY="Developer ID Application: ..." ./build.sh

# 2. Tauri がバンドルした .app（sidecar を含む）を notarytool で提出
xcrun notarytool submit dist/vX.Y.Z/ProjectLens-X.Y.Z-macOS.app.zip \
  --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_PASSWORD" --wait

# 3. staple
xcrun stapler staple "src-tauri/target/release/bundle/macos/ProjectLens.app"
```
