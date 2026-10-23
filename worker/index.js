// Agent Ohm site worker: serves the static site (ASSETS) and the live-edit rooms (/api/room/<code>).
//
// A room is one Durable Object holding the open WebSockets of the screens in it - nothing is stored. A screen sends
// {t:'edit', id, text, colour}; the room relays it to the other screens, each paints it and answers {t:'ack', id}, and
// the room routes the ack back to the sender, who shows the measured round trip. Public endpoint, so every message is
// validated here, not trusted from the page: text is capped and only ever rendered as text, colour must be #rrggbb.
import { DurableObject } from 'cloudflare:workers';

const MAX_SCREENS = 8;
const MAX_TEXT = 40;
const MAX_MSGS_PER_SEC = 30;
const ROOM = /^\/api\/room\/([a-z0-9]{6})$/;
const HEX = /^#[0-9a-f]{6}$/i;

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rate = new Map();                       // ws -> {sec, n}; in memory only, a hibernated room starts fresh
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected a websocket', { status: 426 });
    }
    if (this.ctx.getWebSockets().length >= MAX_SCREENS) {
      return new Response('room is full', { status: 429 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID().slice(0, 8) });
    server.send(JSON.stringify({ t: 'hello', you: server.deserializeAttachment().id }));
    this.presence();
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, raw) {
    const now = Math.floor(Date.now() / 1000);
    const r = this.rate.get(ws) || { sec: now, n: 0 };
    if (r.sec !== now) { r.sec = now; r.n = 0; }
    r.n += 1; this.rate.set(ws, r);
    if (r.n > MAX_MSGS_PER_SEC || typeof raw !== 'string' || raw.length > 400) return;

    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const me = ws.deserializeAttachment().id;
    const id = typeof m.id === 'string' ? m.id.slice(0, 16) : '';
    if (m.t === 'edit') {
      const out = { t: 'edit', id, from: me };
      if (typeof m.text === 'string') out.text = m.text.slice(0, MAX_TEXT);
      if (typeof m.colour === 'string' && HEX.test(m.colour)) out.colour = m.colour;
      if (!('text' in out) && !('colour' in out)) return;
      this.send(JSON.stringify(out), (w) => w !== ws);
    } else if (m.t === 'ack' && typeof m.to === 'string') {
      this.send(JSON.stringify({ t: 'ack', id, from: me }), (w) => w.deserializeAttachment().id === m.to);
    }
  }

  webSocketClose(ws) { this.rate.delete(ws); this.presence(ws); }
  webSocketError(ws) { this.rate.delete(ws); this.presence(ws); }

  presence(leaving) {
    const open = this.ctx.getWebSockets().filter((w) => w !== leaving);
    this.send(JSON.stringify({ t: 'presence', screens: open.length }), (w) => w !== leaving);
  }

  send(text, keep) {
    for (const w of this.ctx.getWebSockets()) {
      if (!keep(w)) continue;
      try { w.send(text); } catch { /* a closing socket; presence will catch up */ }
    }
  }
}

export default {
  async fetch(request, env) {
    const m = new URL(request.url).pathname.match(ROOM);
    if (m) return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(request);
    return env.ASSETS.fetch(request);
  },
};
