# ProjectLens AI sidecar (FoundationModels + 埋め込み)

macOS 26 (Tahoe) 以降の **FoundationModels** フレームワークで課題1件を guided generation
(`@Generable`) で構造化分析し、加えて **multilingual-e5-small (Core ML)** で課題テキストの
埋め込みベクトル (384次元) を生成する常駐プロセス。Tauri 本体 (Rust) から `externalBin` として
同梱され、**JSON Lines over stdin/stdout** で通信する。

- プライバシー: 推論・埋め込みはオンデバイスで完結。チケットデータを外部へ送信しない (NFR-V03-001 / NFR-V04-001)。
- リソース: 入力待ちは `readLine()` によるブロッキング read。アイドル時に CPU を消費しない (NFR-V03-003)。
  埋め込みモデルは初回 `embed` 要求まで遅延ロードし、メモリ常駐を抑制する (NFR-V04-003)。
- 役割分担: 遅延日数・期限切れ判定は **LLM 出力に含めない**。SQL 側で算出する (FR-V03-005)。

## 入出力契約

stdin に **1行 = 1リクエスト** の JSON を書き込み、stdout に **1行 = 1レスポンス** の JSON が返る。
スキーマは Rust 側 `src-tauri/src/ai/mod.rs` の `AiAnalysisInput` / `AiAnalysisOutput`、および
`src-tauri/src/ai/embedding.rs` の `EmbeddingInput` / `EmbeddingOutput` / `EmbedPrefix` と一致させること。

### リクエスト

| type           | フィールド                                                                                   | 説明                                |
| -------------- | -------------------------------------------------------------------------------------------- | ----------------------------------- |
| `availability` | (なし)                                                                                       | 可用性チェック                      |
| `analyze`      | `issue_key`, `summary`, `description_head`, `status`, `due_date`(省略可), `lang`(`ja`/`en`) | 課題1件の分析。本文は呼び出し側で切り詰め済み |
| `embed`        | `texts`(string配列), `prefix`(`query`/`passage`)                                             | 埋め込み生成 (v0.4)。texts は切り詰め済み・**プレフィックス未付与** |
| `shutdown`     | (なし)                                                                                        | 正常終了 (EOF でも終了)             |

```json
{"type":"availability"}
{"type":"analyze","issue_key":"PROJ-1","summary":"ログイン画面の不具合","description_head":"...","status":"処理中","due_date":"2026-06-30","lang":"ja"}
{"type":"embed","texts":["ログイン画面の不具合 ...","認証エラーの調査 ..."],"prefix":"passage"}
{"type":"shutdown"}
```

### レスポンス

```json
{"type":"availability","available":true,"reason":"available"}
{"type":"result","summary":"...","risk_level":"high","suggestion":"..."}
{"type":"embedding","vectors":[[0.01, -0.02, ...384個...], [...]]}
{"type":"error","message":"..."}
```

- `risk_level` は `high` / `medium` / `low`（Rust `RiskLevel` の serde lowercase と一致）。
- `vectors` は入力 `texts` と **同順・同数**。各ベクトルは **384次元 (f32)** で、Rust 側 `EMBEDDING_DIM` と一致する。
  空 `texts` には `{"type":"embedding","vectors":[]}` を返す。
- 可用性 `reason`: `available` / `appleIntelligenceNotEnabled` / `modelNotReady` /
  `deviceNotEligible` / `unavailableOther`。理由別メッセージへのマップは Rust/フロント側で行う (FR-V03-002)。

### 埋め込みプレフィックスの契約（二重付与の防止）

`multilingual-e5-small` は入力先頭に `query: ` / `passage: ` を付与する仕様 (FR-V04-001)。
**プレフィックス付与は本 sidecar が行う**。Rust 側は `embed` 要求の `prefix` フィールドで
どちらを付けるかを渡すだけで、`texts` には付与しない。これにより付与点を sidecar 一箇所に固定し、
Rust と sidecar の双方で付ける「二重付与」を防ぐ。

- Rust 側 `EmbedPrefix::as_str()`（`"query: "` / `"passage: "`）と sidecar の `EmbedPrefix.literal` を一致させること。
- 検索クエリには `prefix=query`、被検索（完了課題コーパス含む）には `prefix=passage` を用いる。

## ビルド

```bash
swift build -c release
# 生成物: .build/release/projectlens-ai-sidecar
```

### ビルド要件

- **Xcode 26 以上 / macOS 26 SDK**（FoundationModels を含む SDK が必須）。
- FoundationModels が無い SDK ではコンパイルできない。本 sidecar は AI 機能専用であり、
  非対応環境では Rust 側が起動しないため、`#if canImport` によるフォールバックは設けない。
