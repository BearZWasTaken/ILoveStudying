import assert from 'node:assert/strict';
import { RoomLink } from './link.js';
import { PeerLink } from './peer.js';
import { RelayLink } from './relay.js';

const relayCreate = RelayLink.prototype.createRoom;
const relayJoin = RelayLink.prototype.joinRoom;
const peerCreate = PeerLink.prototype.createRoom;
const peerJoin = PeerLink.prototype.joinRoom;
const peerSend = PeerLink.prototype.send;

RelayLink.prototype.createRoom = async () => { throw new Error('relay offline'); };
RelayLink.prototype.joinRoom = async () => { throw new Error('relay offline'); };
PeerLink.prototype.createRoom = async function () { this.code = 'ABC234'; return this.code; };
PeerLink.prototype.joinRoom = async function (code) { this.code = code; this.connected = true; this.onStatus('connected'); };
PeerLink.prototype.send = () => true;

const host = new RoomLink(() => {}, () => {});
assert.equal(await host.createRoom(), 'ABC234');
assert.equal(host.code, 'ABC234');

const statuses = [];
const guest = new RoomLink(() => {}, (status, detail) => statuses.push([status, detail]));
assert.equal(await guest.joinRoom('ABC234'), 'ABC234');
assert.equal(guest.connected, true);
assert.deepEqual(statuses, [['fallback', undefined], ['connected', 'direct']]);
assert.equal(guest.send({ type: 'hello' }), true);

guest.close();
host.close();
RelayLink.prototype.createRoom = relayCreate;
RelayLink.prototype.joinRoom = relayJoin;
PeerLink.prototype.createRoom = peerCreate;
PeerLink.prototype.joinRoom = peerJoin;
PeerLink.prototype.send = peerSend;
console.log('Direct fallback checks passed');
