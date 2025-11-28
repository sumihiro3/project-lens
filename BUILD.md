# ProjectLens ビルドガイド

## プロダクションビルド

### 方法1: npmスクリプトを使用（推奨）

```bash
npm run build:release
```

このコマンドは以下を実行します：
1. Nuxtアプリケーションの静的ファイルを生成
2. Tauriアプリケーションをビルド
3. 配布ファイルを `dist/vX.Y.Z/` ディレクトリに整理

### 方法2: 手動ビルド

```bash
# 基本的なビルド
npm run tauri:build

# または直接Tauriコマンドを実行
npm run generate
npx tauri build
```

## 出力ファイル

### 自動整理（`npm run build:release`使用時）

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

### 標準出力（`npm run tauri:build`使用時）

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
   npm install
   ```

2. キャッシュをクリア:
   ```bash
   rm -rf node_modules/.cache
   rm -rf src-tauri/target
   ```

### カスタムアイコンが反映されない

プロダクションビルドでは `TrayIconTemplate.png` が正しく読み込まれます。開発環境（`npm run tauri:dev`）ではデフォルトアイコンが使用されます。

## 配布

### macOS

- **DMG**: ユーザーはDMGをマウントしてアプリケーションフォルダにドラッグ＆ドロップ
- **App Bundle (ZIP)**: 解凍後、アプリケーションフォルダに移動

### 署名とノータリゼーション（将来）

macOSで配布する場合、Apple Developer IDで署名し、ノータリゼーションを行うことを推奨します。

詳細は[Tauriドキュメント](https://tauri.app/v1/guides/distribution/sign-macos)を参照してください。
