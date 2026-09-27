import { normalizeRoomCode } from './peer.js';

const RELAY_URL = 'wss://router.metapage.io/ils-room-';
const PROTOCOL = 1;
const JOIN_TIMEOUT_MS = 6000;
const HEARTBEAT_MS = 1200;
const LOST_MS = 6500;
const RETRY_MS = 500;

export class RelayLink {
  constructor(onMessage, onStatus) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.id = crypto.randomUUID();
    this.socket = null;
    this.code = null;
    this.isHost = false;
    this.connected = false;
    this.closed = false;
    this.remoteId = null;
    this.lastSeen = 0;
    this.sequence = 0;
    this.expected = 1;
    this.pending = new Map();
    this.received = new Map();
    this.beaconTimer = null;
    this.joinTimer = null;
    this.heartbeatTimer = null;
    this.retryTimer = null;
    this.joinTimeout = null;
    this.joinResolve = null;
    this.joinReject = null;
  }

  async createRoom(value) {
    const code = normalizeRoomCode(value);
    if (!code) throw new Error('Invalid room code.');
    this.code = code;
    this.isHost = true;
    await this.openSocket();
    this.beaconTimer = setInterval(() => this.rawSend({ type: 'host', id: this.id }), 1200);
    this.rawSend({ type: 'host', id: this.id });
    return code;
  }

  async joinRoom(value) {
    const code = normalizeRoomCode(value);
    if (!code) throw new Error('Enter a 6-character room code.');
    this.code = code;
    await this.openSocket();
    return new Promise((resolve, reject) => {
      this.joinResolve = resolve;
      this.joinReject = reject;
      this.joinTimer = setInterval(() => this.rawSend({ type: 'join', id: this.id }), 700);
      this.joinTimeout = setTimeout(() => this.failJoin(new Error('Room not found or unavailable.')), JOIN_TIMEOUT_MS);
      this.rawSend({ type: 'join', id: this.id });
    });
  }

  openSocket() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(`${RELAY_URL}${this.code.toLowerCase()}`);
      this.socket = socket;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(new Error('Could not reach the room service.'));
      }, 8000);
      socket.onopen = () => {
        if (settled || this.closed) return;
        settled = true;
        clearTimeout(timeout);
        this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
        this.retryTimer = setInterval(() => this.retryPending(), RETRY_MS);
        resolve();
      };
      socket.onmessage = (event) => this.receive(event.data);
      socket.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error('Could not reach the room service.'));
      };
      socket.onclose = () => {
        clearTimeout(timeout);
        if (!settled) {
          settled = true;
          reject(new Error('Could not reach the room service.'));
        } else if (!this.closed) {
          this.failJoin(new Error('Connection service unavailable.'));
          this.drop('service-error');
        }
      };
    });
  }

  rawSend(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify({ v: PROTOCOL, ...message }));
      return true;
    } catch { return false; }
  }

  receive(raw) {
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (message?.v !== PROTOCOL || typeof message.type !== 'string') return;
    if (this.isHost && message.type === 'join' && typeof message.id === 'string') {
      if (this.remoteId && this.remoteId !== message.id) {
        this.rawSend({ type: 'full', to: message.id });
      } else {
        if (!this.remoteId) this.onStatus('incoming');
        this.remoteId = message.id;
        this.rawSend({ type: 'welcome', to: message.id, id: this.id });
        if (!this.connected) this.setConnected();
      }
      return;
    }
    if (!this.isHost && message.type === 'welcome' && message.to === this.id && typeof message.id === 'string') {
      if (this.remoteId && this.remoteId !== message.id) return;
      this.remoteId = message.id;
      if (!this.connected) {
        this.setConnected();
        this.clearJoin();
        this.joinResolve?.(this.code);
        this.joinResolve = null;
        this.joinReject = null;
      }
      return;
    }
    if (!this.isHost && message.type === 'full' && message.to === this.id) {
      this.failJoin(new Error('Room is full.'));
      return;
    }
    if (!this.remoteId || message.from !== this.remoteId || message.to !== this.id) return;
    this.lastSeen = Date.now();
    if (message.type === 'bye') {
      this.drop('disconnected');
    } else if (message.type === 'data' && Number.isSafeInteger(message.seq) && message.seq > 0) {
      this.rawSend({ type: 'ack', from: this.id, to: this.remoteId, seq: message.seq });
      if (message.seq >= this.expected && message.seq < this.expected + 64 && !this.received.has(message.seq)) {
        this.received.set(message.seq, message.payload);
        while (this.received.has(this.expected)) {
          const payload = this.received.get(this.expected);
          this.received.delete(this.expected);
          this.expected += 1;
          if (payload && typeof payload === 'object') this.onMessage(payload);
        }
      }
    } else if (message.type === 'ack') {
      this.pending.delete(message.seq);
    }
  }

  setConnected() {
    this.connected = true;
    this.lastSeen = Date.now();
    this.onStatus('connected');
  }

  heartbeat() {
    if (!this.connected) return;
    if (Date.now() - this.lastSeen > LOST_MS) { this.drop('disconnected'); return; }
    this.rawSend({ type: 'heartbeat', from: this.id, to: this.remoteId });
  }

  retryPending() {
    if (!this.connected) return;
    const now = Date.now();
    for (const pending of this.pending.values()) {
      if (now - pending.lastSent < RETRY_MS) continue;
      pending.lastSent = now;
      this.rawSend(pending.message);
    }
  }

  send(payload) {
    if (!this.connected || !this.remoteId) return false;
    const seq = ++this.sequence;
    const message = { type: 'data', from: this.id, to: this.remoteId, seq, payload };
    this.pending.set(seq, { message, lastSent: Date.now() });
    this.rawSend(message);
    return true;
  }

  drop(status) {
    const wasConnected = this.connected;
    this.connected = false;
    this.remoteId = null;
    this.pending.clear();
    this.received.clear();
    this.sequence = 0;
    this.expected = 1;
    if (wasConnected) this.onStatus('disconnected');
    else if (status === 'service-error') this.onStatus('service-error');
  }

  clearJoin() {
    clearInterval(this.joinTimer);
    clearTimeout(this.joinTimeout);
    this.joinTimer = null;
    this.joinTimeout = null;
  }

  failJoin(error) {
    if (!this.joinReject) return;
    this.clearJoin();
    this.joinReject(error);
    this.joinResolve = null;
    this.joinReject = null;
  }

  close() {
    if (this.closed) return;
    if (this.connected) this.rawSend({ type: 'bye', from: this.id, to: this.remoteId });
    this.closed = true;
    this.failJoin(new Error('Connection cancelled.'));
    this.clearJoin();
    clearInterval(this.beaconTimer);
    clearInterval(this.heartbeatTimer);
    clearInterval(this.retryTimer);
    this.socket?.close();
    this.socket = null;
    this.connected = false;
  }
}
