# Air Hockey Online Prototype

Phaser + Vite + Node.js WebSocketで作った、ブラウザ用のオンライン対戦エアホッケー試作です。

現在の仕様は、十字型マップで最大4人まで同じルームに入り、空き枠はCPUが担当する形式です。試合はプレイヤーが `Start match` を押すと5秒カウントダウン後に開始します。

## 仕組み

- フロントエンド: Vite + Phaser
- リアルタイムサーバー: Node.js + `ws`
- 同期方式: サーバー権威型
- クライアントは入力状態だけをWebSocketで送信
- サーバーがルーム、プレイヤー割り当て、CPU、パドル、ディスク、得点、勝敗、強打判定を管理
- サーバーは60Hzで状態更新し、全クライアントへゲーム状態を配信
- クライアントは受信状態をPhaserで軽く補間して描画

Vercelの通常Serverless Functionは常時WebSocket接続に向かないため、現実的な構成として「Vercelでフロント、Renderなどの常時起動Node.jsサービスでWebSocketサーバー」を使います。

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

## 4ブラウザでの確認方法

1. `npm run dev:all` を起動
2. 1つ目のブラウザで `http://127.0.0.1:5173/` を開く
3. `Create room` を押す
4. 表示された共有URLを別ブラウザに貼る
5. 2〜4人目が順に `Player 2`, `Player 3`, `Player 4` になる
6. 5人目以降は `Spectator`
7. いずれかのプレイヤーが `Start match` を押す
8. 5秒カウントダウン後に試合開始

人数が4人未満でも開始できます。空いている枠はCPUが自動で入ります。

## 操作

オンライン対戦では、自分のパドルだけを操作します。どのプレイヤーでもキーは同じです。

- 移動: `WASD` または 矢印キー
- 強打: `Shift` または `Space`
- 再スタート要求: `R`

## ルール

- Player 1: 下側
- Player 2: 上側
- Player 3: 左側
- Player 4: 右側
- 上ゴールに入るとPlayer 1が得点
- 下ゴールに入るとPlayer 2が得点
- 右ゴールに入るとPlayer 3が得点
- 左ゴールに入るとPlayer 4が得点
- ゴール後は短く停止して中央から再開
- 5点先取で勝ち
- 強打は受付0.15秒、クールダウン0.4秒、最大速度あり

## 環境変数

`.env.example`:

```bash
VITE_WS_URL=ws://127.0.0.1:8787
PORT=8787
```

ローカルでは `VITE_WS_URL` 未設定でも `ws://127.0.0.1:8787` に接続します。Vercelにデプロイする場合は、本番WebSocketサーバーのURLを設定してください。

```text
VITE_WS_URL=wss://airhockey-ws.onrender.com
```

## Vercelデプロイ

フロントはVercelにデプロイできます。

```bash
npm run build
npx vercel --prod
```

Vercel Project Settings:

- Framework: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- Environment Variable: `VITE_WS_URL`

## WebSocketサーバーのデプロイ

Render/Railway/Fly.ioなど、常時起動できるNode.jsサービスに置きます。このrepoにはRender Blueprint用の [render.yaml](render.yaml) を入れています。

基本設定:

- Build Command: `npm install`
- Start Command: `npm run server`
- Health Check Path: `/health`
- Port: サービスが提供する `PORT` 環境変数を使用

Render例:

```text
Render server URL: https://airhockey-ws.onrender.com
Vercel VITE_WS_URL: wss://airhockey-ws.onrender.com
```

## 調整しやすい数値

主要な数値は [src/shared/constants.js](src/shared/constants.js) にあります。

- 画面サイズ: `GAME.width`, `GAME.height`
- 勝利点: `GAME.winScore`
- 開始カウントダウン: `GAME.countdownMs`
- ゴール後の待ち時間: `GAME.goalDelayMs`
- パドル速度: `TUNING.paddleSpeed`
- CPU速度倍率: `TUNING.cpuSpeedScale`
- ディスク初速: `TUNING.puckStartSpeed`
- ディスク最大速度: `TUNING.puckMaxSpeed`
- 強打倍率: `TUNING.powerHitMultiplier`
- 強打受付時間: `TUNING.powerHitWindowMs`
- 強打クールダウン: `TUNING.powerHitCooldownMs`
- 十字マップ幅: `TUNING.armWidth`
- サーバーtick: `SERVER.tickRate`

## 画像素材

`public/assets/table-bg.svg` を背景テクスチャとして読み込みます。読み込めない場合でも、Phaserの図形描画だけでゲームは動きます。

この4人対戦対応では新しい `$imagegen` 素材は追加していません。今後、明るい子供向けの盤面テクスチャを作る場合のプロンプト例:

```text
Bright friendly air hockey table texture for a four-way cross-shaped rink, clean cyan rails, soft arcade lighting, playful but simple, no text, top-down view, suitable for children, seamless background feel
```

## 検証

オンラインE2E:

```bash
npm run build
npm run test:online
```

Playwrightで確認する内容:

- ルーム作成
- 共有URLで参加
- P1/P2/P3/P4割り当て
- 5人目がSpectatorになる
- Startボタンで5秒カウントダウン
- 自分のパドルだけ動く
- 相手の操作が同期される
- ディスクが同期される
- 得点が全員で一致する
- 強打が同期される
- 勝敗が全員で一致する
- `R` キーで再スタートカウントダウン
- 切断時にCPUが引き継ぐ
- 1人開始時に空き枠がCPUになる

## 今後の改善

- 再接続時に同じプレイヤー枠へ戻る
- CPUの難易度選択
- 入力予測を入れて操作遅延を減らす
- ゴール音、強打音、勝利演出
- マッチメイキングとルーム一覧
- 本番サーバーの部屋数や接続数の簡易メトリクス
