# ProjectLens AI機能 追加要件定義書(v0.3 ドラフト)

> **リリース**: v0.3(ローカルLLMによるAI機能 + フリーミアム課金)
> **ステータス**: ドラフト(`/refine-requirements` での壁打ち前。着手時に要件を確定させること)
> Claude Code 実装ハンドオフ用ドキュメント
> 作成日: 2026-06-12

---

## 0. 概要

Backlog AIアシスタント（2026年3月5日リリース、プレミアム/プラチナプラン限定）に相当する機能を、ProjectLens 上で**ローカルLLM**を用いて実現する。最大の差別化ポイントは以下の3点。

- **ローカル実行・外部送信なし**（プライバシー・セキュリティ優位）
- **複数スペース / 複数プロジェクト横断**（Backlog AIアシスタントはスペース内のみ）
- **全Backlogプランで利用可能**（プレミアム以上への課金が不要）

機能自体はフリーミアムの **Pro 有料機能** として提供する。

---

## 1. LLM 推論バックエンド

### 1.1 アーキテクチャ方針

リアルタイム推論ではなく、**バックグラウンド処理**を基本とする。チケット取得（sync）のタイミングで裏でLLM処理を行い、結果をローカルDBに保存。ユーザーがUIを開いたときには結果が準備済みの状態にする。

```
Backlog API sync
    ↓
SQLite (issues テーブル)
    ↓ 新規・更新チケットを検出 → job_queue に投入
バックグラウンドワーカー
    ↓ LLM 推論
SQLite (ai_results テーブル)
    ↓
Vue UI が読むだけ（高速・即時表示）
```

### 1.2 バックエンド選定

| プラットフォーム  | バックエンド            | モデル形式                   |
| ----------------- | ----------------------- | ---------------------------- |
| 当面（macOS優先） | **Swift sidecar (MLX)** | MLX 形式 (`mlx-community/*`) |
| Windows対応時     | **Candle (Rust)**       | GGUF                         |

**段階的アプローチ**を採用する。

- **フェーズ1**: macOS 向けに Swift sidecar (MLX) で実装。Kodama と同等のモデルダウンロード・推論体験。ただし **Kodama とは連携せず、ProjectLens 内に独立実装**する。
- **フェーズ2**: Windows 対応が現実になった段階で Candle バックエンドを追加。

**重要**: 最初から `LlmInference` trait（インターフェース）でバックエンドを抽象化し、後からバックエンドを差し替え・追加できる設計にしておくこと。

```rust
pub trait LlmInference {
    async fn generate(&self, prompt: &str) -> Result<String>;
    async fn download_model(&self, model_id: &str) -> Result<()>;
}

#[cfg(target_os = "macos")]
mod backend { pub use super::mlx_sidecar::MlxBackend as LlmBackend; }

#[cfg(not(target_os = "macos"))]
mod backend { pub use super::candle::CandleBackend as LlmBackend; }
```

### 1.3 採用見送り（不採用）

- **Ollama**: デーモン管理が必要なため不採用。アプリ完結を優先。
- **Apple FoundationModels**: macOS Tahoe (26) 限定 + Windows 非対応のため、メイン採用は見送り。将来「軽タスクのみ OS 組み込みモデルを使う」選択肢として残す可能性はある。

### 1.4 推奨モデル

日本語性能を重視。Backlog ユーザーは国内が大半（売上の大部分が国内ユーザー）のため、日本語対応を最優先。

| 区分   | モデル             | サイズ目安 |
| ------ | ------------------ | ---------- |
| 軽量   | Qwen2.5 3B (4bit)  | 約2GB      |
| 推奨   | Qwen2.5 7B (4bit)  | 約4GB      |
| 高精度 | Qwen2.5 14B (4bit) | 約8GB      |

---

## 2. モデル管理（ダウンロード方式）

### 2.1 方針

モデルは**アプリ同梱しない**。初回起動時などにダウンロードする。

- Swift sidecar (MLX): MLX Swift の `llm-tool` 相当の仕組みで HuggingFace からダウンロード
- Candle (Rust): `hf-hub` クレートで HuggingFace からダウンロード（`~/.cache/huggingface/hub/` にキャッシュ、2回目以降はスキップ）

### 2.2 初回起動フロー

```
初回起動 → モデル未検出を確認 → セットアップ画面（Vue）
  ・モデル選択（軽量/推奨/高精度）
  ・ダウンロード進捗バー表示（Tauri event で進捗 emit）
  ・Wi-Fi 推奨の注意表示
→ 完了 → 通常起動
```

進捗は Rust backend から `window.emit("download-progress", {...})` でフロントへ通知。

---

## 3. AI 機能ユースケース

Backlog AIアシスタントの公式プロンプト集（25種）をローカル実現度で分類した結果。**18/25 がローカルで十分実現可能**。

