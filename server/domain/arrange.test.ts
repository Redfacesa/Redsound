import assert from 'node:assert/strict';
import test from 'node:test';
import {
  blendOverlaps,
  copyRange,
  deleteRange,
  duplicateSection,
  moveClip,
  pasteClipboard,
  removeClip,
  removeSection,
  removeTrack,
  seedArrangement,
  snapTime,
  splitAt,
  trimClip,
  addVocalTake,
  duplicateChannel,
  setClip,
  setChannel,
} from '../../shared/arrange.ts';

let seq = 0;
const id = () => `id-${seq += 1}`;

test('split at the playhead makes two clips that cover the original', () => {
  seq = 0;
  const arrangement = seedArrangement('session', 120, [{ id: 'audio', title: 'Drums', durationSec: 8 }], id);
  const clip = arrangement.tracks[0].clips[0];
  const split = splitAt(arrangement, 3, id);
  const clips = split.tracks[0].clips;
  assert.equal(clips.length, 2);
  assert.equal(clips[0].durationSec, 3);
  assert.equal(clips[1].startSec, 3);
  assert.equal(clips[1].offsetSec, clip.offsetSec + 3);
  assert.equal(clips[0].durationSec + clips[1].durationSec, 8);
});

test('splitting one track leaves the other track in one piece', () => {
  seq = 0;
  const arrangement = seedArrangement('session', 120, [
    { id: 'vocal', title: 'Voice', durationSec: 8 },
    { id: 'beat', title: 'Beat', durationSec: 8 },
  ], id);
  const vocal = arrangement.tracks[0];
  const once = splitAt(arrangement, 2, id, vocal.id);
  const twice = splitAt(once, 5, id, vocal.id);
  const pieces = twice.tracks[0].clips;
  assert.equal(pieces.length, 3);
  assert.equal(twice.tracks[1].clips.length, 1);
  const middle = pieces[1];
  const removed = removeClip(twice, middle.id);
  assert.equal(removed.tracks[0].clips.length, 2);
  assert.equal(removed.tracks[0].clips[0].durationSec, 2);
  assert.equal(removed.tracks[0].clips[1].startSec, 5);
  assert.equal(removed.tracks[1].clips.length, 1);
});

test('deleting one track leaves the other tracks alone', () => {
  seq = 0;
  const arrangement = seedArrangement('session', 120, [
    { id: 'vocal', title: 'Voice', durationSec: 8 },
    { id: 'beat', title: 'Beat', durationSec: 8 },
  ], id);
  const vocal = arrangement.tracks[0];
  const cut = deleteRange(arrangement, vocal.clips[0].startSec, vocal.clips[0].startSec + vocal.clips[0].durationSec, id, vocal.id);
  assert.equal(cut.tracks[0].clips.length, 0);
  assert.equal(cut.tracks[1].clips.length, 1);
  assert.equal(cut.tracks[1].clips[0].durationSec, 8);
  const removed = removeTrack(arrangement, vocal.id);
  assert.equal(removed.tracks.length, 1);
  assert.equal(removed.tracks[0].assetId, 'beat');
});

test('deleting the middle of a clip leaves the audio on both sides', () => {
  seq = 0;
  const arrangement = seedArrangement('session', 120, [{ id: 'audio', title: 'Voice', durationSec: 10 }], id);
  const cut = deleteRange(arrangement, 4, 6, id);
  const clips = cut.tracks[0].clips;
  assert.equal(clips.length, 2);
  assert.equal(clips[0].durationSec, 4);
  assert.equal(clips[1].startSec, 6);
  assert.equal(clips[1].offsetSec, 6);
});

test('copy and paste lands on the playhead and can snap to the beat', () => {
  seq = 0;
  const arrangement = seedArrangement('session', 120, [{ id: 'audio', title: 'Bass', durationSec: 4 }], id);
  const clipboard = copyRange(arrangement, 0, 2);
  assert.equal(snapTime(1.2, 120, 'beat'), 1);
  const pasted = pasteClipboard(arrangement, clipboard, snapTime(1.2, 120, 'beat'), id);
  const clips = pasted.tracks[0].clips;
  assert.equal(clips.length, 2);
  assert.equal(clips[1].startSec, 1);
  assert.equal(clips[1].durationSec, 2);
});

test('trim moves the source offset when the start handle moves', () => {
  seq = 0;
  const arrangement = seedArrangement('session', 120, [{ id: 'audio', title: 'Keys', durationSec: 8 }], id);
  const clipId = arrangement.tracks[0].clips[0].id;
  const trimmed = trimClip(arrangement, clipId, 'start', 2);
  const clip = trimmed.tracks[0].clips[0];
  assert.equal(clip.startSec, 2);
  assert.equal(clip.offsetSec, 2);
  assert.equal(clip.durationSec, 6);
});

