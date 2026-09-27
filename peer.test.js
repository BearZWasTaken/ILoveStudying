import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PeerLink } from './peer.js';

const statuses = [];
const messages = [];
const link = new PeerLink((message) => messages.push(message), (status) => statuses.push(status));
link.isHost = true;
link.peer = new EventEmitter();
link.peer.destroy = () => {};
link.listenForGuests();

function channel() {
  const connection = new EventEmitter();
  connection.closed = false;
  connection.close = () => { connection.closed = true; connection.emit('close'); };
  return connection;
}

const first = channel();
link.peer.emit('connection', first);
assert.equal(link.channel, first);

const second = channel();
link.peer.emit('connection', second);
assert.equal(first.closed, true);
assert.equal(link.channel, second);
assert.deepEqual(statuses, ['incoming', 'incoming']);

link.connected = true;
link.disconnectOpponent();
assert.equal(second.closed, true);
assert.equal(link.channel, null);
assert.equal(link.connected, false);
assert.equal(statuses.at(-1), 'disconnected');
second.emit('data', { type: 'ready', ready: true });
second.emit('open');
second.emit('error');
assert.deepEqual(messages, []);
assert.equal(link.connected, false);
assert.equal(statuses.at(-1), 'disconnected');
const replacement = channel();
link.peer.emit('connection', replacement);
assert.equal(link.channel, replacement);
assert.equal(statuses.at(-1), 'incoming');

link.close();
console.log('Host retry check passed');
