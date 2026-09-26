// MechArena shared-world server: WebSocket rooms, authoritative positions, 15Hz snapshots.
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8787;
const TICK_MS = 1000 / 15;
const SPEED = 6.0; // units per second
const BOUND = 48;  // world half-size

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, players: players.size }));
    return;
  }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({ server });
server.listen(PORT, () => console.log(`mecharena server listening on :${PORT}`));
const players = new Map(); // id -> { ws, x, z, rotY, dx, dz, name, color }
let nextId = 1;

function broadcast(msg, exceptId) {
  const s = JSON.stringify(msg);
  for (const [id, p] of players) if (id !== exceptId && p.ws.readyState === 1) p.ws.send(s);
}

function spawnPos() {
  return { x: (Math.random() - 0.5) * 20, z: (Math.random() - 0.5) * 20 };
}

wss.on('connection', (ws) => {
  const id = nextId++;
  const { x, z } = spawnPos();
  const p = {
    ws, x, z, rotY: 0, dx: 0, dz: 0,
    name: `Mech-${id}`,
    color: Math.floor(Math.random() * 0xffffff),
  };
  players.set(id, p);

  ws.send(JSON.stringify({
    type: 'welcome', id,
    players: [...players.entries()].map(([pid, q]) => ({
      id: pid, x: q.x, z: q.z, rotY: q.rotY, name: q.name, color: q.color,
    })),
  }));
  broadcast({ type: 'join', id, x, z, rotY: 0, name: p.name, color: p.color }, id);
  console.log(`join ${id} (${players.size} online)`);

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'input') {
      // dx/dz are normalized joystick axes in [-1,1]; rotY is facing (radians)
      const len = Math.hypot(m.dx ?? 0, m.dz ?? 0);
      const k = len > 1 ? 1 / len : 1;
      p.dx = (m.dx ?? 0) * k;
      p.dz = (m.dz ?? 0) * k;
      if (typeof m.rotY === 'number' && len > 0.1) p.rotY = m.rotY;
      if (typeof m.name === 'string' && m.name.trim()) p.name = m.name.trim().slice(0, 16);
    } else if (m.type === 'chat' && typeof m.text === 'string') {
      broadcast({ type: 'chat', id, text: m.text.slice(0, 120) });
    }
  });

  ws.on('close', () => {
    players.delete(id);
    broadcast({ type: 'leave', id });
    console.log(`leave ${id} (${players.size} online)`);
  });
});

setInterval(() => {
  const dt = TICK_MS / 1000;
  for (const p of players.values()) {
    p.x = Math.max(-BOUND, Math.min(BOUND, p.x + p.dx * SPEED * dt));
    p.z = Math.max(-BOUND, Math.min(BOUND, p.z + p.dz * SPEED * dt));
  }
  if (players.size === 0) return;
  broadcast({
    type: 'state',
    players: [...players.entries()].map(([id, p]) => [id, +p.x.toFixed(3), +p.z.toFixed(3), +p.rotY.toFixed(3), p.name, p.color]),
  });
}, TICK_MS);

console.log(`mecharena server listening on :${PORT}`);
