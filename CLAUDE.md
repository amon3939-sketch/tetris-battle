# テトックス（オンライン対戦テトリス） — CLAUDE.md

> 社内・身内クローズド向けリアルタイム多人数テトリス対戦Webアプリ。アプリ名は「テトックス」。  
> SRS準拠・T-spin・おじゃまブロック・ルーム制対応。テクマナ（社内学習サービス）とのアカウント連携あり。

---

## プロジェクト状態

**最新コミット**: `tetris v8`（Phase 1〜3 すべて完成済み）

- Phase 1（エンジン）: 完成
- Phase 2（サーバー）: 完成
- Phase 3（クライアントUI）: 完成

---

## リポジトリ構造

```
/
├── packages/
│   ├── engine/           # 純粋なゲームエンジン（通信コードなし）
│   │   └── src/
│   │       ├── types.ts        型定義（Cell/Board/Piece/Action/GameState）
│   │       ├── board.ts        盤面操作
│   │       ├── piece.ts        ピース形状定義・PIECE_SHAPES・PIECE_GRID_SIZE
│   │       ├── rotation.ts     SRS回転 + T-spin判定（3-corner rule）
│   │       ├── randomizer.ts   7-bagランダマイザー（seed再現性あり）
│   │       ├── scoring.ts      スコア・攻撃量計算
│   │       ├── engine.ts       GameEngineクラス（フレームベースのゲームループ）
│   │       └── __tests__/     Vitestテスト（board/rotation/tspin/scoring/engine）
│   ├── server/           # Node.js + Express + Socket.io（authoritative server）
│   │   └── src/
│   │       ├── app.ts          Expressサーバー初期化・クライアント静的配信
│   │       ├── room.ts         RoomManager（ルームCRUD・メンバー管理）
│   │       ├── game.ts         ServerGameRoom（各プレイヤーのエンジン管理）
│   │       ├── attack.ts       おじゃまターゲット選択
│   │       ├── db.ts           インメモリDB（ランキング・履歴管理）
│   │       └── events.ts       Socket.ioイベントハンドラ
│   └── client/           # React 18 + Vite + TypeScript + Canvas API
│       └── src/
│           ├── App.tsx               画面遷移管理（lobby/waiting/game/result）
│           ├── socket.ts             Socket.io-client接続管理
│           ├── sounds.ts             BGM + 効果音管理
│           ├── fingerprint.ts        ゲスト識別用ブラウザフィンガープリント
│           ├── PiecePredictor.ts     ゴーストピース位置計算（サーバー非依存）
│           ├── pages/
│           │   ├── LobbyPage.tsx     ニックネーム入力・ルーム一覧・作成/参加
│           │   ├── WaitingPage.tsx   待機室（参加者一覧・ゲーム開始）
│           │   ├── GamePage.tsx      ゲーム画面（876行。ローカルエンジン + サーバー同期）
│           │   └── ResultPage.tsx    結果画面（順位・統計）
│           ├── components/
│           │   ├── GameCanvas.tsx    Canvas描画（メイン盤面）
│           │   ├── HoldBox.tsx       ホールドピース表示
│           │   ├── NextQueue.tsx     ネクスト5個表示
│           │   ├── MiniBoard.tsx     他プレイヤー縮小ビュー
│           │   └── ChatBox.tsx       チャット
│           └── hooks/
│               └── useInputHandler.ts  DAS/ARRキー入力管理
├── files/                # 仕様書（開発参照用）
│   ├── 01_要件定義_基本設計.md
│   ├── 02_Phase1_エンジン仕様書.md
│   ├── 03_Phase2_サーバー仕様書.md
│   └── 04_Phase3_クライアント仕様書.md
├── Dockerfile            # コンテナデプロイ用
├── render.yaml           # Render.comデプロイ設定
├── package.json          # モノレポルート（npm workspaces）
└── tetris.db             # 旧SQLiteファイル（現在は非使用）
```

---

## 開発コマンド

```bash
# 依存関係インストール
npm install

# エンジン単体テスト
cd packages/engine && npx vitest run

# 開発サーバー起動（サーバー側、Hot reload）
npm run dev        # packages/server/src/app.ts を tsx watch で起動 → ポート3001

# クライアント開発サーバー（別ターミナル）
cd packages/client && npx vite    # → ポート5173

# フルビルド
npm run build      # engine → client → server の順でビルド

# ビルド後起動（サーバーがclient/distを静的配信）
npm start          # → http://localhost:3001 でアクセス可
```

---

## 技術スタック

| レイヤー | 技術 |
|----------|------|
| フロントエンド | React 18 + Vite + TypeScript + Canvas API + CSS Modules |
| リアルタイム通信 | Socket.io 4.x |
| バックエンド | Node.js + Express 4.x + TypeScript |
| DB | インメモリ（JS配列）※後述の経緯参照 |
| デプロイ | Render.com（サーバー + クライアント同居）|

---

## 重要な設計決定

