# Air Hockey Prototype

Phaser + Viteで作った、ブラウザで遊べる2人対戦エアホッケーの試作です。

## 起動方法

```bash
npm install
npm run dev
```

表示されたURLをブラウザで開きます。標準では `http://127.0.0.1:5173/` です。

## Vercelへのデプロイ

VercelはViteとしてデプロイできます。設定は [vercel.json](vercel.json) にあります。

```bash
npm install
npm run build
npx vercel
```

本番公開する場合:

```bash
npx vercel --prod
```

CLIで `The specified token is not valid` が出る場合は、Vercelにログインし直してください。

```bash
npx vercel logout
npx vercel login
npx vercel --prod
```

トークンを使う場合は、Vercelの管理画面で新しいTokenを作り、ローカル環境変数に設定してから実行します。トークンをチャットに貼らないでください。

## 操作方法

- プレイヤー1（下側）: `W` `A` `S` `D` で移動、`Shift` で強打
- プレイヤー2（上側）: 矢印キーで移動、`Space` で強打
- `R`: 試合をリスタート

## ルール

- 上側ゴールにディスクが入るとプレイヤー1が1点
- 下側ゴールにディスクが入るとプレイヤー2が1点
- ゴール後は短く停止してから中央に戻ります
- 5点先取で勝利

## 使ったライブラリ

- Phaser
- Vite
- playwright-core（ブラウザ検証用）

## 調整しやすい数値

主要なゲーム調整値は [src/main.js](src/main.js) の `GAME` と `TUNING` にまとめています。

- 画面サイズ: `GAME.width`, `GAME.height`
- パドル速度: `TUNING.paddleSpeed`
- ディスク初速: `TUNING.puckStartSpeed`
- ディスク最大速度: `TUNING.puckMaxSpeed`
- 強打倍率: `TUNING.powerHitMultiplier`
- 強打受付時間: `TUNING.powerHitWindowMs`
- 強打クールダウン: `TUNING.powerHitCooldownMs`
- ゴール後の待ち時間: `GAME.goalDelayMs`

## imagegen素材

初回実装後に `imagegen` で試作用の明るいエアホッケー台背景を生成しようとしましたが、レート制限で生成できませんでした。代替として、軽量な背景素材を [public/assets/table-bg.svg](public/assets/table-bg.svg) に作成し、ゲームに組み込んでいます。画像が読み込めない場合でも、ゲームはPhaserの図形描画だけで動きます。

試した `imagegen` プロンプト:

```text
Use case: stylized-concept
Asset type: 960x540 game background texture for a browser air hockey prototype
Primary request: bright, kid-friendly top-down air hockey table background, clean and readable, no scary elements
Scene/backdrop: top-down air hockey table surface with soft teal-blue playfield, subtle center line and center circle, warm yellow goal accents at top and bottom
Style/medium: polished 2D game background texture, simple vector-like illustration, not photorealistic
Composition/framing: exact 16:9 wide background, full table surface, no perspective tilt, leave gameplay area uncluttered
Lighting/mood: cheerful, bright arcade lighting
Color palette: teal, aqua, white, warm yellow accents
Text (verbatim): none
Constraints: no text, no logo, no watermark, no characters, no paddles, no puck, no UI, avoid busy details that could hide game objects
```

## ブラウザ確認

`$playwright-interactive` として使える同名ツールはこの環境では見つからず、Browserプラグインの常駐実行環境もWindowsサンドボックスの制限で起動できませんでした。そのため、`playwright-core` と既存Chromeを使って、ビルド済みの `dist/index.html` を実ブラウザで開いて確認しました。

確認済み:

- 起動して画面が表示される: OK
- プレイヤー1のWASD移動: OK
- プレイヤー2の矢印キー移動: OK
- ディスクの壁反射: OK
- ディスクのパドル反射: OK
- Shift強打: OK
- Space強打: OK
- ゴール得点: OK
- 5点先取の勝敗表示: OK
- Rキーのリスタート: OK

スクリーンショット:

- `artifacts/playwright-initial.png`
- `artifacts/playwright-final.png`

## 今後の改善案

- パドル操作に少し慣性を入れる
- 強打成功時の音を追加する
- CPU練習モードを追加する
- ゴール付近の跳ね返りと得点判定をさらに細かく調整する
- スマホやゲームパッド操作に対応する
