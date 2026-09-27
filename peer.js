const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

function encodeSignal(description) {
  const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, description }));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeSignal(text, expectedType) {
  try {
    const normalized = text.trim().replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (parsed.version !== 1 || parsed.description?.type !== expectedType || typeof parsed.description.sdp !== 'string') {
      throw new Error('wrong signal');
    }
    return parsed.description;
  } catch {
    throw new Error(`Invalid ${expectedType === 'offer' ? 'invite' : 'reply'} text.`);
  }
}

function waitForIce(peer) {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(done, 10000);
    function done() {
      clearTimeout(timeout);
      peer.removeEventListener('icegatheringstatechange', check);
      resolve();
    }
    function check() { if (peer.iceGatheringState === 'complete') done(); }
    peer.addEventListener('icegatheringstatechange', check);
  });
}

export class PeerLink {
  constructor(onMessage, onStatus) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.channel = null;
    this.connected = false;
    this.closed = false;
    this.disconnectTimer = null;
    this.peer.addEventListener('connectionstatechange', () => {
      const state = this.peer.connectionState;
      if (state === 'connected') {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = null;
      } else if (state === 'disconnected') {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = setTimeout(() => this.reportDisconnect(), 2500);
      } else if (state === 'failed' || state === 'closed') {
        this.reportDisconnect();
      }
    });
  }

  attach(channel) {
    this.channel = channel;
    channel.addEventListener('open', () => {
      this.connected = true;
      this.onStatus('connected');
    });
    channel.addEventListener('close', () => this.reportDisconnect());
    channel.addEventListener('message', (event) => {
      try { this.onMessage(JSON.parse(event.data)); } catch { /* Ignore malformed packets. */ }
    });
  }

  async createInvite() {
    this.attach(this.peer.createDataChannel('game', { ordered: true }));
    await this.peer.setLocalDescription(await this.peer.createOffer());
    await waitForIce(this.peer);
    return encodeSignal(this.peer.localDescription);
  }

  async acceptInvite(invite) {
    this.peer.addEventListener('datachannel', (event) => this.attach(event.channel), { once: true });
    await this.peer.setRemoteDescription(decodeSignal(invite, 'offer'));
    await this.peer.setLocalDescription(await this.peer.createAnswer());
    await waitForIce(this.peer);
    return encodeSignal(this.peer.localDescription);
  }

  async acceptReply(reply) {
    await this.peer.setRemoteDescription(decodeSignal(reply, 'answer'));
  }

  send(message) {
    if (this.channel?.readyState !== 'open') return false;
    this.channel.send(JSON.stringify(message));
    return true;
  }

  reportDisconnect() {
    if (!this.connected || this.closed) return;
    this.connected = false;
    this.onStatus('disconnected');
  }

  close() {
    this.closed = true;
    clearTimeout(this.disconnectTimer);
    this.channel?.close();
    this.peer.close();
  }
}
