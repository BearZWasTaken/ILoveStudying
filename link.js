import { PeerLink, normalizeRoomCode, randomRoomCode } from './peer.js?v=20260928a';
import { RelayLink } from './relay.js?v=20260928a';

export class RoomLink {
  constructor(onMessage, onStatus) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.relay = null;
    this.peer = null;
    this.active = null;
    this.connected = false;
    this.closed = false;
    this.code = null;
  }

  makeRelay() {
    this.relay = new RelayLink(
      (message) => { if (this.active === this.relay) this.onMessage(message); },
      (status) => this.handleStatus(this.relay, status),
    );
    return this.relay;
  }

  makePeer() {
    this.peer = new PeerLink(
      (message) => { if (this.active === this.peer) this.onMessage(message); },
      (status, detail) => this.handleStatus(this.peer, status, detail),
    );
    return this.peer;
  }

  handleStatus(source, status, detail) {
    if (this.closed) return;
    if (status === 'connected') {
      if (this.active && this.active !== source) {
        source.close();
        return;
      }
      this.active = source;
      this.connected = true;
      if (source === this.relay) this.peer?.close();
      else this.relay?.close();
      this.onStatus('connected', source === this.relay ? 'relay' : 'direct');
      return;
    }
    if (status === 'incoming' && (!this.active || this.active === source)) {
      this.onStatus('incoming');
    } else if (source === this.active) {
      if (status === 'disconnected' || status === 'left' || status === 'reconnecting') this.connected = false;
      if (status === 'resumed') this.connected = true;
      this.onStatus(status, detail);
    }
  }

  async createRoom() {
    const code = randomRoomCode();
    const relay = this.makeRelay();
    try {
      await relay.createRoom(code);
      if (this.closed) return code;
      this.code = code;
      const peer = this.makePeer();
      peer.createRoom(code).then(() => {
        if (this.closed || this.active === relay) peer.close();
      }).catch(() => { peer.close(); });
      return code;
    } catch {
      relay.close();
      if (this.closed) throw new Error('Connection cancelled.');
      const peer = this.makePeer();
      this.code = await peer.createRoom();
      return this.code;
    }
  }

  async joinRoom(value) {
    const code = normalizeRoomCode(value);
    if (!code) throw new Error('Enter a 6-character room code.');
    this.code = code;
    const relay = this.makeRelay();
    try {
      await relay.joinRoom(code);
      return code;
    } catch (relayError) {
      relay.close();
      if (this.closed) throw new Error('Connection cancelled.');
      if (relayError.message === 'Room is full.') throw relayError;
      this.onStatus('fallback');
      const peer = this.makePeer();
      await peer.joinRoom(code);
      return code;
    }
  }

  send(message) { return this.active?.send(message) || false; }

  disconnectOpponent() { this.active?.disconnectOpponent(); }

  setMatchActive(active) { this.active?.setMatchActive(active); }

  get recovering() { return this.relay?.recovering === true; }

  wake() {
    if (this.active) this.active.wake();
    else {
      this.relay?.wake();
      this.peer?.wake();
    }
  }

  close() {
    this.closed = true;
    this.connected = false;
    this.relay?.close();
    this.peer?.close();
  }
}
