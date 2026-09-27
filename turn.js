import { TURN_CREDENTIALS_URL } from './turn-config.js';

const DEFAULT_STUN = { urls: 'stun:stun.l.google.com:19302' };

export function parseTurnServers(payload) {
  const servers = Array.isArray(payload) ? payload : payload?.iceServers;
  if (!Array.isArray(servers)) return [];
  return servers.filter((server) => {
    const urls = Array.isArray(server?.urls) ? server.urls : [server?.urls];
    return urls.some((url) => typeof url === 'string' && /^turns?:/i.test(url))
      && typeof server.username === 'string'
      && typeof server.credential === 'string';
  });
}

export async function peerOptions(fetchCredentials = fetch, endpoint = TURN_CREDENTIALS_URL) {
  if (!endpoint) return undefined;
  try {
    const response = await fetchCredentials(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (!response.ok) return undefined;
    const turnServers = parseTurnServers(await response.json());
    if (!turnServers.length) return undefined;
    return { config: { iceServers: [DEFAULT_STUN, ...turnServers] } };
  } catch {
    // A TURN outage must not prevent the existing direct connection path.
    return undefined;
  }
}
