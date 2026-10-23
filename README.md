# YourDialogue

汎用AIとの会話を、ビジュアルノベルのUIで楽しむElectronデスクトップクライアントです。React / TypeScript / SQLiteを使用し、初期接続先はOpenRouterです。

## 開発・起動

Node.js 24以上とnpmを用意してください。

```sh
npm install
npm run dev
```

CONFIGでOpenRouterのAPIキーとモデルIDを設定し、NEW SESSIONから会話を開始します。モデルIDはOpenRouterのモデルページにある `provider/model-name` の形式で指定してください。APIの利用にはOpenRouterの料金・利用条件が適用されます。

```sh
npm test           # Node標準テストランナーで通信解析・保存・会話制御を検証
npm run typecheck  # TypeScriptの型チェック
npm run lint       # ESLintで未使用変数などを検査
npm run format     # Prettierでコード整形
npm run build      # main / preload / rendererをdistへビルド
npm start          # ビルド済みのElectronアプリを起動
npm run package    # 現在のOS向けの配布用アプリをreleaseへ生成
```

Reactの変更は開発中に反映されます。main / preloadを変更した場合は開発プロセスを再起動してください。初回の `npm install` は依存パッケージとElectron本体をダウンロードします。生成された `package-lock.json` はコミット対象です。

## 操作

- **Enter**で送信、**Shift + Enter**で改行。日本語変換中のEnterでは送信しません。
- 送信した直近の入力を会話欄の上に残し、返答が届くとフェードアウトします。返答待ちの間は前の会話を維持し、表示可能な返答が届くと切り替えます。通知は右上に表示します。
- 発話欄のクリックで現在ページを即時表示し、もう一度クリックすると次のページへ進みます。受信と文字送りは独立しています。
- **PHONE**にコード・Markdown・詳しい説明が届きます。スクロール、選択、コピーができます。
- **LOG**からBACKLOGを開き、会話全文を確認・コピーできます。過去のユーザー発言の編集は、その後の履歴を破棄して再生成します。
- **停止**は生成を中断します。完成済みのJSONL行は保存し、受信途中の行は破棄します。
- **CONFIG**で文字送り速度・文字サイズ・決定音を変更できます。
- **CONFIG → キャラクター**でキャラクター設定、最初の挨拶、表情画像・背景の登録、配置プレビュー、Character Cardの読み込みができます。NEW SESSIONは現在のキャラで即開始します。

## セッションと保存

- **NEW SESSION**で現在のキャラの新しい会話を開始します。左端の＋、または⌘/Ctrl+Nでも開始できます。
- 最初のメッセージを送ると、挨拶とともに**SESSION**一覧へ保存されます。送信前の下書きは一覧に追加されず、切替・終了で破棄されます。
- 以後の会話は完成したJSONL行ごとに自動保存します。SESSION一覧から再開・名前変更・削除できます。
- 起動時は最後に選択していた保存済みセッションを復元します。生成中の終了・クラッシュ後は、残った回答を中断として扱います。
- セッション切替・編集・再生成では、先に現在の生成を停止します。編集前の履歴には戻れません。
- SAVE / LOAD操作は廃止しました。旧版の保存コピーは通常のセッションとして残ります。

データはElectronのユーザーデータディレクトリ内の `dialogue.sqlite` に保存します。macOSの標準位置は `~/Library/Application Support/YourDialogue/` です。会話履歴は暗号化していません。APIキーは会話履歴とは分離し、OSの `safeStorage` で暗号化します。安全な保管機能を利用できない環境では、キーはメモリ内だけに保持します。キーを変更せず設定を保存すると、現在のキーを維持します。

## JSONLプロトコル

OpenRouterのSSEから `delta.content` を取り出し、その中のJSONLを解析します。JSONオブジェクトが完成し、検証に成功したものだけを画面・SQLiteへ渡します。モデルが改行を省いて `}{` のように連結しても、文字列・エスケープ・入れ子を区別して個別に読み取ります。改行や回答全体の生成完了は待ちません。未完成のオブジェクトは保持し、停止・切断時には破棄します。

```jsonl
{"type":"speech","expression":"face_02","text":"コードはこちらです。"}
{"type":"phone","format":"code","language":"typescript","text":"const value = 1;"}
```

台詞は `speech`、地の文は `{"type":"narration","text":"描写"}` で出力します。地の文では名前欄を表示せず、直前の表情を維持します。

PHONEの `format` は `text` / `markdown` / `code`。本文の改行は `\n` としてエスケープします。各モデルがJSONLを生成できるかは実際のモデルで確認してください。JSONモードは単一JSON文書を要求する場合があるため、使用せず、システムプロンプトで形式を指定しています。不正な行はスキップして通知し、不明な表情IDはデフォルトに戻します。HTTPエラー、生成途中のエラー、長さ制限、切断は回答状態に記録し、BACKLOGや再生成から対処できます。自動リトライはしません。

## 構成

```text
src/core/        JSONL・SSE解析、OpenRouter、SQLite、会話制御
src/main/        Electronウィンドウ、限定IPC、APIキー管理
src/preload/     rendererへ公開する型付きAPI
src/renderer/    VN画面、ページ分割、各パネル
src/shared/      共有データ型と仮キャラクター設定
public/characters/alice/  仮の表情付きSVG立ち絵
tests/          通信・セッション保存・編集・復元・ページ分割のテスト
doc/            アプリ仕様書
```

キャラクターはCONFIG内のキャラクター画面で管理し、SQLiteに保存します。同梱の仮プリセットは `src/shared/character.ts` で定義しています。ユーザーが登録した画像はアプリのユーザーデータディレクトリへコピーし、セッションには設定・画像参照・背景・配置を保存します。詳しい手順とCardの対応範囲は [doc/characters.md](doc/characters.md) を参照してください。

## 初期実装の範囲

通常のテキスト会話、表情切替、VNのページ送り、シンプルなPHONE、BACKLOG、編集・再生成、セッション自動保存・一覧からの再開、OpenRouter設定を実装しています。

Character Card V1/V2のJSON/PNG読み込み、キャラクター管理、最初の挨拶、画像・背景登録、立ち絵の配置プレビューも実装しています。

添付ファイル、Web検索、外部ツール実行、PDF・画像ビューア、TTS、配布用の署名・自動更新は後続対応です。PHONEのMarkdownはHTMLを実行せず、外部画像・リンク遷移も無効にしています。履歴の自動要約・削減は行わず、長さ上限のエラー時には新しいセッションへ移ってください。

仕様の原本は [doc/vn_ai_chat_spec.md](doc/vn_ai_chat_spec.md) です。

## 不具合の診断

開発時はローカル診断APIが起動し、受信・JSONL解析・保存・ページ送りの状態とイベント、保存済み／編集中のキャラクター情報を取得できます。まず状態とログで調査し、スクリーンショットは必要な場合のみ取得します。curlの使い方とログの説明は [doc/diagnostics.md](doc/diagnostics.md) を参照してください。
