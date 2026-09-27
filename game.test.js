import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_IDS, ACTIONS, canUse, resolveRound, roundWinner } from './game.js';
import { normalizeRoomCode } from './peer.js';

test('all eight actions and keys are present', () => {
  assert.equal(ACTION_IDS.length, 8);
  assert.deepEqual(ACTION_IDS.map((id) => ACTIONS[id].key), ['Q', '1', '2', '3', '4', '5', 'A', 'S']);
});

test('attacks require GPA and resolve simultaneously', () => {
  assert.equal(canUse('quiz', 1), false);
  assert.deepEqual(resolveRound([{ gpa: 2, lives: 2 }, { gpa: 0, lives: 2 }], ['quiz', 'study']), {
    players: [{ gpa: 0, lives: 2 }, { gpa: 1, lives: 1 }],
    winner: 0,
  });
});

test('attacks beat study, stronger attacks, and weaker defense', () => {
  assert.equal(roundWinner('homework', 'study'), 0);
  assert.equal(roundWinner('exam', 'quiz'), 0);
  assert.equal(roundWinner('exam', 'shield'), 0);
  assert.equal(roundWinner('grandFinal', 'aiShield'), 0);
});

test('equal attacks, adequate defense, and other pairs have no winner', () => {
  assert.equal(roundWinner('quiz', 'quiz'), null);
  assert.equal(roundWinner('quiz', 'shield'), null);
  assert.equal(roundWinner('final', 'aiShield'), null);
  assert.equal(roundWinner('study', 'shield'), null);
  assert.equal(roundWinner('shield', 'aiShield'), null);
});

test('room codes accept readable six-character input', () => {
  assert.equal(normalizeRoomCode(' ab c-234 '), 'ABC234');
  assert.equal(normalizeRoomCode('ABC234'), 'ABC234');
  assert.equal(normalizeRoomCode('ABO234'), null);
  assert.equal(normalizeRoomCode('ABC23'), null);
});
