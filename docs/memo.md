# ProjectLenz - Backlog チケット管理ツール 要件定義書

## 概要

Backlog MCP Server を活用し、ユーザーが属する複数のプロジェクトから関連度の高いチケットを表示・通知するデスクトップアプリケーション **ProjectLenz** (`project-lenz`)。

## 1. ツールの目的・機能

### 主要機能
- **関連度の高いチケットの自動抽出・表示**
- **定期的な自動更新・通知機能**
- **複数プロジェクト対応**
- **バックグラウンド常駐による継続監視**
- **LLMによる優先チケットの要約・対応アドバイス**

### 動作概要
1. 起動時および定期的（1時間毎）にBacklog MCP Server経由でデータを取得
2. スコアリングアルゴリズムで関連度を算出
3. LLMで優先チケットの要約・対応アドバイスを生成
4. チケットに変更があった場合、システム通知でユーザーに知らせる
4. 通知クリックでアプリケーションを表示

## 2. 関連度の高いチケットの定義

### 優先順位（重み付け）
1. **期限** (重み: 40%)
2. **更新日時** (重み: 30%) 
3. **メンション** (重み: 20%)
4. **コメント** (重み: 10%)

### 各要素の判定基準

#### 期限スコア
- 期限切れ: 100点
- 1日以内: 90点
- 3日以内: 70点
- 1週間以内: 50点
- それ以外: 0点

#### 更新スコア
- 1日以内: 100点
- 3日以内: 80点
- 1週間以内: 60点
- 2週間以内: 40点
- 1ヶ月以内: 20点
- それ以外: 0点

#### メンションスコア
- 過去1ヶ月のメンション件数 × 20（最大100点）

#### コメントスコア
- 過去1ヶ月の自分のコメント件数が5件以上: 100点
- 5件未満: 0点

### 総合スコア算出
```
総合スコア = (期限スコア × 0.4) + (更新スコア × 0.3) + (メンションスコア × 0.2) + (コメントスコア × 0.1)
```

## 3. 通知機能

### 通知仕様
- **通知タイミング**: 即座通知 + バッチ処理（1時間毎）の両方をサポート
- **通知方法**: システム通知（macOS / Windows対応）
- **通知内容**: 個別チケットではなく「X件のチケットに更新があります」形式
- **通知アクション**: クリック時にアプリケーションを起動・表示

### 通知制御
- 設定ファイルでON/OFF切り替え可能
- 重複通知防止機能
- バッチ処理頻度は設定で調整可能

## 4. データ管理

### データベース設計（SQLite）

#### テーブル構成
```sql
-- Backlogスペース
CREATE TABLE spaces (
    id INTEGER PRIMARY KEY,
    domain TEXT UNIQUE,
    api_key TEXT,
    display_name TEXT,
    last_updated DATETIME
);

-- プロジェクト
CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    space_id INTEGER,
    backlog_project_id INTEGER,
    key TEXT,
    name TEXT,
    last_updated DATETIME,
    FOREIGN KEY (space_id) REFERENCES spaces(id)
);

-- チケット
CREATE TABLE issues (
    id INTEGER PRIMARY KEY,
    space_id INTEGER,
    project_id INTEGER,
    backlog_issue_id INTEGER,
    key TEXT,
    summary TEXT,
    status_id INTEGER,
    assignee_id INTEGER,
    due_date DATE,
    created DATETIME,
    updated DATETIME,
    FOREIGN KEY (space_id) REFERENCES spaces(id),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- コメント
CREATE TABLE comments (
    id INTEGER PRIMARY KEY,
    issue_id INTEGER,
    space_id INTEGER,
    backlog_comment_id INTEGER,
    user_id INTEGER,
    content TEXT,
    created DATETIME,
    FOREIGN KEY (issue_id) REFERENCES issues(id),
    FOREIGN KEY (space_id) REFERENCES spaces(id)
);

-- メンション
CREATE TABLE mentions (
    id INTEGER PRIMARY KEY,
    comment_id INTEGER,
    space_id INTEGER,
    mentioned_user_id INTEGER,
    FOREIGN KEY (comment_id) REFERENCES comments(id),
    FOREIGN KEY (space_id) REFERENCES spaces(id)
);

-- 設定
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
```

