import { normalizeRoomCode } from './peer.js?v=20260927b';

const RELAY_URL = 'wss://router.metapage.io/ils-room-';
const PROTOCOL = 1;
const JOIN_TIMEOUT_MS = 6000;
const HEARTBEAT_MS = 1200;
const LOST_MS = 10000;
const RECOVERY_MS = 60000;
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
    this.recovering = false;
    this.remoteId = null;
    this.previousRemoteId = null;
    this.lastSeen = 0;
    this.sequence = 0;
    this.expected = 1;
    this.pending = new Map();
    this.received = new Map();
    this.joinTimer = null;
    this.heartbeatTimer = null;
    this.retryTimer = null;
    this.joinTimeout = null;
    this.joinResolve = null;
    this.joinReject = null;
    this.reconnectTimer = null;
    this.recoveryTimer = null;
    this.reconnectDelay = 500;
  }

  async createRoom(value) {
    const code = normalizeRoomCode(value);
    if (!code) throw new Error('Invalid room code.');
    this.code = code;
    this.isHost = true;
    await this.openSocket();
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
      }, this.recovering ? 4000 : 8000);
      socket.onopen = () => {
        if (settled || this.closed) return;
        settled = true;
        clearTimeout(timeout);
        if (!this.heartbeatTimer) this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
        if (!this.retryTimer) this.retryTimer = setInterval(() => this.retryPending(), RETRY_MS);
        resolve();
      };
      socket.onmessage = (event) => { if (this.socket === socket) this.receive(event.data); };
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
        } else if (!this.closed && this.socket === socket) {
          this.failJoin(new Error('Connection service unavailable.'));
          if (this.connected || this.isHost) this.startRecovery();
          else this.onStatus('service-error');
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

  startRecovery() {
    if (this.closed) return;
    if (!this.recovering) {
      this.recovering = true;
      this.reconnectDelay = 500;
      this.onStatus('reconnecting');
      this.recoveryTimer = setTimeout(() => {
        if (!this.recovering) return;
        this.recovering = false;
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.drop();
      }, RECOVERY_MS);
    }
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.close();
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.closed || !this.recovering || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.closed || !this.recovering) return;
      try {
        await this.openSocket();
        if (this.closed || !this.recovering) return;
        if (this.remoteId) this.rawSend({ type: 'probe', from: this.id, to: this.remoteId });
        else this.finishRecovery();
      } catch {
        if (!this.closed && this.recovering) {
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 3000);
          this.scheduleReconnect();
        }
      }
    }, this.reconnectDelay);
  }

  finishRecovery() {
    if (!this.recovering) return;
    this.recovering = false;
    clearTimeout(this.recoveryTimer);
    clearTimeout(this.reconnectTimer);
    this.recoveryTimer = null;
    this.reconnectTimer = null;
    this.lastSeen = Date.now();
    if (this.connected) {
      this.onStatus('resumed');
      for (const pending of this.pending.values()) {
        pending.lastSent = Date.now();
        this.rawSend(pending.message);
      }
    } else if (this.isHost) this.onStatus('room-ready');
  }

  receive(raw) {
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (message?.v !== PROTOCOL || typeof message.type !== 'string') return;
    const joiningId = message.type === 'join' ? message.id : message.type === 'probe' && !this.remoteId && message.to === this.id ? message.from : null;
    if (this.isHost && typeof joiningId === 'string') {
      if (this.remoteId && this.remoteId !== joiningId) {
        this.rawSend({ type: 'full', to: joiningId });
      } else {
        if (!this.remoteId) {
          if (this.previousRemoteId !== joiningId) {
            this.sequence = 0;
            this.expected = 1;
            this.received.clear();
          }
          this.previousRemoteId = null;
          this.onStatus('incoming');
        }
        this.remoteId = joiningId;
        this.rawSend({ type: 'welcome', to: joiningId, id: this.id });
        this.finishRecovery();
        if (!this.connected) this.setConnected();
      }
      return;
    }
    if (!this.isHost && message.type === 'welcome' && message.to === this.id && typeof message.id === 'string') {
      if (this.remoteId && this.remoteId !== message.id) return;
      const stale = this.connected && Date.now() - this.lastSeen > LOST_MS;
      this.remoteId = message.id;
      this.lastSeen = Date.now();
      this.finishRecovery();
      if (!this.connected) {
        this.setConnected();
        this.clearJoin();
        this.joinResolve?.(this.code);
        this.joinResolve = null;
        this.joinReject = null;
      } else if (stale) this.onStatus('connected');
      return;
    }
    if (!this.isHost && message.type === 'full' && message.to === this.id) {
      this.failJoin(new Error('Room is full.'));
      return;
    }
    if (!this.remoteId || message.from !== this.remoteId || message.to !== this.id) return;
    this.lastSeen = Date.now();
    if (message.type === 'bye') {
      this.drop(message.reason === 'disconnect' ? 'disconnected' : 'left');
      if (!this.isHost && message.reason === 'disconnect') this.close();
      return;
    }
    this.finishRecovery();
    if (message.type === 'probe') {
      this.rawSend({ type: 'probe-ack', from: this.id, to: this.remoteId });
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
    if (this.recovering) {
      if (this.remoteId) this.rawSend({ type: 'probe', from: this.id, to: this.remoteId });
      return;
    }
    if (!this.connected) return;
    if (Date.now() - this.lastSeen > LOST_MS) { this.startRecovery(); return; }
    this.rawSend({ type: 'heartbeat', from: this.id, to: this.remoteId });
  }

  retryPending() {
    if (!this.connected || this.recovering) return;
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
    if (!this.recovering) this.rawSend(message);
    return true;
  }

  wake() {
    if (this.closed) return;
    if (this.recovering) {
      if (this.socket?.readyState === WebSocket.OPEN && this.remoteId) {
        this.rawSend({ type: 'probe', from: this.id, to: this.remoteId });
      }
      return;
    }
    if (this.socket?.readyState !== WebSocket.OPEN) {
      if (this.isHost || this.connected) this.startRecovery();
    } else if (this.remoteId) {
      this.rawSend({ type: 'probe', from: this.id, to: this.remoteId });
    }
  }

  drop(status = 'disconnected') {
    const wasConnected = this.connected;
    this.recovering = false;
    clearTimeout(this.recoveryTimer);
    clearTimeout(this.reconnectTimer);
    this.recoveryTimer = null;
    this.reconnectTimer = null;
    this.connected = false;
    this.previousRemoteId = this.remoteId;
    this.remoteId = null;
    this.pending.clear();
    this.received.clear();
    if (wasConnected) this.onStatus(status);
  }

  disconnectOpponent() {
    if (!this.connected || !this.remoteId) return;
    this.rawSend({ type: 'bye', from: this.id, to: this.remoteId, reason: 'disconnect' });
    this.drop();
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
    clearInterval(this.heartbeatTimer);
    clearInterval(this.retryTimer);
    clearTimeout(this.recoveryTimer);
    clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
    this.connected = false;
  }
}