### 3.1 実装優先度：高（ローカルで確実に実現可能 + 差別化に寄与）

- **遅延リスク課題の抽出 + アクションプラン**（SQL抽出 + LLM整形、バックグラウンド処理向き）
- **複数プロジェクト横断の状況把握 / 分析**（ProjectLens 最大の優位点）
- **課題の背景・決定事項の要約**（LLM の得意領域）
- **マイルストーン別の進捗整理・要約**
- **更新が一定期間止まっている課題の抽出**（SQL一発で可能、軽量）
- **月次 / 週次の活動レポート・サマリー生成**
- **新規参加者向けオンボーディング資料生成**

### 3.2 実装優先度：中（実現可能だが入力データに依存）

- 担当者の自己評価資料の整理（期間指定 + LLM）
- 類似課題・過去エラー事例の検索 + 解決策要約（キーワード検索 or ベクトル検索）
- 海外メンバー向けの英語要約・翻訳
- 課題テンプレート / マニュアルの生成
- 週ごとの作業時間集計（**Backlog に工数データが入力されている場合のみ**）

### 3.3 部分的・精度限定（期待値を下げて提供）

- メンバーのスキル・対応傾向の推論（担当課題数・実績の集計は可能、性格傾向の推論は限定的）
- 業務内容に対する担当候補者の提案

### 3.4 別途検討が必要

- **課題の作成（書き込み）**: Backlog API への**書き込み**が必要。現状の読み取り中心の設計とは別の検討が必要。フェーズを分けて検討する。

---

## 4. データ処理設計

### 4.1 コンテキスト設計（トークン対策）

全課題をそのままLLMに渡さず、**SQLite側で前処理・絞り込み**してから渡す。

```sql
-- 例: 遅延課題の抽出
SELECT project_name, summary, status, due_date, assignee,
       julianday('now') - julianday(due_date) AS overdue_days
FROM issues
WHERE due_date < date('now') AND status != '完了'
ORDER BY overdue_days DESC
LIMIT 50;
```

### 4.2 処理結果の保存スキーマ

```sql
CREATE TABLE ai_results (
  issue_id     TEXT PRIMARY KEY,
  summary      TEXT,        -- 課題の要約
  risk_level   TEXT,        -- high / medium / low
  delay_days   INTEGER,     -- 遅延日数
  suggestion   TEXT,        -- 対応案
  processed_at DATETIME,
  model_used   TEXT         -- 処理に使ったモデル
);

CREATE TABLE job_queue (
  id         INTEGER PRIMARY KEY,
  issue_id   TEXT,
  job_type   TEXT,          -- summarize / risk_check / ...
  status     TEXT,          -- pending / running / done
  created_at DATETIME
);
```

### 4.3 処理トリガー

| タイミング   | 内容                               |
| ------------ | ---------------------------------- |
| sync 直後    | 新規・更新チケットを即キューに投入 |
| アプリ起動時 | 未処理キューがあれば自動再開       |
| 定期実行     | 例: 1時間ごとに差分 sync + 処理    |
| 手動         | 「再分析」ボタン                   |

### 4.4 処理粒度

- **チケット単位**: 1行要約・遅延フラグ・遅延日数・対応提案 → sync のたびに差分処理
- **プロジェクト単位**: 全体進捗サマリー・ボトルネック特定・複数PJ横断把握 → 1日1回まとめて生成

---

## 5. 課金・ライセンス（フリーミアム + サブスク）

### 5.1 方針

継続開発（Backlog API 変更対応・新モデル対応）のモチベーション維持のため、**フリーミアム + サブスクリプション**を採用。

```
Free（無料）
  ・チケット同期・可視化
  ・ガントチャート・カンバン
  ・複数プロジェクト横断表示
  ・AI 要約（月◯件まで＝体験用）

Pro（サブスク）
  ・AI 要約・進捗レポート 無制限
  ・遅延検知・リスクフラグ
  ・週次サマリー自動生成
  ・新モデル対応・優先サポート
```

### 5.2 価格帯（想定）

- 月額 ¥500〜¥800
- 年払い ¥4,800〜¥7,200（月換算 ¥400 程度、割引）
- 参考: Backlog の Standard→Premium アップグレード差額は月 ¥12,100 以上。Pro の価格優位性を訴求できる。

### 5.3 決済アーキテクチャ（Stripe + Cloudflare Workers + D1）

アプリ内に決済フォームは埋め込まない。**ブラウザで Stripe の公式ページを開く**方式（PCI 準拠・実装簡素化）。

```
アプリ「Proにアップグレード」ボタン
  → ブラウザで Stripe Checkout を開く
  → 支払い完了
  → Webhook で Workers に通知
  → ライセンスキー生成 → D1 保存 → メール送付
  → ユーザーがキーをアプリに入力 → サーバー検証 → Pro 解放
```

