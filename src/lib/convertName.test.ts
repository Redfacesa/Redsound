import assert from 'node:assert/strict';
import test from 'node:test';
import { inputExtension, outputName, rejectReason } from './convertName.ts';

test('a voice note keeps a readable output name', () => {
  assert.equal(outputName('Voice note 3.m4a', 'wav'), 'Voice-note-3.wav');
  assert.equal(outputName('memo.ogg', 'mp3'), 'memo.mp3');
  assert.equal(inputExtension('clip.3gp'), '3gp');
  assert.equal(inputExtension('no-extension'), 'audio');
});

test('an empty or oversized file is refused before conversion', () => {
  assert.match(rejectReason({ size: 0 }), /empty/);
  assert.match(rejectReason({ size: 41 * 1024 * 1024 }), /40 MB/);
  assert.equal(rejectReason({ size: 1200 }), '');
});
