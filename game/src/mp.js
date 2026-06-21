// ============================================================================
//  mp.js — multiplayer client. Owns the PartySocket connection, the lobby UI,
//  and the bridge into the engine (game.js). One persistent socket for the
//  whole session (lobby + match), so player identity never changes.
// ============================================================================
import PartySocket from "partysocket";
import {
  startMultiplayer, syncRoster, receiveSnapshot, receiveHit, receiveProj,
} from "./game.js";
import { allSpells, BUILTIN_SPELLS } from "./spell.js";

const PARTY_HOST = import.meta.env.VITE_PARTY_HOST || "localhost:1999";

// --- stable identity + room ------------------------------------------------
function rid() { return "c" + Math.random().toString(36).slice(2, 9); }
let clientId = sessionStorage.getItem("brawler:cid");
if (!clientId) { clientId = rid(); sessionStorage.setItem("brawler:cid", clientId); }

let room = new URLSearchParams(location.search).get("room");
if (!room) {
  room = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");
  const u = new URL(location.href); u.searchParams.set("room", room); history.replaceState({}, "", u);
}

// --- local profile ----------------------------------------------------------
const profile = {
  name: localStorage.getItem("brawler:name") || ("P" + Math.floor(Math.random() * 90 + 10)),
  charKey: "striker",
  color: localStorage.getItem("brawler:color") || "#54e0c8",
  sprite: null,   // char JSON, sent over the wire so others render it
  spell: BUILTIN_SPELLS["Dash Punch"],  // chosen B-button spell (sent over the wire)
};
// use the creator's draft sprite if present, else the shipped striker
try {
  const draft = localStorage.getItem("brawler:charDraft");
  profile.sprite = draft ? JSON.parse(draft) : null;
} catch {}
// restore the last picked spell
try {
  const name = localStorage.getItem("brawler:spell");
  if (name && allSpells()[name]) profile.spell = allSpells()[name];
} catch {}

// --- DOM --------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

let roomState = { host: null, roster: [], cpuCount: 0, map: null, started: false };
let started = false;
let joined = false;   // have we registered with the room yet?
let socket = null;

// --- selection gate: you must pick a premade fighter + spell before the lobby ---
if (!profile.sprite || !profile.spell) {
  location.href = `${import.meta.env.BASE_URL}select.html?room=${encodeURIComponent(room)}`;
} else {
  runLobby();
}

function runLobby() {
  $("roomCode").textContent = room;
  $("name").value = profile.name;

  // show the chosen loadout + a link back to the select screen to change it
  const fighter = profile.sprite?.name || "fighter";
  $("loadout").textContent = `${fighter} · ${profile.spell?.name || "spell"}`;
  const change = $("changeLink");
  if (change) change.href = `${import.meta.env.BASE_URL}select.html?room=${encodeURIComponent(room)}`;

  // party name = kebab-case of the Durable Object binding "BrawlerRoom"
  socket = new PartySocket({ host: PARTY_HOST, room, id: clientId, party: "brawler-room" });

  // Re-register on reconnect only if we'd already joined; otherwise wait for the
  // player to choose (so late-joiners get a setup step, not an auto-drop).
  socket.addEventListener("open", () => { if (joined) sendJoin(); });
  socket.addEventListener("message", (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    switch (msg.type) {
      case "hello": break;
      case "state":
        roomState = msg;
        // Open lobby (no match yet): auto-register. Match running: hold for Join.
        if (!started && !joined && !msg.started) { joined = true; sendJoin(); }
        renderLobby();
        if (started) syncRoster(toSpecs(msg.roster), msg.host === clientId);
        break;
      case "start": if (!started) beginMatch(msg.roster, msg.map); break;
      case "rematch": beginMatch(msg.roster, msg.map); break;   // force fresh match
      case "snapshots": if (started) msg.snaps.forEach(receiveSnapshot); break;
      case "hit": if (started) receiveHit(msg); break;
      case "proj": if (started) receiveProj(msg); break;
      case "ko": break;
    }
  });

  $("name").addEventListener("change", (e) => {
    profile.name = e.target.value || "P"; localStorage.setItem("brawler:name", profile.name); sendJoin();
  });
  $("cpuPlus").onclick = () => send({ type: "setCpu", n: roomState.cpuCount + 1 });
  $("cpuMinus").onclick = () => send({ type: "setCpu", n: roomState.cpuCount - 1 });
  $("start").onclick = () => {
    if (roomState.started && !started) joinRunningMatch();  // late-join
    else send({ type: "start" });                           // host starts a new match
  };
}