- 埋め込みは **CoreML** フレームワーク（Apple 同梱）を使う。SwiftPM の外部依存は追加しない。

### 動作確認 (検証機がある場合)

macOS 26 + Apple Intelligence 有効環境で:

```bash
printf '%s\n' '{"type":"availability"}' \
  '{"type":"analyze","issue_key":"PROJ-1","summary":"テスト","description_head":"本文","status":"処理中","lang":"ja"}' \
  '{"type":"embed","texts":["テスト課題"],"prefix":"passage"}' \
  | ./.build/release/projectlens-ai-sidecar
```

各入力行に対し1行 JSON が返れば契約どおり。埋め込みモデル未配置のときは embed 行に
`{"type":"error","message":"embedding model not bundled ..."}` が返る（プロトコルは成立。下記参照）。

## 埋め込みモデル (multilingual-e5-small) — 配布形式と同梱 (v0.4)

| 項目         | 内容                                                                                  |
| ------------ | ------------------------------------------------------------------------------------- |
| モデル       | `intfloat/multilingual-e5-small`（118M / 384次元 / 100言語・日本語対応）              |
| **配布形式** | **Core ML**（`.mlmodelc`）を採用。Apple 同梱フレームワークで SwiftPM 依存追加が不要、ANE 活用で低メモリ常駐 (NFR-V04-003)。`mlx-swift` 等の外部パッケージは足さない（未解決事項#2 を Core ML で確定） |
| ライセンス   | **MIT**（intfloat / multilingual-e5-small）。配布物に帰属・LICENSE を同梱する         |
| 配置場所     | `Sources/projectlens-ai-sidecar/Resources/`（`Bundle.module` で解決。手順は同 dir の README.md） |
| 配布サイズ   | 100〜250MB 増（NFR-V04-004）。モデル本体は **git に commit しない**（`.gitignore` 除外） |
| 前提         | **Apple Silicon** 前提（NFR-V04-004）。Intel・非対応環境では Rust 側が埋め込みを無効化し embed を送らない |

モデル本体（`MultilingualE5Small.mlmodelc` と語彙ファイル）は `Resources/README.md` の手順で配置する。
`Package.swift` が `Resources/` を `.copy` で同梱対象に登録済みのため、置くだけで `Bundle.module` 経由で
解決される。**モデル未配置でも `swift build` は成功し**、embed 要求には error を返す
（プロトコル完成を優先し、巨大バイナリの commit はリポジトリ肥大回避のため別手順に分離）。

## 検証状況・未解決事項

### 検証済み（macOS 26.3.1 / Apple Intelligence 有効・Apple Silicon）

- **`swift build -c release` 成功**（CoreML / FoundationModels を含む）。
- **JSON 入出力契約の実機確認**: `availability` / `analyze` / `embed`（モデル未配置時の error・空入力の空ベクトル・
  prefix/texts 欠落の入力検証）が各入力1行に対し1行 JSON を返すことを確認。

### 残課題（モデル配置・リリース統合依存）

1. **埋め込みモデルの実配置と入出力結線** — `Resources/README.md` の手順で `MultilingualE5Small.mlmodelc` と
   語彙を配置し、`main.swift` の `EmbeddingModel.embed(_:)` を当該モデルの入出力名
   （`input_ids` / `attention_mask` / `sentence_embedding` 等）+ トークナイズ + mean pooling + L2 正規化に結線する。
   配置後、embed が実 384 次元ベクトルを返すことを確認する。
2. **build.sh への署名・notarization・同梱組み込み** — リリースビルド統合 (別作業項目)。
   `externalBin` 命名規則に従い、ターゲットトリプル付き (例 `projectlens-ai-sidecar-aarch64-apple-darwin`) で
   `src-tauri/binaries/` へ配置し、`tauri.conf.json` の `bundle.externalBin` に登録する。
   モデルを含む配布サイズ増 (100〜250MB / NFR-V04-004) と署名・notarization の実測を行う。
3. **FoundationModels コンテキスト上限の実測** と `CONTEXT_BODY_MAX_CHARS`（Rust 側）の確定。
4. **約3B級モデルでの日本語要約・提案の品質確認**。
5. **e5 トークン上限 (約512) と `EMBED_SOURCE_MAX_CHARS`（Rust 側既定 1800）の対応実測**
   （要件 未解決事項#1: チャンク分割 vs 単一ベクトル。現状は単一ベクトル既定）。
