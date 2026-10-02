import { buildGenerateBody, SunoError } from './client.ts';
import assert from 'node:assert/strict';
import test from 'node:test';

const callback = 'https://example.com/redsound-callback';

test('custom mode keeps lyrics and style and leaves out a title unless one is set', () => {
  const body = buildGenerateBody({
    customMode: true,
    instrumental: false,
    style: 'Amapiano, log drum, warm pads',
    lyrics: '[Verse] Midnight traffic',
    model: 'V6',
    callBackUrl: callback,
  });
  assert.equal(body.customMode, true);
  assert.equal(body.model, 'V6');
  assert.equal(body.lyrics, '[Verse] Midnight traffic');
  assert.equal('title' in body, false);
  assert.equal('prompt' in body, false);
});

test('non-custom mode does not send custom-only fields', () => {
  const body = buildGenerateBody({
    customMode: false,
    prompt: 'A night drive through Johannesburg',
    title: 'Should not travel',
    vocalGender: 'f',
    duration: 90,
    callBackUrl: callback,
  });
  assert.equal(body.prompt, 'A night drive through Johannesburg');
  assert.equal('title' in body, false);
  assert.equal('vocalGender' in body, false);
  assert.equal('duration' in body, false);
});

test('custom mode rejects an empty request', () => {
  assert.throws(
    () => buildGenerateBody({ customMode: true, instrumental: true, callBackUrl: callback }),
    (error: unknown) => error instanceof SunoError && /style, lyrics, or negative tags/.test(error.message),
  );
});
