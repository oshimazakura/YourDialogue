# 開発用診断API

`npm run dev`（または未パッケージの `npm start`）で自動的に有効になります。配布用にパッケージしたアプリでは起動しません。アプリのmain / preloadが変わったため、この機能を使うには開発アプリを再起動してください。

## 最初に状態とイベントを調べる

リポジトリのルートで実行します。起動ごとにポートとトークンが変わります。

```sh
DEBUG_URL=$(node -p 'JSON.parse(require("node:fs").readFileSync(".your-dialogue-debug/connection.json", "utf8")).url')

# 現在の生成・パーサー・表示状態
curl -sS -H "Authorization: Bearer $(cat .your-dialogue-debug/token)" "$DEBUG_URL/debug/state"

# 直近100件のイベント
curl -sS -H "Authorization: Bearer $(cat .your-dialogue-debug/token)" "$DEBUG_URL/debug/events"

# 指定IDより後のイベント。limitは1〜500、返すのは条件内の直近分
curl -sS -H "Authorization: Bearer $(cat .your-dialogue-debug/token)" "$DEBUG_URL/debug/events?since=0&limit=500"
```

APIは127.0.0.1のみで待ち受ける読み取り専用HTTP APIです。認証なしは401、Origin付きのブラウザリクエストや別Hostは403です。APIキー・認証ヘッダーは公開しません。

## 停止したように見える場合

`/debug/state` の主な項目：

- `summary`: 接続準備、初回コンテンツ待ち、JSONL行の完成待ち、受信中、生成エラー、文字送り中、ページ送り待ちなどの概況。
- `generation.progress`: リクエストのセッションID・回答ID、開始時刻、最後の本文受信時刻、受信チャンク数・文字数、保存済みセグメント数、最終結果。
- `generation.progress.parser`: 処理行数、正常行数、不正行数、未完成行の文字数。
- `renderer.app`: 開いているパネル、送信操作中か、画面上のエラー、PHONE件数。
- `renderer.dialogue`: 表示ページ・総ページ数、文字送り数、表情ID、表示領域の大きさ、表示状態。
- `renderer.lastReportedAt` / `ageMs`: 最後に画面側が状態を報告してからの時間。通常は約3秒ごとに報告しますが、非表示時はタイマーが抑制される場合があります。APIの状態と描画側の報告は非同期です。

例えば、受信が完了し `renderer.dialogue.phase` が `waiting_for_page_advance` なら、発話欄のクリック待ちです。受信文字数が増え、未完成行の文字数も増えている場合は、JSONLの1行が完成するまで待っています。APIを複数回取得し、受信数・時刻が変化しているかも確認してください。

`generation.progress` は最後の生成の情報を残します。現在セッションとの対応はIDで確認してください。過去の生成エラーは会話DBに残りますが、詳細イベントはこの機能を有効にした後に発生したものだけを記録します。

## イベントログ

- `provider.request` / `response` / `finish_reason` / `done`: 接続開始、HTTP状態、終了理由。
- `provider.invalid_sse_json` / `provider.error`: SSE内のJSON解析エラーやProviderのエラー。
- `generation.started` / `first_content` / `finished` / `failed`: 生成の経過、中断、タイムアウト。
- `jsonl.accepted` / `invalid`: 処理レコード番号（`line`）、正常・不正、構文／必須項目／type／formatの問題。不正レコードはスキップします。改行なしで連続したJSONも個別のレコードとして数えます。
- `jsonl.expression_fallback`: 未定義の表情IDをデフォルト表情へ戻した記録。
- `jsonl.partial_discarded`: 中断時に未完成行を破棄した記録。
- `segment.persisted`: セグメントをSQLiteに保存した記録。
- `ui.changed` / `ipc.failed` / `renderer.*`: 画面状態の変化、IPCの失敗、描画プロセスの異常。

JSONLのイベントにはセッションID・回答IDが付くため、同じ生成を追跡できます。文字送り1文字ごとのイベントは記録しません。生テキストはイベントとは別の回答ファイルへ保存します。

開発用診断では、生のLLM返答をデフォルトで `.your-dialogue-debug/responses/<回答ID>.json` に保存します。`text` にSSEから取り出した `delta.content` を受信順に結合した全文が入り、JSONL解析前の文字列を確認できます。成功・形式エラー・通信エラー・停止のいずれでも受信済みの本文を残します。過去に記録しなかった返答は復元できません。

