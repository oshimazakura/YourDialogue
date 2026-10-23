import type { Message } from '../shared/types.ts';
import { vnSegments } from '../core/narration.ts';

export function conversationView(messages: Message[], busy: boolean) {
  const latestUser = messages.findLast((message) => message.role === 'user');
  const latestAssistant = messages.findLast((message) => message.role === 'assistant');
  const hasSpeech = !!latestAssistant && vnSegments(latestAssistant).length > 0;
  const phoneReady = latestAssistant?.status === 'complete' && latestAssistant.segments.length > 0;
  const displayMessage =
    hasSpeech || phoneReady
      ? latestAssistant
      : messages.findLast(
          (message) => message.role === 'assistant' && vnSegments(message).length > 0,
        );
  const userIndex = latestUser ? messages.indexOf(latestUser) : -1;
  const assistantIndex = latestAssistant ? messages.indexOf(latestAssistant) : -1;
  const awaitingReply = busy && (userIndex > assistantIndex || !hasSpeech);
  const replyReceived = userIndex >= 0 && assistantIndex > userIndex && (hasSpeech || !!phoneReady);
  return { latestUser, latestAssistant, displayMessage, awaitingReply, replyReceived };
}
