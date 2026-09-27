import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { ACTIONS, ACTION_IDS, canUse, resolveRound } from './game.js';

const source = readFileSync(new URL('./main.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
const queue = [];

function app(role, id = role) {
  const elements = new Map();
  class Element {
    constructor(id = '') {
      this.id = id;
      this.textContent = '';
      this.value = id === 'round-time' ? '1.5' : id === 'lives-count' ? '1' : '';
      this.disabled = false;
      this.style = {};
      this.listeners = new Map();
      this.classes = new Set();
      this.classList = {
        add: (name) => this.classes.add(name),
        remove: (name) => this.classes.delete(name),
        contains: (name) => this.classes.has(name),
        toggle: (name, force) => {
          const add = force === undefined ? !this.classes.has(name) : force;
          if (add) this.classes.add(name);
          else this.classes.delete(name);
        },
      };
    }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    click() { if (!this.disabled) this.listeners.get('click')?.(); }
    append() {}
    replaceChildren() {}
    setAttribute() {}
  }
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  };
  const link = {
    connected: true,
    send(message) { queue.push({ from: id, message: structuredClone(message) }); return true; },
    disconnectOpponent() { this.connected = false; },
    setMatchActive() {},
    close() { this.connected = false; },
  };
  const sandbox = {
    ACTIONS, ACTION_IDS, canUse, resolveRound,
    RoomLink: class {},
    crypto: { randomUUID },
    performance: { now: () => 0 },
    document: {
      getElementById: element,
      createElement: () => new Element(),
      createElementNS: () => new Element(),
      createTextNode: (value) => value,
      querySelectorAll: () => [],
      addEventListener() {},
    },
    window: { scrollTo() {}, addEventListener() {} },
    localStorage: { setItem() {}, getItem: () => null, get length() { return 0; } },
    setTimeout: () => 1,
    clearTimeout() {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
  };
  runInNewContext(`${source}\n globalThis.testApp = {
    setup(nextRole, nextLink) {
      role = nextRole; link = nextLink; phase = 'lobby'; roomCode = 'ABC234';
      settings = { roundTime: 1.5, lives: 1 }; settingsRevision = 0;
      settingsKnown = nextRole === 'host'; localReady = false; remoteReady = false;
      updateReadyUi();
    },
    receive: handleMessage, status: handleStatus, finish,
    state: () => ({ phase, round, matchId: match?.id, localReady, remoteReady, settingsKnown, settingsRevision, pendingStartId }),
  };`, sandbox);
  const api = sandbox.testApp;
  api.setup(role, link);
  return { api, element, link };
}

function deliver(from, recipient) {
  const index = queue.findIndex((entry) => entry.from === from);
  assert.notEqual(index, -1, `No message from ${from}`);
  const [{ message }] = queue.splice(index, 1);
  recipient.api.receive(message);
  return message;
}

const host = app('host');
const guest = app('guest');
host.api.status('connected', 'relay');
guest.api.status('connected', 'relay');
assert.equal(guest.element('ready-button').disabled, true);
guest.element('ready-button').click();
assert.equal(guest.api.state().localReady, false);
deliver('host', guest); // hello
deliver('guest', host); // hello
deliver('host', guest); // settings
assert.equal(guest.element('ready-button').disabled, false);
guest.element('ready-button').click();
assert.equal(guest.api.state().localReady, true);
host.api.receive({ type: 'request-settings' });
deliver('host', guest); // repeated settings must preserve Ready
assert.equal(guest.api.state().localReady, true);
host.element('ready-button').click();
deliver('guest', host); // guest Ready
deliver('host', guest); // host Ready
assert.equal(host.element('start-button').disabled, false);
host.element('start-button').click();
assert.equal(host.api.state().round, 0);
assert.equal(host.api.state().phase, 'game');
deliver('host', guest); // start request
assert.equal(guest.api.state().round, 0);
assert.equal(guest.api.state().phase, 'game');
deliver('guest', host); // start acknowledgement
assert.equal(host.api.state().round, 1);
deliver('host', guest); // first round
assert.equal(guest.api.state().round, 1);
assert.equal(host.api.state().matchId, guest.api.state().matchId);
host.api.finish('lives', 0);
guest.api.finish('lives', 1);
guest.element('again-button').click();
guest.element('ready-button').click();
deliver('host', guest); // previous match's ready false
deliver('guest', host); // previous match's ready false
assert.equal(guest.api.state().localReady, true);
deliver('guest', host); // settings request on return to room
deliver('host', guest); // repeated settings
deliver('guest', host); // rematch Ready arrives while host is on result screen
assert.equal(host.api.state().remoteReady, true);
host.element('again-button').click();
host.element('ready-button').click();
assert.equal(host.api.state().localReady, true);
deliver('host', guest); // rematch Ready
assert.equal(host.element('start-button').disabled, false);
host.link.connected = false;
host.api.status('disconnected');
assert.equal(host.element('lobby-opponent-name').textContent, 'Opponent');
assert.equal(host.element('start-button').disabled, true);

const cancelHost = app('host', 'cancel-host');
const cancelGuest = app('guest', 'cancel-guest');
cancelHost.api.status('connected', 'relay');
cancelGuest.api.status('connected', 'relay');
deliver('cancel-host', cancelGuest);
deliver('cancel-guest', cancelHost);
deliver('cancel-host', cancelGuest);
cancelGuest.element('ready-button').click();
cancelHost.element('ready-button').click();
deliver('cancel-guest', cancelHost);
deliver('cancel-host', cancelGuest);
cancelHost.element('start-button').click();
cancelGuest.element('ready-button').click(); // cancellation crosses Start in flight
deliver('cancel-host', cancelGuest);
assert.equal(cancelGuest.api.state().phase, 'lobby');
deliver('cancel-guest', cancelHost); // ready false
deliver('cancel-guest', cancelHost); // start reject
assert.equal(cancelHost.api.state().phase, 'lobby');

console.log('Ready and first-round handshake checks passed');
