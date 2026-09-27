import { peerOptions } from './turn.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PEER_PREFIX = 'ils-room-';
const CONNECTION_TIMEOUT_MS = 20000;
const HOST_PENDING_TIMEOUT_MS = 30000;

export function normalizeRoomCode(value) {
  const code = String(value || '').trim().toUpperCase().replace(/[\s-]/g, '');
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code) ? code : null;
}

function randomRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => ALPHABET[byte & 31]).join('');
}

function roomPeerId(code) { return `${PEER_PREFIX}${code.toLowerCase()}`; }

function waitForOpen(peer) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      peer.off('open', onOpen);
      peer.off('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onOpen = () => finish();
    const onError = (error) => finish(error);
    const timeout = setTimeout(() => finish(Object.assign(new Error('Timed out'), { type: 'timeout' })), 20000);
    peer.on('open', onOpen);
    peer.on('error', onError);
  });
}

function roomServiceError(error) {
  const type = typeof error?.type === 'string' ? error.type : 'unknown';
  return new Error(`Could not reach the room service (${type}). Try again.`);
}

export class PeerLink {
  constructor(onMessage, onStatus) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.peer = null;
    this.channel = null;
    this.connected = false;
    this.closed = false;
    this.isHost = false;
    this.code = null;
    this.connectTimeout = null;
    this.hostPendingTimeout = null;
  }

  peerConstructor() {
    if (!window.Peer) throw new Error('Connection service unavailable. Reload and try again.');
    return window.Peer;
  }

  async createRoom() {
    const Peer = this.peerConstructor();
    const options = await peerOptions();
    this.isHost = true;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomRoomCode();
      const peer = new Peer(roomPeerId(code), options);
      try {
        await waitForOpen(peer);
        if (this.closed) { peer.destroy(); throw new Error('Room closed.'); }
        this.peer = peer;
        this.code = code;
        this.listenForGuests();
        return code;
      } catch (error) {
        peer.destroy();
        if (error.type !== 'unavailable-id') throw roomServiceError(error);
      }
    }
    throw new Error('Could not find a free room code. Try again.');
  }

  listenForGuests() {
    this.peer.on('connection', (channel) => {
      if (this.channel && this.connected) {
        channel.on('open', () => {
          channel.send({ type: 'room-full' });
          setTimeout(() => channel.close(), 150);
        });
        return;
      }
      if (this.channel) {
        clearTimeout(this.hostPendingTimeout);
        this.channel.close();
        this.channel = null;
      }
      this.onStatus('incoming');
      this.attach(channel);
    });
    this.peer.on('error', () => this.onStatus('service-error'));
  }

  async joinRoom(value) {
    const code = normalizeRoomCode(value);
    if (!code) throw new Error('Enter a 6-character room code.');
    const Peer = this.peerConstructor();
    const options = await peerOptions();
    const peer = new Peer(options);
    this.peer = peer;
    this.code = code;
    await waitForOpen(peer).catch((error) => { throw roomServiceError(error); });
    if (this.closed) return;
    const channel = peer.connect(roomPeerId(code), { reliable: true, serialization: 'json' });
    this.attach(channel);
    this.connectTimeout = setTimeout(() => {
      if (!this.connected && !this.closed) {
        this.onStatus('connection-timeout', channel.peerConnection?.iceConnectionState || 'unknown');
      }
    }, CONNECTION_TIMEOUT_MS);
    peer.on('error', (error) => {
      if (error.type === 'peer-unavailable') this.onStatus('room-not-found');
      else this.onStatus('service-error');
    });
  }

  attach(channel) {
    this.channel = channel;
    if (this.isHost) {
      clearTimeout(this.hostPendingTimeout);
      this.hostPendingTimeout = setTimeout(() => {
        if (!this.closed && !this.connected && this.channel === channel) {
          this.channel = null;
          channel.close();
        }
      }, HOST_PENDING_TIMEOUT_MS);
    }
    channel.on('open', () => {
      if (this.closed) return;
      clearTimeout(this.connectTimeout);
      clearTimeout(this.hostPendingTimeout);
      this.connected = true;
      this.onStatus('connected');
    });
    channel.on('data', (message) => {
      if (!this.closed && message && typeof message === 'object') this.onMessage(message);
    });
    channel.on('close', () => {
      clearTimeout(this.connectTimeout);
      clearTimeout(this.hostPendingTimeout);
      if (this.closed || this.channel !== channel) return;
      this.channel = null;
      if (this.connected) {
        this.connected = false;
        this.onStatus('disconnected');
      }
    });
    channel.on('error', () => this.onStatus('service-error'));
  }

  send(message) {
    if (!this.channel?.open) return false;
    this.channel.send(message);
    return true;
  }

  close() {
    this.closed = true;
    clearTimeout(this.connectTimeout);
    clearTimeout(this.hostPendingTimeout);
    this.connected = false;
    this.channel?.close();
    this.peer?.destroy();
    this.channel = null;
    this.peer = null;
  }
}
