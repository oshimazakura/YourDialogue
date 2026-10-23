import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationView } from '../src/renderer/conversation-view.ts';
import type { Message } from '../src/shared/types.ts';

const previous: Message = {
  id: 'previous',
  role: 'assistant',
  text: '',
  segments: [{ type: 'speech', expression: 'face_01', text: '前の会話' }],
  status: 'complete',
  createdAt: '',
};
const user: Message = {
  id: 'user',
  role: 'user',
  text: '送信した質問',
  segments: [],
  status: 'complete',
  createdAt: '',
};
const pending: Message = {
  id: 'pending',
  role: 'assistant',
  text: '',
  segments: [],
  status: 'generating',
  createdAt: '',
};

test('sending retains the previous dialogue and submitted input until visible reply content arrives', () => {
  for (const messages of [
    [previous, user],
    [previous, user, pending],
  ]) {
    const view = conversationView(messages, true);
    assert.equal(view.displayMessage?.id, previous.id);
    assert.equal(view.latestUser?.text, user.text);
    assert.equal(view.awaitingReply, true);
    assert.equal(view.replyReceived, false);
  }
  const reply: Message = { ...pending, segments: [{ type: 'narration', text: '頷いた。' }] };
  const view = conversationView([previous, user, reply], true);
  assert.equal(view.displayMessage?.id, reply.id);
  assert.equal(view.latestUser?.text, user.text);
  assert.equal(view.awaitingReply, false);
  assert.equal(view.replyReceived, true);
});

test('first turn, failed responses, PHONE-only replies and session changes retain appropriate context', () => {
  assert.equal(conversationView([user, pending], true).latestUser?.text, user.text);
  const failed: Message = { ...pending, status: 'error' };
  assert.equal(conversationView([previous, user, failed], false).displayMessage?.id, previous.id);
  assert.equal(conversationView([previous, user, failed], false).awaitingReply, false);
  const phone: Message = {
    ...pending,
    status: 'complete',
    segments: [{ type: 'phone', format: 'text', text: '資料' }],
  };
  assert.equal(conversationView([previous, user, phone], false).displayMessage?.id, phone.id);
  assert.equal(conversationView([], false).displayMessage, undefined);
  assert.equal(conversationView([], false).latestUser, undefined);
  assert.equal(conversationView([previous, user, failed], false).replyReceived, false);
  assert.equal(conversationView([previous, user, phone], false).replyReceived, true);
});