構成は LINE Bot で利用実績のある **Cloudflare Workers + D1 + Hono** を流用。

### 5.4 認証方針

**自前のユーザー認証・ログイン画面は実装しない**。Stripe の機能に委譲する。

- 購入: Stripe Checkout（メールアドレス入力のみ）
- サブスク管理（解約・支払い方法変更・請求書確認）: **Stripe Customer Portal**（Stripe がメール認証を肩代わり）
- 自前で作るのは「ライセンスキーの発行・検証 API」のみ

### 5.5 Webhook で処理するイベント（4つのみ）

| イベント                        | やること                          |
| ------------------------------- | --------------------------------- |
| `checkout.session.completed`    | ライセンスキー生成・発行          |
| `invoice.payment_succeeded`     | 有効期限を延長                    |
| `invoice.payment_failed`        | ライセンスを一時停止（suspended） |
| `customer.subscription.deleted` | ライセンスを無効化（canceled）    |

Webhook は必ず **Stripe 署名検証**（`stripe.webhooks.constructEvent`）を行うこと。

### 5.6 保存するデータ（最小限）

決済履歴・請求書・支払い情報は **Stripe が保持するため自前保存不要**。自前で持つのはライセンス状態管理のみ。

```sql
CREATE TABLE licenses (
  key             TEXT PRIMARY KEY,  -- PLENS-XXXX-XXXX-XXXX
  stripe_customer TEXT,              -- 顧客ID（照合・Portal生成用）
  stripe_sub_id   TEXT,              -- サブスクID
  status          TEXT,              -- active / suspended / canceled
  expires_at      DATETIME
);

CREATE TABLE activations (
  license_key  TEXT,
  device_id    TEXT,
  activated_at DATETIME,
  PRIMARY KEY (license_key, device_id)
);
```

### 5.7 Customer Portal URL の生成

ライセンスキーは URL に含めない。ボタン押下時にサーバーで**その場限りの一時セッションURL**を生成する。

```
アプリ「プラン管理」ボタン
  → Workers にライセンスキー送信
  → D1 でキー → stripe_customer に変換
  → stripe.billingPortal.sessions.create({ customer })
  → 生成された一時URL（数分で失効）をブラウザで開く
```

---

## 6. ライセンス使い回し防止（デバイス紐付け）

### 6.1 方針

ライセンスキーの使い回しを防ぐため、**デバイスアクティベーション**を実装する。

- デバイスIDは `machine-uid` クレートで取得（macOS: ハードウェアUUID / Windows: MachineGUID）
- 初回アクティベーション時にキー + デバイスIDをサーバー登録
- 既に別デバイスで使用中の場合はエラー（「別のデバイスで使用中です」）
- 起動時に毎回キー + デバイスIDを検証

### 6.2 アクティベーション API

```
POST /activate { key, deviceId }
  → Stripe でサブスク有効性を確認
  → D1 の activations を確認
     ・別デバイスで登録済み → 403 エラー
     ・未登録 → 登録して valid: true
```

### 6.3 デバイス解除（エスケープハッチ）

PC 買い替え対応のため、**自己解除の仕組み**をセットで用意する。Stripe Customer Portal にカスタムリンクなどで「デバイス登録を解除する」導線を設け、D1 から該当 activation レコードを削除して再アクティベーション可能にする。

---

## 7. 実装の進め方（推奨順序）

1. `LlmInference` trait の定義（バックエンド抽象化）
2. Swift sidecar (MLX) バックエンドの実装 + モデルダウンロード
3. バックグラウンド処理基盤（job_queue + ワーカー + ai_results）
4. 優先度「高」のユースケースから実装（遅延リスク抽出・横断要約）
5. 課金基盤（Stripe + Workers + D1 + Webhook + アクティベーション）
6. （将来）Candle バックエンド追加 → Windows 対応
7. （将来）課題作成＝Backlog API 書き込みの検討

---

## 付録: 技術スタックまとめ

| レイヤー          | 技術                                |
| ----------------- | ----------------------------------- |
| デスクトップ      | Tauri                               |
| フロント          | Vue / Nuxt3                         |
| ローカルDB        | SQLite                              |
| LLM (macOS)       | Swift sidecar + MLX                 |
| LLM (Windows将来) | Candle (Rust) + GGUF                |
| モデル配布        | HuggingFace (MLX / hf-hub)          |
| 決済              | Stripe (Checkout + Customer Portal) |
| サーバー          | Cloudflare Workers + D1 + Hono      |
| デバイスID        | machine-uid (Rust)                  |

## その他タスク

> v0.2(開発基盤整備: pnpm 移行・ライブラリ最新化・Dynamic Workflows への移行)として分離した。
> `../v0.2/requirements.md` を参照。