### データ運用
- **保存期間**: 最低1ヶ月分のデータを保持
- **データクリーンアップ**: 古いデータの自動削除
- **差分更新**: 前回取得時刻以降のデータのみ取得
- **初回起動**: 過去1ヶ月分のデータから開始

## 5. LLM機能

### AI要約・アドバイス機能

#### 優先チケット要約
- **日次サマリー**: 関連度の高いチケット群の概要を自然言語で生成
- **緊急度の説明**: なぜそのチケットが優先されるかの理由を明確化
- **作業順序の提案**: 効率的なタスク処理順序をアドバイス

#### 個別チケット対応アドバイス
- **過去事例の参照**: 類似チケットの解決方法を提案
- **担当者の推奨**: 関連知識を持つチームメンバーの提案
- **次のアクション**: 具体的な対応手順の提案

### 対応LLMプロバイダー
- **Claude (Anthropic)**: 推奨（高品質な日本語対応）
- **GPT-4 (OpenAI)**: 代替選択肢
- **Gemini (Google)**: 追加選択肢
- **統一インターフェース**: Mastra経由でプロバイダー切り替えが容易

### プライバシー配慮
- **ローカル処理優先**: 可能な限りローカルで完結
- **データ最小化**: 必要最小限の情報のみをLLMに送信
- **暗号化通信**: API通信時のセキュリティ確保

## 6. 技術仕様

### 技術スタック

#### フロントエンド
- **Electron** (手動統合 or electron-vite) + **Nuxt 3** (最新版)
- **Vue 3** (Composition API) + **TypeScript**
- **Vuetify** (Material Design UI)

#### バックエンド・データ
- **Node.js**
- **SQLite3** + **Drizzle ORM** (TypeScript-first、軽量)
- **@modelcontextprotocol/sdk** (MCP Client)

#### ユーティリティライブラリ
- **Pino**: ログライブラリ（レベル別出力対応）
- **node-notifier**: クロスプラットフォーム通知
- **node-cron**: バッチ処理スケジューリング
- **@mastra/core**: AI Agent フレームワーク（マルチLLM対応）

### MCP統合

#### Backlog MCP Server連携
- **前提条件**: ユーザーが事前にBacklog MCP Serverをインストール済み
  ```bash
  npm install -g @nulab/backlog-mcp-server
  ```
- **接続方式**: 複数方式をサポート
  - グローバルインストール版
  - ローカルビルド版
  - Docker版

#### MCP統合（Mastra内蔵機能使用）
```typescript
// 複数スペース対応のMCP統合
class ProjectLenzMCPManager {
  private mcp: MCPConfiguration;

  async initializeSpaces(spaceConfigs: SpaceConfig[]) {
    const servers = spaceConfigs.reduce((acc, space) => ({
      ...acc,
      [`backlog-${space.id}`]: {
        command: 'backlog-mcp-server',
        env: {
          BACKLOG_DOMAIN: space.domain,
          BACKLOG_API_KEY: space.apiKey,
          ENABLE_TOOLSETS: 'project,issue,notifications'
        }
      }
    }), {});

    this.mcp = new MCPConfiguration({ servers });
  }

  async getUnifiedTools() {
    // 全スペースのツールを統合取得
    return await this.mcp.getTools();
  }
}

// 主要データ取得（MCP経由）
- get_project_list(): プロジェクト一覧取得
- get_issues(): チケット一覧取得
- get_issue_comments(): コメント取得
- get_notifications(): 通知取得
```

### セキュリティ・設定

#### 認証情報管理
- **APIキー**: SQLiteに暗号化して保存
  - Backlog APIキー（各スペース毎）
  - LLM APIキー（Claude/OpenAI/Gemini）
- **設定ファイル保存場所**:
  ```
  ~/.config/projectlenz/
  ├── database.sqlite3
  ├── config.json
  └── logs/
      ├── app.log
      └── error.log
  ```