### 1. インメモリDBを使用（better-sqlite3は不使用）
- `packages/server/src/db.ts` がすべてJSオブジェクトで実装されている
- **理由**: Render.comのfreeプランでbetter-sqlite3のネイティブモジュールビルドが失敗したため
- サーバー再起動でランキングは消える（許容済み）
- `tetris.db` ファイルは残っているが使われていない

### 2. デュアルエンジン方式（ローカル楽観的更新 + サーバー権威）
- クライアントは `packages/engine/GameEngine` をローカルにも保持して60fps描画
- 入力は `input:action` でサーバーにも送り、`game:state_ack` で差分補正
- **理由**: 通信遅延に関わらず操作をラグなく表示するため
- `GamePage.tsx` の `localEngineRef` と `serverScoreRef` がこの仕組みを管理

### 3. ソロモード対応
- 1人でもゲームを開始できる（テスト・練習用途）
- `App.tsx` の `isSolo` フラグで分岐。ソロ時は脱落判定なしで遊べる

### 4. 静的ファイル同居配信
- `npm run build` 後は `packages/server/dist/app.js` が `packages/client/dist/` を配信
- Render.com上では1サービスで完結（フロント分離デプロイは行っていない）

---

## Socket.ioイベント一覧

### ロビー / ルーム管理
| イベント | 方向 | 説明 |
|---------|------|------|
| `room:create` | C→S | ルーム作成 |
| `room:join` | C→S | ルーム参加 |
| `room:leave` | C→S | 退出・ホスト移譲 |
| `room:list` | S→C | ルーム一覧 |
| `room:state` | S→全員 | 参加者変化通知 |
| `room:error` | S→C | エラー（満員・PW誤り等） |
| `game:backToRoom` | C→S | 試合後に同じルームへ戻る |

### ゲーム制御
| イベント | 方向 | 説明 |
|---------|------|------|
| `game:start` | C→S | ホストのみ送信可 |
| `game:ready` | S→全員 | seed・開始タイムスタンプ配布 |
| `game:over` | S→全員 | 勝者・ランキング確定 |

### テクマナ連携（詳細: files/05_テクマナ連携仕様書.md）
| イベント | 方向 | 説明 |
|---------|------|------|
| `auth:techmana` | C→S | 起動トークン検証依頼（`?tm_token=`付きURLで起動時） |
| `auth:techmana:ok` | S→C | 検証成功。`{userId, name}` を返しニックネーム自動設定 |
| `auth:techmana:error` | S→C | 検証失敗（ゲストとして続行可能） |

環境変数 `TECHMANA_VERIFY_URL` / `TECHMANA_API_KEY` で有効化。テクマナ側の正式API仕様が確定したら `packages/server/src/techmana.ts` を調整する。

### ゲームプレイ（高頻度）
| イベント | 方向 | 説明 |
|---------|------|------|
| `input:action` | C→S | move/rotate/drop/hold |
| `game:state_ack` | S→C | サーバー確定状態（補正用） |
| `board:update` | S→全員 | 縮小表示用差分 |
| `attack:send` | S→全員 | おじゃま送信通知 |
| `attack:receive` | S→C | おじゃまライン適用 |
| `player:ko` | S→全員 | 脱落通知 |
| `chat:send` | C→S | チャット送信 |
| `chat:message` | S→全員 | チャット配信 |

---

## キー操作（デフォルト）

| キー | アクション |
|------|-----------|
| ←/→ | 左右移動 |
| ↑ / Space | ハードドロップ / 時計回り回転 ※GamePage.tsxのDEFAULT_KEY_MAPを参照 |
| ↓ | ソフトドロップ |
| Shift | ホールド |
- キーマップはlocalStorageに保存して変更可能

---

## セルカラー定義

```
0: '#1a1a2e'  空（背景）
1: '#00f0f0'  I: シアン
2: '#f0f000'  O: 黄
3: '#a000f0'  T: 紫
4: '#00f000'  S: 緑
5: '#f00000'  Z: 赤
6: '#0000f0'  J: 青
7: '#f0a000'  L: オレンジ
8: '#808080'  おじゃま: グレー
```

---

## デプロイ（Render.com）

- `render.yaml` に設定済み
- Build: `npm install && npm run build`
- Start: `npm start`
- 環境変数: `PORT`、`CORS_ORIGIN`、`NODE_VERSION=20`
- `/health` エンドポイントでUptimeRobotによる5分間隔pingを推奨（スリープ防止）

---

## 仕様書

詳細仕様は `files/` ディレクトリに格納済み：
- `01_要件定義_基本設計.md` — 要件・技術スタック・DBスキーマ・全イベント定義
- `02_Phase1_エンジン仕様書.md` — SRSキックテーブル・T-spin判定・スコア計算式
- `03_Phase2_サーバー仕様書.md` — RoomManager・ServerGameRoom・DB仕様
- `04_Phase3_クライアント仕様書.md` — 画面レイアウト・Canvas描画・キー操作・デプロイ
