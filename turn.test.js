import assert from 'node:assert/strict';
import { parseTurnServers, peerOptions } from './turn.js';

const turn = { urls: ['turn:relay.example:3478', 'turns:relay.example:443'], username: 'short-lived', credential: 'token' };

assert.deepEqual(parseTurnServers([turn, { urls: 'stun:example' }]), [turn]);
assert.deepEqual(parseTurnServers({ iceServers: [turn] }), [turn]);
assert.deepEqual(parseTurnServers({ iceServers: [{ urls: 'turn:example' }] }), []);

const options = await peerOptions(async () => ({ ok: true, json: async () => [turn] }), 'https://example.test/credentials');
assert.deepEqual(options.config.iceServers, [{ urls: 'stun:stun.l.google.com:19302' }, turn]);
assert.equal(await peerOptions(async () => { throw new Error('offline'); }, 'https://example.test/credentials'), undefined);
assert.equal(await peerOptions(async () => ({ ok: false }), 'https://example.test/credentials'), undefined);
assert.equal(await peerOptions(undefined, ''), undefined);

console.log('TURN configuration checks passed');
