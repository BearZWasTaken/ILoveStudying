import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PeerLink } from './peer.js';

const statuses = [];
const link = new PeerLink(() => {}, (status) => statuses.push(status));
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

link.close();
console.log('Host retry check passed');
