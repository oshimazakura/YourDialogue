import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { describeCharacter, diagnosticCharacter } from '../src/core/character-diagnostics.ts';
import { Diagnostics } from '../src/core/diagnostics.ts';
import { defaultCharacter } from '../src/shared/character.ts';
import { createDebugHandler } from '../src/main/debug-server.ts';

const character = {
  ...defaultCharacter,
  description: 'character description',
  personality: 'personality',
  greeting: 'greeting',
  importedCard: {
    version: 2 as const,
    warnings: ['character_book is not supported'],
    original: {
      spec: 'chara_card_v2',
      data: { name: 'Alice', system_prompt: 'do not include raw metadata' },
    },
  },
};

test('summaries include identity, card compatibility and lengths; explicit details include settings', () => {
  const summary = describeCharacter(character);
  assert.equal(summary.name, 'Alice');
  assert.equal(summary.fieldLengths.description, character.description.length);
  assert.equal(summary.card?.version, 2);
  assert.deepEqual(summary.card?.sourceFields, ['name', 'system_prompt']);
  assert.doesNotMatch(JSON.stringify(summary), /character description|do not include raw metadata/);
  const details = describeCharacter(character, true);
  assert.equal(details.fields?.description, character.description);
  assert.equal(details.fields?.greeting, character.greeting);
  assert.equal(details.expressions[0].image, defaultCharacter.expressions[0].image);
  assert.doesNotMatch(JSON.stringify(details), /do not include raw metadata/);
});

test('invalid editor drafts can be diagnosed without retaining arbitrary values', () => {
  const snapshot = diagnosticCharacter({
    ...character,
    name: '',
    defaultExpression: '',
    apiKey: 'hidden',
    placement: { scale: 1, x: 50, y: 0, extra: 'do not retain' },
  });
  assert.equal(snapshot.name, '');
  assert.equal(snapshot.defaultExpression, '');
  assert.deepEqual(snapshot.placement, { scale: 1, x: 50, y: 0 });
  assert.doesNotMatch(JSON.stringify(snapshot), /hidden|do not retain|do not include raw metadata/);
});

test('editor diagnostics distinguish dirty state and clear on closing; logs do not contain settings text', () => {
  const diagnostics = new Diagnostics();
  diagnostics.updateCharacterDraft({
    character,
    dirty: true,
    error: 'validation failed',
    selectedExpression: 1,
  });
  assert.equal(diagnostics.characterEditor()?.dirty, true);
  assert.equal(diagnostics.characterEditor()?.character.fields, undefined);
  assert.equal(
    diagnostics.characterEditor(true)?.character.fields?.description,
    character.description,
  );
  diagnostics.updateCharacterDraft({
    character: { ...character, description: 'edited text' },
    dirty: true,
    error: 'validation failed',
    selectedExpression: 0,
  });
  assert.equal(diagnostics.events().events.length, 1);
  assert.doesNotMatch(JSON.stringify(diagnostics.events()), /edited text|character description/);
  diagnostics.updateCharacterDraft(null);
  assert.equal(diagnostics.characterEditor(true), null);
  diagnostics.updateCharacterDraft({ character, dirty: false });
  diagnostics.clearUi();
  assert.equal(diagnostics.characterEditor(), null);
});

test('separate character snapshot retains long fields, redacts secrets and skips unchanged writes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'character-diagnostics-'));
  try {
    const diagnostics = new Diagnostics(directory);
    diagnostics.addSecret('known-secret');
    const content = {
      currentSession: {
        character: describeCharacter(
          { ...character, description: 'a'.repeat(9000) + 'known-secret' },
          true,
        ),
      },
    };
    diagnostics.persistCharacters(content);
    const path = join(directory, 'characters.json');
    const first = readFileSync(path, 'utf8');
    const snapshot = JSON.parse(first);
    assert.equal(snapshot.currentSession.character.fields.description.length, 9010);
    assert.doesNotMatch(first, /known-secret/);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.ok(snapshot.capturedAt);
    diagnostics.persistCharacters(content);
    assert.equal(readFileSync(path, 'utf8'), first);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('character diagnostic endpoint requires authentication and explicit content opt-in', async () => {
  const diagnostics = new Diagnostics();
  const handler = createDebugHandler(
    {
      directory: 'unused',
      diagnostics,
      state: () => ({}),
      characters: (content) => ({
        currentSession: { character: describeCharacter(character, content) },
      }),
    },
    'test-token',
    12345,
  );
  const request = async (path: string, authorized = true) => {
    const incoming = new IncomingMessage(new Socket());
    incoming.url = path;
    incoming.method = 'GET';
    incoming.headers = {
      host: '127.0.0.1:12345',
      ...(authorized ? { authorization: 'Bearer test-token' } : {}),
    };
    const response = new ServerResponse(incoming);
    let output = '';
    response.end = ((value: string) => {
      output = String(value);
      return response;
    }) as typeof response.end;
    await handler(incoming, response);
    incoming.destroy();
    return { status: response.statusCode, body: JSON.parse(output) };
  };
  assert.equal((await request('/debug/characters', false)).status, 401);
  assert.equal(
    (await request('/debug/characters')).body.currentSession.character.fields,
    undefined,
  );
  assert.equal(
    (await request('/debug/characters?content=1')).body.currentSession.character.fields.description,
    character.description,
  );
  assert.equal((await request('/debug/characters?content=invalid')).status, 400);
});
