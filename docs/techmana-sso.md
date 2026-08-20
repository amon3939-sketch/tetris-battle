# テクマナ連携(テトックス)

テトックスのアカウントをテクマナに預け、設定・キー配置・自己ベストが
端末を変えても付いてくるようにする仕組み。

## ぷにぷにとの違い

| | ぷにぷに(chaindrop) | テトックス |
| --- | --- | --- |
| 配信 | クライアントは GitHub Pages、APIは Railway(別オリジン) | 1つの Express が両方を配信(同一オリジン) |
| Cookie | SameSite=None + Secure が必須 | **SameSite=Lax で足りる** |
| CORS | 認証付きで許可オリジンの管理が必要 | **不要**(同一オリジン) |
| APIのベースURL | 絶対URLをクライアントが持つ | **相対パスで足りる** |
| トークンの置き場 | SQLite の `oauth_links` テーブル | **暗号化してセッション Cookie に載せる** |
| 既存アカウント | ID+パスワードと併存 | 既存アカウントが無いのでテクマナのみ |

同一オリジンなので、ぷにぷにで必要だった仕掛けのほとんどが要らない。

## トークンを Cookie に載せている理由

このサーバには永続ストレージが無い。`db.ts` は素の配列で、Railway に
ボリュームも付いていない。つまり **プロセスが再起動すると全部消える**。

そこにトークンを置くと再起動のたびに全員ログアウトになる。かといって
SQLite を足すと、`better-sqlite3` を `node:20-alpine` でネイティブ
ビルドする話になり、Dockerfile の `npm install` が壊れる。

そこでセッションをサーバに持たず、AES-256-GCM で暗号化して Cookie に
載せ、ブラウザに持たせている。実測 182 文字で、Cookie の 4KB 制限に
対して十分小さい。再起動を跨いでログインが残る。

引き換えに失うもの: **サーバ側から個別セッションを失効させる手段**。
連携解除は Cookie を消すことで行う。本当に止めたい場合はテクマナ側で
トークンを失効させれば、リフレッシュが落ちて未連携に戻る。

`SESSION_SECRET` を変えると全 Cookie が復号できなくなり、結果として
全員ログアウトする。逆に言えばそれが唯一の一斉失効手段。

## リフレッシュの二重提示に注意

テクマナはリフレッシュトークンをローテーションし、**失効済みのものを
再提示するとそのユーザーの全トークンを落とす**(漏洩とみなすため)。

トークンをブラウザに持たせている以上、これは踏みやすい。アクセス
トークンが切れた状態でセーブの読みと書きが同時に飛べば、両方が同じ
古いリフレッシュトークンを持っている。

`auth/techmana.ts` で2つの手当てをしている:

- 同じリフレッシュトークンに対する更新をプロセス内で1本にまとめる
- 成功した結果を5分だけ覚え、`Set-Cookie` がブラウザに行き渡る前に
  届いた「古い Cookie を持つ後続」にも同じ結果を返す

`techmana.test.ts` の「同時に走った2本が同じ古いトークンを二重提示
しない」がこれを直接確かめている。

## ルート登録順

`app.ts` の `app.get('*')` は SPA フォールバックで、`/socket.io` 以外の
全 GET に `index.html` を返す。**この後ろに登録した GET ルートは一生
呼ばれない。** しかも POST/PUT は素通りするので「半分だけ動く」という
分かりにくい壊れ方をする。

正しい順序:

```
cors → bodyパーサ → /health → /api/* → express.static → app.get('*')
```

`/api` には 404 を返すガードも置いてある。置かないと綴りを間違えた
API 呼び出しが HTML 200 を受け取り、クライアント側のエラー処理が
まるごと誤動作する。

またグローバルの `express.json()`(既定100kb)は `/api/sync` を迂回
させている。迂回させないと、先に走るこちらが 413 を返してしまい、
下流の 1MB 上限が一生効かない。

## Cookie の Secure 属性

