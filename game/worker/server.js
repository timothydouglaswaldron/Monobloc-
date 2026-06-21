// ============================================================================
//  Cloudflare Worker + Durable Object room server (via partyserver, the engine
//  PartyKit is built on). Same relay logic as before — one Durable Object per
//  room: tracks players, assigns slots, elects a host, forwards snapshots/hits.
//  Deployed to your own Cloudflare account (avoids the full partykit.dev zone).
// ============================================================================
import { Server, routePartykitRequest } from "partyserver";

const MAX_HUMANS = 8;
const CPU_KEYS = ["amber", "azure", "violet", "lime", "ember", "rival", "striker"];

export class BrawlerRoom extends Server {
  static options = { hibernate: false };   // keep room state in memory while active

  players = new Map();   // connId -> { id, name, charKey, color, sprite, joined }
  cpuCount = 0;
  map = null;
  started = false;

  hostId() {
    let best = null;
    for (const p of this.players.values()) if (!best || p.joined < best.joined) best = p;
    return best ? best.id : null;
  }

  roster() {
    const humans = [...this.players.values()].sort((a, b) => a.joined - b.joined).slice(0, MAX_HUMANS);
    const list = humans.map((p, i) => ({
      id: p.id, name: p.name, charKey: p.charKey, color: p.color, sprite: p.sprite || null,
      spell: p.spell || null, kind: "human", slot: i,
    }));
    const room = MAX_HUMANS - list.length;
    for (let i = 0; i < Math.min(this.cpuCount, room); i++) {
      list.push({ id: "cpu" + i, name: "CPU" + (i + 1), charKey: CPU_KEYS[i % CPU_KEYS.length],
        color: null, sprite: null, kind: "cpu", slot: humans.length + i });
    }
    return list;
  }

  state() {
    return { type: "state", host: this.hostId(), roster: this.roster(),
             map: this.map, cpuCount: this.cpuCount, started: this.started };
  }
  broadcastState() { this.broadcast(JSON.stringify(this.state())); }

  onConnect(conn) {
    conn.send(JSON.stringify({ type: "hello", id: conn.id }));
    // a late connection (e.g. game page after lobby) gets current state immediately
    conn.send(JSON.stringify(this.state()));
  }

  onMessage(conn, raw) {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const id = conn.id;
    switch (msg.type) {
      case "join": {
        const existing = this.players.get(id);
        this.players.set(id, {
          id, name: msg.name || "P", charKey: msg.charKey || "striker",
          color: msg.color || null, sprite: msg.sprite || null, spell: msg.spell || null,
          joined: existing ? existing.joined : Date.now(),
        });
        this.broadcastState();   // existing players reconcile the newcomer in
        // late join: if the match is already running, drop this player straight in
        if (this.started) conn.send(JSON.stringify({ type: "start", roster: this.roster(), map: this.map }));
        break;
      }
      case "setCpu":
        if (id !== this.hostId()) break;
        this.cpuCount = Math.max(0, Math.min(MAX_HUMANS, msg.n | 0));
        this.broadcastState();
        break;
      case "map":
        if (id !== this.hostId()) break;
        this.map = msg.map; this.broadcastState();
        break;
      case "start":
        if (id !== this.hostId()) break;
        this.started = true;
        this.broadcast(JSON.stringify({ type: "start", roster: this.roster(), map: this.map }));
        break;
      case "rematch":   // host restarts a fresh match for everyone (incl. self)
        if (id !== this.hostId()) break;
        this.started = true;
        this.broadcast(JSON.stringify({ type: "rematch", roster: this.roster(), map: this.map }));
        break;
      // realtime relays — forward as-is to everyone but the sender
      case "snapshots":
      case "hit":
      case "proj":
      case "ko":
        this.broadcast(raw, [id]);
        break;
    }
  }

  onClose(conn) {
    if (this.players.delete(conn.id)) {
      if (this.players.size === 0) { this.started = false; this.cpuCount = 0; this.map = null; }
      this.broadcastState();
    }
  }
}

export default {
  async fetch(request, env) {
    return (await routePartykitRequest(request, env)) || new Response("Not found", { status: 404 });
  },
};