#### ログ機能
- **ログレベル**: trace, debug, info, warn, error, fatal
- **出力先**: ファイル + コンソール（開発時）
- **設定**: 環境変数でレベル切り替え可能

## 6. 設定項目

### ユーザー設定可能項目
- **Backlog接続設定**
  - 複数スペース対応（スペース毎の設定）
    - ドメイン（example.backlog.com）
    - APIキー
    - 表示名（ユーザー識別用）
  - MCP Server接続方式・パス
- **LLM設定**
  - プロバイダー選択（Claude/OpenAI/Gemini）
  - APIキー（選択したプロバイダー用）
  - 機能の有効/無効（要約、アドバイス）
  - プライバシーレベル（送信データの制限）
  - モデル選択（プロバイダー内での詳細モデル指定）
- **対象プロジェクト**: 各スペース内で監視するプロジェクトの選択
- **スコアリング設定**
  - 期限警告日数（デフォルト: 7日）
  - コメント・メンション集計期間（デフォルト: 1ヶ月）
  - コメント判定最小件数（デフォルト: 5件）
  - 各要素の重み付け比率
- **通知設定**
  - 通知のON/OFF
  - バッチ処理頻度（デフォルト: 1時間）
- **表示設定**
  - 表示件数
  - ソート順
  - フィルター設定

## 7. ユーザーインターフェース

### 主要画面
- **メイン画面**: 関連度順チケットリスト + AI要約表示
- **設定画面**: Backlog・LLM各種設定の変更
- **チケット詳細**: 個別チケットの詳細情報 + AI対応アドバイス
- **ログ表示**: アプリケーションログの確認

### システムトレイ
- **常駐機能**: 最小化時はシステムトレイに格納
- **クイックアクション**: 右クリックメニューで基本操作
- **通知表示**: 新しい更新の件数表示

## 8. 段階的開発アプローチ

### Phase 1: コア機能開発（2-3週間）
- [ ] プロジェクト構築（Electron手動統合 + Nuxt3最新版 + Vuetify）
- [ ] SQLiteデータベース設計・構築（Drizzle ORM）
- [ ] Mastra統合・Backlog MCP Server連携
- [ ] 基本スコアリング機能
- [ ] シンプルなリスト表示UI
- [ ] 設定ファイル管理

### Phase 2: 通知・AI機能（2-3週間）
- [ ] バックグラウンド処理（定期更新）
- [ ] 差分検知・通知システム
- [ ] Mastra統合とMCP連携強化
- [ ] 優先チケット要約機能
- [ ] 個別チケット対応アドバイス機能
- [ ] システムトレイ常駐機能
- [ ] 通知クリック時のアプリ復帰

### Phase 3: UI/UX改善（1-2週間）
- [ ] LLM設定画面UI実装
- [ ] AI要約・アドバイスの表示UI
- [ ] チケット詳細表示画面
- [ ] フィルタ・ソート機能
- [ ] ログ表示画面
- [ ] エラーハンドリング強化

## 9. 制約・前提条件

### 技術的制約
- **Backlog MCP Server必須**: 事前インストールが必要
- **APIレート制限**: Backlog APIの制限に準拠
- **プラットフォーム**: macOS、Windows対応（Linux対応は将来的に検討）

### 運用制約
- **ネットワーク**: インターネット接続必須
- **権限**: Backlog APIアクセス権限が必要
- **プロキシ対応**: 現バージョンでは非対応

## 10. 今後の拡張可能性

### 機能拡張
- プロキシ対応
- チケット作成・編集機能
- チーム機能との連携
- カスタムフィルター機能
- 追加LLMプロバイダー対応（Mastraの新機能追従）

### 他ツール連携
- Slack通知連携（AI要約付き）
- カレンダー連携（期限ベースのスケジューリング）
- 他のMCPサーバー統合

---

**文書作成日**: 2025年8月6日  
**バージョン**: 1.0  
**プロダクト名**: ProjectLenz  
**対象開発ツール**: Claude Code