生成中は最大約1秒ごと（受信時）、終了時は必ず更新します。`sessionId`・`messageId`・`model`・`outcome`・`capturedAt` で対応する会話と状態を確認できます。終了時の `generation.raw_response` イベントにファイル位置を記録します。本文は先頭・末尾だけに省略しません。異常終了では最後の更新以降の受信分が残らない場合があります。

失敗・破棄したJSONL行のイベントにも先頭600文字と、長い場合の末尾120文字を記録します。既知のAPIキーとキー形式の文字列はマスクします。これらはローカルの診断ファイルに保存し、Git対象外です。配布アプリでは診断機能自体が無効です。

本文の記録を無効にしたい場合は次の設定で再起動してください（構造・長さの診断は継続します。保存済みファイルは削除しません）。

```sh
YOUR_DIALOGUE_DEBUG_CONTENT=0 npm run dev
```

## HTTPへ接続できない環境・終了後の確認

`.your-dialogue-debug/` に診断データを保存します（Git対象外）。

```sh
cat .your-dialogue-debug/state.json       # 約1秒ごとに更新する最新状態
tail -n 100 .your-dialogue-debug/events.jsonl
```

イベントはメモリ内に直近500件、ディスクには約1MBでローテーションする `events.jsonl` と `events.jsonl.previous` を保持します。起動時も前回ログを `.previous` へ移します。古いログは順次置き換わります。`state.json` はアプリ終了後も残るため、`pid`・`capturedAt` を確認してください。診断ログのディスク保存失敗はAPI側の `diskError` に表示します。

## キャラクター・カードの内容を確認する

保存済みのライブラリ、現在のセッションに保持された設定、CHARACTER画面で編集中の未保存データを分けて取得できます。アプリを再起動すれば、すでに読み込み・保存済みのカードも取得できます。再インポートは不要です。

```sh
# 名前、各項目の文字数、表情ID、画像の有無、カードのバージョン・未対応項目
curl -sS -H "Authorization: Bearer $(cat .your-dialogue-debug/token)" "$DEBUG_URL/debug/characters"

# 説明・性格・状況・会話例・最初の挨拶・表情の説明など、実際の設定内容も取得
curl -sS -H "Authorization: Bearer $(cat .your-dialogue-debug/token)" "$DEBUG_URL/debug/characters?content=1"

# HTTPが使えない場合。同じ詳細情報を保存した専用ファイル
cat .your-dialogue-debug/characters.json
```

- `library[]`: 保存済みキャラクターの設定。
- `currentSession.persisted`: 最初の入力で保存済みかどうか。`false` はSESSION一覧に出ない下書きです。
- `currentSession.character`: 現在のセッションにコピーされた設定。ライブラリを編集した後は内容が異なる場合があります。
- `editor`: CHARACTER画面で選択・編集中の設定。`dirty` がtrueなら未保存です。画面を閉じるとnullになります。`reportedAt` は最後に編集内容を報告した時刻で、心拍時刻ではありません。
- `fields`: `content=1` の場合に返す説明・性格・状況・会話例・挨拶。
- `card`: カードのバージョン、未対応項目の警告、元カードの項目名。元カードの全JSONや画像バイナリは含めません。

通常の `/debug/state` と `state.json` には現在のキャラクターと編集状態の概要だけを含めます。`character.imported` / `character.saved` にも概要を記録し、設定本文はイベントログへ書きません。

専用の `characters.json` には設定本文が含まれます（`YOUR_DIALOGUE_DEBUG_CONTENT` の設定とは独立）。開発用の診断フォルダ内だけに保存し、他の診断ファイルと同じくGit対象外・所有ユーザーのみ読み書き可能です。内容が変わった時だけファイルを更新します。終了後も残るため、`pid` と `capturedAt` を確認してください。APIキーなどはマスクし、既存の文字数・表情数の上限内で出力します。

## 最後の手段として画面を取得する

状態・ログで判断できない場合だけ実行してください。通常の状態取得では画像を作成しません。

```sh
curl -sS -f -H "Authorization: Bearer $(cat .your-dialogue-debug/token)" "$DEBUG_URL/debug/screenshot" -o /tmp/your-dialogue.png
```
