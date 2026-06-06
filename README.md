# Air Hockey Online Prototype

Phaser + Vite + WebSocketで作った、ブラウザ向け1対1オンライン対戦エアホッケー試作です。

## 仕組み

- フロントエンド: Vite + Phaser
- リアルタイムサーバー: Node.js + `ws`
- 同期方式: サーバー権威型
- クライアントは入力状態だけをWebSocketで送信
- サーバーがルーム、プレイヤー割り当て、パドル、ディスク、得点、勝敗、強打受付を管理
- サーバーは60Hzで物理更新し、状態を全クライアントへ送信
- クライアントは受信状態をPhaserで軽く補間して描画

Vercelの通常Serverless Functionは常時WebSocket接続に向かないため、現実的な構成として「Vercelでフロント、Render/Fly.io/RailwayなどでWebSocketサーバー」を使います。

## ローカル起動

```bash
npm install
npm run dev:all
```

個別に起動する場合:

```bash
npm run server
npm run dev
```

標準URL:

- フロント: `http://127.0.0.1:5173/`
- WebSocketサーバー: `ws://127.0.0.1:8787`
- Health check: `http://127.0.0.1:8787/health`

## 2ブラウザでの確認

1. `npm run dev:all` を起動
2. 1つ目のブラウザで `http://127.0.0.1:5173/` を開く
3. `Create room` を押す
4. 表示された共有URLをコピー
5. 2つ目のブラウザで共有URLを開く
6. 先に入った人がPlayer 1、次に入った人がPlayer 2
7. 3人目以降はSpectatorになります

## 操作

オンライン対戦では、自分のパドルだけ操作します。Player 1/2どちらでも同じキーです。

- 移動: `WASD` または 矢印キー
- 強打: `Shift` または `Space`
- 再スタート要求: `R`

## ルール

- Player 1は下側
- Player 2は上側
- 上ゴールに入るとPlayer 1が1点
- 下ゴールに入るとPlayer 2が1点
- ゴール後は短く停止してから中央に戻ります
- 5点先取で勝利
- 相手が切断した場合は待機状態になります

## 環境変数

`.env.example`:

```bash
VITE_WS_URL=ws://127.0.0.1:8787
PORT=8787
```

ローカルでは `VITE_WS_URL` を未設定にしても `ws://127.0.0.1:8787` に接続します。

Vercelにデプロイする場合は、Vercel側に本番WebSocketサーバーのURLを設定してください。

```bash
VITE_WS_URL=wss://your-airhockey-server.example.com
```

## Vercelデプロイ

フロントはVercelにデプロイできます。設定は [vercel.json](vercel.json) にあります。

```bash
npm run build
npx vercel --prod
```

VercelのProject Settingsで以下を設定します。

- Framework: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- Environment Variable: `VITE_WS_URL`

## WebSocketサーバーのデプロイ

Render/Railway/Fly.ioなど、常時起動のNode.jsサービスに置いてください。

このrepoにはRender用の [render.yaml](render.yaml) を入れています。RenderでGitHub repoをBlueprintとして作成すると、`npm run server` でWebSocketサーバーを起動できます。

基本設定:

- Start command: `npm run server`
- Port: `8787` またはサービスが提供する `PORT`
- Health check path: `/health`

Render例:

```text
Build Command: npm install
Start Command: npm run server
Environment:
  PORT=10000
```

Renderでは外部URLが `https://...` になるので、Vercelの `VITE_WS_URL` には `wss://...` を指定します。

例:

```text
Render server URL: https://airhockey-ws.onrender.com
Vercel VITE_WS_URL: wss://airhockey-ws.onrender.com
```

Vercel CLIで設定する場合:

```bash
npx vercel env add VITE_WS_URL production
npx vercel --prod
```

現在のVercel画面で `WebSocket URL is not configured` と出る場合は、まだ `VITE_WS_URL` が設定されていません。WebSocketサーバーを先にデプロイし、その `wss://...` URLをVercelの環境変数に入れてから再デプロイしてください。

## 調整しやすい数値

主要な数値は [src/shared/constants.js](src/shared/constants.js) にあります。

- 画面サイズ: `GAME.width`, `GAME.height`
- パドル速度: `TUNING.paddleSpeed`
- ディスク初速: `TUNING.puckStartSpeed`
- ディスク最大速度: `TUNING.puckMaxSpeed`
- 強打倍率: `TUNING.powerHitMultiplier`
- 強打受付時間: `TUNING.powerHitWindowMs`
- 強打クールダウン: `TUNING.powerHitCooldownMs`
- ゴール後の待ち時間: `GAME.goalDelayMs`
- サーバーtick: `SERVER.tickRate`

## 検証項目

Playwrightで2ページを開いて、次を確認しました。

- ルーム作成
- 共有URLで参加
- P1/P2割り当て
- 3人目がSpectatorになる
- 自分のパドルだけ動く
- 相手の操作が同期される
- ディスク状態が同期される
- 得点が両者で一致する
- 強打が同期される
- 勝敗が両者で一致する
- `R` キーで再スタート
- 片方切断時の表示

## 今後の改善

- 再接続時に同じプレイヤー枠へ復帰する
- 予測入力を入れて操作遅延を減らす
- サーバー側の部屋一覧や簡単なマッチングを追加する
- 強打成功音やゴール音を追加する
- Renderなどの外部WebSocketサーバーを本番環境に接続する
