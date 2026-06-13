# ProjectLens AI sidecar (FoundationModels)

macOS 26 (Tahoe) 以降の **FoundationModels** フレームワークを用い、課題1件を
guided generation (`@Generable`) で構造化分析する常駐プロセス。Tauri 本体 (Rust) から
`externalBin` として同梱され、**JSON Lines over stdin/stdout** で通信する。

- プライバシー: 推論はオンデバイスで完結。チケットデータを外部へ送信しない (NFR-V03-001)。
- リソース: 入力待ちは `readLine()` によるブロッキング read。アイドル時に CPU を消費しない (NFR-V03-003)。
- 役割分担: 遅延日数・期限切れ判定は **LLM 出力に含めない**。SQL 側で算出する (FR-V03-005)。

## 入出力契約

stdin に **1行 = 1リクエスト** の JSON を書き込み、stdout に **1行 = 1レスポンス** の JSON が返る。
スキーマは Rust 側 `src-tauri/src/ai/mod.rs` の `AiAnalysisInput` / `AiAnalysisOutput` と一致させること。

### リクエスト

| type           | フィールド                                                                                   | 説明                                |
| -------------- | -------------------------------------------------------------------------------------------- | ----------------------------------- |
| `availability` | (なし)                                                                                       | 可用性チェック                      |
| `analyze`      | `issue_key`, `summary`, `description_head`, `status`, `due_date`(省略可), `lang`(`ja`/`en`) | 課題1件の分析。本文は呼び出し側で切り詰め済み |
| `shutdown`     | (なし)                                                                                        | 正常終了 (EOF でも終了)             |

```json
{"type":"availability"}
{"type":"analyze","issue_key":"PROJ-1","summary":"ログイン画面の不具合","description_head":"...","status":"処理中","due_date":"2026-06-30","lang":"ja"}
{"type":"shutdown"}
```

### レスポンス

```json
{"type":"availability","available":true,"reason":"available"}
{"type":"result","summary":"...","risk_level":"high","suggestion":"..."}
{"type":"error","message":"..."}
```

- `risk_level` は `high` / `medium` / `low`（Rust `RiskLevel` の serde lowercase と一致）。
- 可用性 `reason`: `available` / `appleIntelligenceNotEnabled` / `modelNotReady` /
  `deviceNotEligible` / `unavailableOther`。理由別メッセージへのマップは Rust/フロント側で行う (FR-V03-002)。

## ビルド

```bash
swift build -c release
# 生成物: .build/release/projectlens-ai-sidecar
```

### ビルド要件

- **Xcode 26 以上 / macOS 26 SDK**（FoundationModels を含む SDK が必須）。
- FoundationModels が無い SDK ではコンパイルできない。本 sidecar は AI 機能専用であり、
  非対応環境では Rust 側が起動しないため、`#if canImport` によるフォールバックは設けない。

### 動作確認 (検証機がある場合)

macOS 26 + Apple Intelligence 有効環境で:

```bash
printf '%s\n' '{"type":"availability"}' \
  '{"type":"analyze","issue_key":"PROJ-1","summary":"テスト","description_head":"本文","status":"処理中","lang":"ja"}' \
  | ./.build/release/projectlens-ai-sidecar
```

各入力行に対し1行 JSON が返れば契約どおり。

## 未解決事項 (検証機依存・要対応)

検証機 (macOS 26 + Apple Intelligence) が現時点で未確保のため、以下は手順明文化までを完了とする:

1. **`swift build` 成功確認** — macOS 26 SDK 環境で実施。
2. **サンプル JSON 入出力確認** — 上記「動作確認」の通り。
3. **build.sh への署名・notarization・同梱組み込み** — リリースビルド統合 (別作業項目)。
   `externalBin` 命名規則に従い、ターゲットトリプル付き (例 `projectlens-ai-sidecar-aarch64-apple-darwin`) で
   `src-tauri/binaries/` へ配置し、`tauri.conf.json` の `bundle.externalBin` に登録する。
4. **FoundationModels コンテキスト上限の実測** と `CONTEXT_BODY_MAX_CHARS`（Rust 側）の確定。
5. **約3B級モデルでの日本語要約・提案の品質確認**。
