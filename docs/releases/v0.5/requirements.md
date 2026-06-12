# ProjectLens 課金・ライセンス 要件定義書(v0.5 ドラフト)

> **リリース**: v0.5(フリーミアム課金 + ライセンス管理)
> **ステータス**: ドラフト(着手時に `/refine-requirements v0.5` で確定させること)
> 元ドラフト: AI機能 追加要件定義書(2026-06-12)の「5. 課金・ライセンス」「6. デバイス紐付け」より分離。
> 前提: v0.3〜v0.4(AI 機能)の完了。それまで AI 機能は全面無料開放

## 方針

継続開発のモチベーション維持のため、**フリーミアム + サブスクリプション**を採用。

```
Free(無料)
  ・チケット同期・可視化
  ・ガントチャート・カンバン
  ・複数プロジェクト横断表示
  ・AI 要約(月◯件まで=体験用)

Pro(サブスク)
  ・AI 要約・進捗レポート 無制限
  ・遅延検知・リスクフラグ
  ・週次サマリー自動生成
  ・新モデル対応・優先サポート
```

### 価格帯(想定)

- 月額 ¥500〜¥800 / 年払い ¥4,800〜¥7,200(月換算 ¥400 程度)
- 参考: Backlog の Standard→Premium 差額は月 ¥12,100 以上。価格優位性を訴求

## 決済アーキテクチャ(Stripe + Cloudflare Workers + D1 + Hono)

アプリ内に決済フォームは埋め込まず、**ブラウザで Stripe Checkout を開く**(PCI 準拠・実装簡素化)。
LINE Bot で実績のある Workers + D1 + Hono 構成を流用し、**同一リポジトリ内 `server/` ディレクトリ**(pnpm workspace)に実装する。

```
アプリ「Proにアップグレード」→ Stripe Checkout(ブラウザ)→ 支払い完了
  → Webhook → Workers → ライセンスキー生成 → D1 保存 → メール送付
  → ユーザーがキーをアプリに入力 → サーバー検証 → Pro 解放
```

### 認証方針

自前のユーザー認証・ログイン画面は実装しない。購入は Stripe Checkout、サブスク管理(解約・支払い方法変更・請求書)は **Stripe Customer Portal** に委譲。自前で作るのは「ライセンスキーの発行・検証 API」のみ。

### Webhook(4イベントのみ、署名検証必須)

| イベント                        | 処理                          |
| ------------------------------- | ----------------------------- |
| `checkout.session.completed`    | ライセンスキー生成・発行      |
| `invoice.payment_succeeded`     | 有効期限を延長                |
| `invoice.payment_failed`        | ライセンス一時停止(suspended) |
| `customer.subscription.deleted` | ライセンス無効化(canceled)    |

### データ(最小限・D1)

```sql
CREATE TABLE licenses (
  key             TEXT PRIMARY KEY,  -- PLENS-XXXX-XXXX-XXXX
  stripe_customer TEXT,
  stripe_sub_id   TEXT,
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

決済履歴・請求書・支払い情報は Stripe 側が保持(自前保存しない)。

### Customer Portal URL

ライセンスキーを URL に含めず、ボタン押下時にサーバーで一時セッション URL(数分で失効)を生成して開く。

## デバイス紐付け(使い回し防止)

- デバイスID は `machine-uid` クレートで取得(macOS: ハードウェアUUID)
- 初回アクティベーションでキー + デバイスID をサーバー登録。別デバイス使用中なら 403
- PC 買い替え用の**自己解除の仕組み**(デバイス登録解除の導線)をセットで用意
- **オフライン猶予**: 起動時毎回のオンライン検証はオフライン時に詰むため、最終検証成功から N 日間のグレースピリオドを設ける(計画レビューでの追加考慮)

## 確定時に詰めること

- Free 枠の具体値(月何件まで)と計測方法
- グレースピリオドの日数とキー保存方法(Keychain?)
- v0.3〜v0.4 で無料開放したユーザーへの移行措置(既存ユーザーの扱い)
- Stripe 商品構成(月額/年額)と価格の最終決定
- server/ の デプロイフロー(wrangler)と Stripe Webhook のテスト方法
