import { vnSegments } from './narration.ts';
import { expandCharacterText } from './characters.ts';
import type { Character, Message } from '../shared/types.ts';

export function systemPrompt(character: Character): string {
  const setting = [
    character.description,
    character.personality && `性格: ${character.personality}`,
    character.scenario && `状況: ${character.scenario}`,
    character.exampleMessages && `会話例（口調の参考）:\n${character.exampleMessages}`,
  ]
    .filter(Boolean)
    .join('\n');
  return `あなたは汎用AIアシスタントです。次のキャラクター設定で会話してください。\n${character.name}: ${expandCharacterText(setting, character)}\n
出力はJSONLのみ。Markdownのコードフェンスや配列で囲まないこと。
1行につき1つの完全なJSONオブジェクトを出力し、各行を改行で区切る。
通常の発話: {"type":"speech","expression":"表情ID","text":"発話"}
地の文: {"type":"narration","text":"情景や動作の描写"}
台詞はspeech、地の文はnarrationに分けて出力する。地の文にはキャラクター名を表示しない。地の文が必要な場合だけ使い、通常の質問への説明・回答を地の文にしない。
詳細・コード: {"type":"phone","format":"text または markdown または code","language":"コードの言語（任意）","text":"内容"}
本文内の改行はJSON文字列のエスケープで表現する。会話は自然な短い発話単位で区切る。
長い説明、コード、表やMarkdownはPHONEへ送る。PHONEにも実際の回答内容を書く。
PHONEを使う回答では、必ずspeechでスマホに内容を送ることと、何を送るかを短く明示する。例：「資料をスマホに送ったよ。PHONEから見てね」「コードはスマホに送るね」。キャラクターの口調に合わせて自然に言い換えてよい。
「こちらです」「まとめました」だけで済ませず、ユーザーがPHONEを開けば続きが読めると分かる案内にする。案内のspeechは該当するphone行の直前に出力する。実ファイルの作成・添付をしていない場合は、そうした操作をしたと主張せず「詳しい説明」「コード」など実際に表示する内容を案内する。
利用可能な表情:\n${character.expressions.map((item) => `${item.id}: ${item.description}`).join('\n')}
意味のある発話単位で表情を選び、不必要に頻繁に変えない。
Web検索・ファイル参照・コード実行のツールはない。実行していない操作を実行したと主張しない。`;
}

export function conversationMessages(character: Character, messages: Message[]) {
  const result: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemPrompt(character) },
  ];
  for (const message of messages) {
    if (message.role === 'user') result.push({ role: 'user', content: message.text });
    else if (message.segments.length) {
      // Include PHONE details as context, not just the short spoken introduction.
      result.push({
        role: 'assistant',
        content: (message.greeting ? vnSegments(message) : message.segments)
          .map((segment) => JSON.stringify(segment))
          .join('\n'),
      });
    }
  }
  return result;
}