function send(obj) { socket.send(JSON.stringify(obj)); }
function sendJoin() {
  send({ type: "join", name: profile.name, charKey: profile.charKey, color: profile.color,
         sprite: profile.sprite, spell: profile.spell });
}

// Late-join: pick up any character made in the creator, then enter the match.
function joinRunningMatch() {
  try { const d = localStorage.getItem("brawler:charDraft"); if (d) profile.sprite = JSON.parse(d); } catch {}
  joined = true; sendJoin();
  $("start").disabled = true; $("note").textContent = "Joining…";
}

function amHost() { return roomState.host === clientId; }

function renderLobby() {
  const ul = $("players"); ul.innerHTML = "";
  for (const r of roomState.roster) {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "dot"; dot.style.background = r.color || "#3a4654";
    li.appendChild(dot);
    const name = document.createElement("span");
    name.textContent = r.name + (r.id === clientId ? " (you)" : "");
    name.className = r.kind === "cpu" ? "cpu" : (r.id === clientId ? "you" : "");
    li.appendChild(name);
    if (r.id === roomState.host) { const h = document.createElement("span"); h.className = "host"; h.textContent = "HOST"; li.appendChild(h); }
    ul.appendChild(li);
  }

  const joinMode = roomState.started && !started;   // match running, we haven't entered
  const host = amHost();
  const cpu = ["cpuPlus", "cpuMinus"];
  if (joinMode) {
    for (const id of cpu) $(id).style.display = "none";
    $("cpuCount").style.display = "none";
    $("start").textContent = "Join game"; $("start").disabled = joined;
    $("note").textContent = joined ? "Joining…" : "Match in progress — set up your fighter, then join.";
  } else {
    for (const id of cpu) $(id).style.display = "";
    $("cpuCount").style.display = ""; $("cpuCount").textContent = roomState.cpuCount + " CPU";
    $("start").textContent = "Start match";
    for (const id of [...cpu, "start"]) $(id).disabled = !host;
    $("note").textContent = host
      ? "You are host. Add CPUs or wait for players, then Start."
      : "Waiting for the host to start…";
  }
}

// Map the server roster into engine fighter specs, resolving each fighter's
// control source for THIS client (sprite JSON is built into a canvas by the engine).
function toSpecs(roster) {
  const host = amHost();
  return roster.map((r) => ({
    id: r.id, name: r.name, slot: r.slot,
    control: r.kind === "human" ? (r.id === clientId ? "local" : "remote")
                                : (host ? "cpu" : "remote"),
    charKey: r.charKey, color: r.color, spriteJSON: r.sprite || null, spell: r.spell || null,
  }));
}

// --- begin the match (engine hands off rendering + loop) --------------------
async function beginMatch(roster, map) {
  started = true;
  $("lobby").style.display = "none";
  $("results").style.display = "none";   // clear any prior results (rematch)

  if (!map) {
    try { map = await (await fetch(`${import.meta.env.BASE_URL}maps/arena1.json`)).json(); } catch {}
  }
  const net = {
    sendSnapshots: (snaps) => send({ type: "snapshots", snaps }),
    sendHit: (h) => send({ type: "hit", ...h }),
    sendProj: (p) => send({ type: "proj", ...p }),
  };
  startMultiplayer({ net, myId: clientId, amHost: amHost(), map, roster: toSpecs(roster), onOver: showResults });
}

// --- results screen ---------------------------------------------------------
function showResults(winner) {
  // brief beat so the final KO + particles register, then the overlay
  setTimeout(() => {
    const w = $("winner");
    if (winner) { w.textContent = winner.name + " WINS"; w.style.color = winner.color || "#54e0c8"; }
    else { w.textContent = "DRAW"; w.style.color = "#9aa0a6"; }
    const host = amHost();
    $("rematch").style.display = host ? "" : "none";
    $("rematchNote").textContent = host ? "" : "waiting for host to rematch…";
    $("results").style.display = "grid";
  }, 1100);
}

$("rematch").onclick = () => send({ type: "rematch" });
$("leave").onclick = () => { location.href = `${import.meta.env.BASE_URL}index.html`; };

if (new URLSearchParams(location.search).has("debug"))
  window.__mp = { get socket() { return socket; }, send, beginMatch, get joined() { return joined; }, get host() { return amHost(); } };
