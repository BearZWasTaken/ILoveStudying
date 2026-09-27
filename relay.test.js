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

const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
const hostMessages = [];
const hostStatuses = [];
const host = new RelayLink((message) => hostMessages.push(message), (status) => hostStatuses.push(status));
await host.createRoom('ABC234');

const guestMessages = [];
const guestStatuses = [];
const guest = new RelayLink((message) => guestMessages.push(message), (status) => guestStatuses.push(status));
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

host.socket.close();
await wait();
assert.equal(host.recovering, true);
assert.equal(host.send({ type: 'ready', ready: true }), true);
await wait(800);
assert.equal(host.recovering, false);
assert.equal(host.connected, true);
assert.equal(hostStatuses.includes('disconnected'), false);
assert.equal(hostStatuses.includes('resumed'), true);
assert.deepEqual(guestMessages.at(-1), { type: 'ready', ready: true });

host.drop();
assert.equal(host.connected, false);
guest.lastSeen -= 11000;
guest.wake();
await wait();
assert.equal(host.connected, true);
assert.equal(guest.connected, true);
assert.equal(guestStatuses.at(-1), 'connected');
assert.equal(guest.send({ type: 'ready', ready: false }), true);
await wait();
assert.deepEqual(hostMessages.at(-1), { type: 'ready', ready: false });

guest.close();
await wait();
assert.equal(host.connected, false);
assert.equal(hostStatuses.at(-1), 'left');
host.socket.close();
await wait(800);
assert.equal(hostStatuses.at(-1), 'room-ready');
assert.equal(host.connected, false);

const nextGuest = new RelayLink(() => {}, () => {});
await nextGuest.joinRoom('ABC234');
assert.equal(host.connected, true);
assert.equal(nextGuest.send({ type: 'hello', name: 'Next' }), true);
await wait();
assert.deepEqual(hostMessages.at(-1), { type: 'hello', name: 'Next' });
nextGuest.close();
host.close();
console.log('Relay room checks passed');
