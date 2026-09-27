import assert from 'node:assert/strict';
import { RelayLink } from './relay.js';

const channels = new Map();
class FakeWebSocket {
  static OPEN = 1;
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    if (!channels.has(url)) channels.set(url, new Set());
    channels.get(url).add(this);
    queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
  }
  send(data) {
    for (const socket of channels.get(this.url)) {
      if (socket !== this && socket.readyState === 1) queueMicrotask(() => socket.onmessage?.({ data }));
    }
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    channels.get(this.url).delete(this);
    queueMicrotask(() => this.onclose?.());
  }
}
globalThis.WebSocket = FakeWebSocket;

const wait = () => new Promise((resolve) => setTimeout(resolve, 10));
const hostMessages = [];
const hostStatuses = [];
const host = new RelayLink((message) => hostMessages.push(message), (status) => hostStatuses.push(status));
await host.createRoom('ABC234');

const guestMessages = [];
const guest = new RelayLink((message) => guestMessages.push(message), () => {});
await guest.joinRoom('ABC234');
assert.equal(host.connected, true);
assert.equal(guest.connected, true);
assert.equal(hostStatuses.includes('incoming'), true);

assert.equal(guest.send({ type: 'choice', action: 'study' }), true);
await wait();
assert.deepEqual(hostMessages, [{ type: 'choice', action: 'study' }]);
assert.equal(guest.pending.size, 0);

assert.equal(host.send({ type: 'settings', lives: 2 }), true);
await wait();
assert.deepEqual(guestMessages, [{ type: 'settings', lives: 2 }]);

guest.close();
await wait();
assert.equal(host.connected, false);

const nextGuest = new RelayLink(() => {}, () => {});
await nextGuest.joinRoom('ABC234');
assert.equal(host.connected, true);
nextGuest.close();
host.close();
console.log('Relay room checks passed');