test('duplicate section inserts a copy and pushes later sections', () => {
  seq = 0;
  const arrangement = seedArrangement('session', 120, [{ id: 'audio', title: 'Drums', durationSec: 8 }], id);
  const chorus = arrangement.sections.find((section) => section.name === 'Chorus');
  assert.ok(chorus);
  const moved = moveClip(arrangement, arrangement.tracks[0].clips[0].id, chorus.startSec);
  const next = duplicateSection(moved, chorus.id, id);
  const choruses = next.sections.filter((section) => section.name === 'Chorus');
  assert.equal(choruses.length, 2);
  assert.equal(choruses[1].startSec, chorus.endSec);
  const copied = next.tracks[0].clips.find((clip) => clip.startSec === chorus.endSec);
  assert.ok(copied);
});

test('overlapping clips get a crossfade', () => {
  seq = 0;
  const arrangement = seedArrangement('session', 120, [{ id: 'audio', title: 'Voice', durationSec: 4 }], id);
  const pasted = pasteClipboard(arrangement, copyRange(arrangement, 0, 4), 2, id);
  const blended = blendOverlaps(pasted);
  const [first, second] = blended.tracks[0].clips.sort((a, b) => a.startSec - b.startSec);
  assert.ok(first.fadeOutSec > 0);
  assert.ok(second.fadeInSec > 0);
});

test('each vocal recording becomes the next take instead of replacing the last one', () => {
  seq = 0;
  const arrangement = seedArrangement('session', 120, [{ id: 'beat', title: 'Beat', durationSec: 8 }], id);
  const first = addVocalTake(arrangement, { assetId: 'v1', title: 'Vocal Take 1', durationSec: 3, startSec: 1 }, id);
  const second = addVocalTake(first, { assetId: 'v2', title: 'Vocal Take 2', durationSec: 3, startSec: 1 }, id);
  const takes = second.tracks.filter((track) => track.take);
  assert.equal(takes.length, 2);
  assert.equal(takes[0].name, 'VOCAL TAKE 1');
  assert.equal(takes[1].name, 'VOCAL TAKE 2');
  assert.equal(takes[0].clips[0].assetId, 'v1');
  assert.notEqual(takes[0].channelId, takes[1].channelId);
  assert.ok(second.channels?.some((channel) => channel.role === 'vocal-bus'));
  assert.ok(second.channels?.some((channel) => channel.kind === 'master'));
});

test('duplicating a channel keeps the audio and gives the copy its own effects', () => {
  seq = 0;
  const arrangement = seedArrangement('session', 120, [{ id: 'beat', title: 'Lead Vocal', durationSec: 4 }], id);
  const channelId = arrangement.tracks[0].channelId;
  assert.ok(channelId);
  const copied = duplicateChannel(arrangement, channelId, id);
  const source = copied.channels?.find((channel) => channel.id === channelId);
  const copy = copied.channels?.find((channel) => channel.name.endsWith('copy'));
  assert.ok(source && copy);
  assert.notEqual(source.id, copy.id);
  assert.notDeepEqual(source.effects.map((effect) => effect.id), copy.effects.map((effect) => effect.id));
  const tracks = copied.tracks.filter((track) => track.assetId === 'beat');
  assert.equal(tracks.length, 2);
  assert.equal(tracks[1].channelId, copy.id);
  assert.equal(tracks[1].clips[0].assetId, tracks[0].clips[0].assetId);
});

test('clip gain and channel solo change the mix without moving the audio', () => {
  seq = 0;
  const arrangement = seedArrangement('session', 120, [{ id: 'beat', title: 'Lead Vocal', durationSec: 4 }], id);
  const clip = arrangement.tracks[0].clips[0];
  const gained = setClip(arrangement, clip.id, { gain: 1.4 });
  assert.equal(gained.tracks[0].clips[0].gain, 1.4);
  assert.equal(gained.tracks[0].clips[0].startSec, clip.startSec);
  const channelId = gained.tracks[0].channelId || '';
  const soloed = setChannel(gained, channelId, { solo: true, muted: false });
  assert.equal(soloed.channels?.find((channel) => channel.id === channelId)?.solo, true);
  assert.equal(soloed.tracks[0].clips[0].assetId, 'beat');
});

test('removing a section leaves every clip in place', () => {
  seq = 0;
  const arrangement = seedArrangement('session', 120, [{ id: 'vocal', title: 'Lead Vocal', durationSec: 8 }], id);
  const section = arrangement.sections[0];
  const next = removeSection(arrangement, section.id);
  assert.equal(next.sections.some((item) => item.id === section.id), false);
  assert.equal(next.tracks.length, arrangement.tracks.length);
  assert.equal(next.tracks[0].clips.length, arrangement.tracks[0].clips.length);
  assert.equal(next.tracks[0].clips[0].durationSec, arrangement.tracks[0].clips[0].durationSec);
});