`NODE_ENV` では判定していない。Railway のこのサービスには `NODE_ENV` が
**設定されていない**(実測)ため、`NODE_ENV === 'production'` は本番でも
false になり、HTTPS の本番で Secure なしの Cookie を配ることになる。

既定を「付ける」にして、ローカル開発だけ `COOKIE_INSECURE=1` で外す。

## 同定の切り替え

ログイン中は、クライアントが名乗る fingerprint を無視して
`tm:<テクマナのuser_id>` を使う(`events.ts`)。

今までの fingerprint は `navigator.userAgent + 画面サイズ + タイムゾーン`
のハッシュで、保存もされず毎回再計算される。ブラウザが自動更新されれば
別人になり、逆に同型端末どうしは衝突して同じランキング行を共有する。
ログインした人はその問題から外れる。

名前だけは本人が変えられる(テクマナの表示名と別の名前で遊びたい人が
いるため)。同定キーは変えられない。

## クラウドセーブの中身

```jsonc
{
  "v": 1,
  "nickname": "テト太郎",
  "keymap": { "ArrowLeft": "move_left", ... },
  "bgmVol": 35,
  "seVol": 60,
  "best": {
    "bestScore": 0, "bestLines": 0,
    "totalLines": 0, "totalMatches": 0, "totalWins": 0
  },
  "updatedAt": "2026-08-20T00:00:00.000Z"
}
```

記録も入れているのは、サーバ側の集計が再起動で消えるから。クラウドに
置いた自己ベストだけは残る。

マージ規則:

| 項目 | 規則 |
| --- | --- |
| ベスト・累計 | **max**。2台で遊べば両方に本物の記録が溜まるので、後勝ちにすると実際に遊んだ分が消える |
| 勝利数 | max だが試合数を超えないよう抑える(素朴な max だと勝率が100%を超える) |
| 設定・キー配置 | `updatedAt` が新しい方 |
| 名前・キー配置 | 空で既存を上書きしない |

## デプロイ

Railway は GitHub リポジトリ `amon3939-sketch/tetris-battle` の `main` を
見ている。**push すれば自動でデプロイされる。**

### 注意: デプロイするとランキングが消える

`db.ts` がインメモリなので、再起動で `players` / `matches` が全消去に
なる。これは今回の変更に限らず、**あらゆる再デプロイで起きる**。

2026-08-20 時点の内容は `data/ranking_snapshot_2026-08-20.json` に
退避してある。

### 環境変数(Railway)

```
SESSION_SECRET=<openssl rand -hex 32>
TECHMANA_BASE_URL=https://techmana.adamant-group.jp
TECHMANA_CLIENT_ID=tetox
TECHMANA_CLIENT_SECRET=<登録時に一度だけ表示される値>
TECHMANA_REDIRECT_URI=https://tetris-battle-production-b447.up.railway.app/api/auth/techmana/callback
CLIENT_BASE_URL=/
```

### テクマナ側のクライアント登録

管理画面 `/admin/apps` から。値は `.env.example` のコメント参照。
ブラウザを使えない場合は `ses-elearning/bin/register_oauth_client.php`。

## ローカルでの通し確認

テクマナ本体を使わずに確かめられる。`/tmp/techmana_stub_tetox.mjs` 相当の
スタブ(PKCE を実際に検証する)を立て、

```bash
PORT=3011 SESSION_SECRET=... COOKIE_INSECURE=1 \
TECHMANA_BASE_URL=http://localhost:3998 TECHMANA_CLIENT_ID=tetox \
TECHMANA_CLIENT_SECRET=... \
TECHMANA_REDIRECT_URI=http://localhost:3011/api/auth/techmana/callback \
CLIENT_BASE_URL=/ node packages/server/dist/app.js
```

確認済みの項目: ログイン往復、セーブの読み書き、巻き戻し保存の409、
600KB のセーブが通ること、プロセス再起動後もログインが残ること、
ログイン中は偽の fingerprint が無視されること。
