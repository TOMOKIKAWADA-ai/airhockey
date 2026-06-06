import http from 'node:http';
import { WebSocketServer } from 'ws';
import { MESSAGE_TYPES, SERVER } from '../src/shared/constants.js';
import {
  createInitialGameState,
  resetMatch,
  serializeState,
  setPlayerConnected,
  stepGame,
  updateInput,
} from '../src/shared/game.js';

const port = Number(process.env.PORT || SERVER.port);
const allowTestApi = process.env.AIR_HOCKEY_TEST_API === '1';

const rooms = new Map();
let nextClientId = 1;

const httpServer = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/health') {
    writeJson(res, 200, {
      ok: true,
      rooms: rooms.size,
      uptime: process.uptime(),
    });
    return;
  }

  if (allowTestApi && req.url?.startsWith('/__test/')) {
    await handleTestApi(req, res);
    return;
  }

  writeJson(res, 404, { error: 'not found' });
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  const client = {
    id: `c${nextClientId++}`,
    ws,
    roomId: null,
    role: null,
    alive: true,
  };

  ws.on('message', (data) => {
    const message = parseMessage(data);
    if (!message) {
      send(ws, { type: MESSAGE_TYPES.error, message: 'Invalid JSON message' });
      return;
    }
    handleMessage(client, message);
  });

  ws.on('close', () => {
    handleDisconnect(client);
  });

  ws.on('error', () => {
    handleDisconnect(client);
  });

  send(ws, {
    type: 'hello',
    clientId: client.id,
  });
});

function handleMessage(client, message) {
  switch (message.type) {
    case MESSAGE_TYPES.join:
      joinRoom(client, sanitizeRoomId(message.roomId));
      break;
    case MESSAGE_TYPES.input:
      handleInput(client, message.input);
      break;
    case MESSAGE_TYPES.restart:
      handleRestart(client);
      break;
    case MESSAGE_TYPES.ping:
      send(client.ws, { type: MESSAGE_TYPES.pong, now: Date.now() });
      break;
    default:
      send(client.ws, { type: MESSAGE_TYPES.error, message: `Unknown message type: ${message.type}` });
  }
}

function joinRoom(client, roomId) {
  if (!roomId) {
    send(client.ws, { type: MESSAGE_TYPES.error, message: 'Room ID is required' });
    return;
  }

  if (client.roomId) {
    leaveRoom(client);
  }

  const room = getRoom(roomId);
  client.roomId = roomId;

  if (!room.players.p1) {
    client.role = 'p1';
    room.players.p1 = client.id;
    setPlayerConnected(room.state, 'p1', true);
  } else if (!room.players.p2) {
    client.role = 'p2';
    room.players.p2 = client.id;
    setPlayerConnected(room.state, 'p2', true);
  } else {
    client.role = 'spectator';
    room.spectators.add(client.id);
  }

  room.clients.set(client.id, client);
  room.updatedAt = Date.now();

  send(client.ws, {
    type: MESSAGE_TYPES.joined,
    clientId: client.id,
    roomId,
    role: client.role,
  });
  broadcastState(room);
}

function handleInput(client, input) {
  if (!client.roomId || client.role === 'spectator') return;
  const room = rooms.get(client.roomId);
  if (!room) return;
  updateInput(room.state, client.role, input || {}, Date.now());
  room.updatedAt = Date.now();
}

function handleRestart(client) {
  if (!client.roomId || client.role === 'spectator') return;
  const room = rooms.get(client.roomId);
  if (!room) return;
  resetMatch(room.state, Date.now());
  room.updatedAt = Date.now();
  broadcastState(room);
}

function handleDisconnect(client) {
  if (!client.roomId) return;
  leaveRoom(client);
}

function leaveRoom(client) {
  const room = rooms.get(client.roomId);
  if (!room) return;

  room.clients.delete(client.id);
  if (client.role === 'p1' || client.role === 'p2') {
    if (room.players[client.role] === client.id) {
      room.players[client.role] = null;
      setPlayerConnected(room.state, client.role, false);
      broadcast(room, {
        type: MESSAGE_TYPES.peerDisconnected,
        role: client.role,
        message: `${client.role.toUpperCase()} disconnected`,
      });
    }
  } else if (client.role === 'spectator') {
    room.spectators.delete(client.id);
  }

  client.roomId = null;
  client.role = null;
  room.updatedAt = Date.now();

  if (room.clients.size === 0) {
    room.emptySince = Date.now();
  }
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      state: createInitialGameState(roomId),
      clients: new Map(),
      players: { p1: null, p2: null },
      spectators: new Set(),
      updatedAt: Date.now(),
      emptySince: null,
    });
  }
  return rooms.get(roomId);
}

function parseMessage(data) {
  try {
    return JSON.parse(data.toString());
  } catch {
    return null;
  }
}

function sanitizeRoomId(roomId) {
  if (typeof roomId !== 'string') return '';
  return roomId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

function send(ws, message) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(room, message) {
  for (const client of room.clients.values()) {
    send(client.ws, message);
  }
}

function broadcastState(room) {
  broadcast(room, {
    type: MESSAGE_TYPES.state,
    state: serializeState(room.state, {
      spectatorCount: room.spectators.size,
    }),
  });
}

let lastTickAt = Date.now();
setInterval(() => {
  const now = Date.now();
  const deltaMs = Math.min(now - lastTickAt, 100);
  lastTickAt = now;

  for (const room of rooms.values()) {
    if (room.clients.size === 0) continue;
    stepGame(room.state, deltaMs, now);
    broadcastState(room);
  }

  cleanupRooms(now);
}, 1000 / SERVER.tickRate);

function cleanupRooms(now) {
  for (const [roomId, room] of rooms.entries()) {
    if (room.clients.size === 0 && room.emptySince && now - room.emptySince > SERVER.staleRoomMs) {
      rooms.delete(roomId);
    }
  }
}

async function handleTestApi(req, res) {
  const roomId = decodeURIComponent(req.url.split('/')[2] || '').split('?')[0];
  const room = rooms.get(roomId);
  if (!room) {
    writeJson(res, 404, { error: 'room not found' });
    return;
  }

  const body = await readBody(req);
  if (body.action === 'placePuck') {
    room.state.puck.x = Number(body.x);
    room.state.puck.y = Number(body.y);
    room.state.puck.vx = Number(body.vx);
    room.state.puck.vy = Number(body.vy);
    room.state.status = 'playing';
    broadcastState(room);
    writeJson(res, 200, { ok: true });
    return;
  }

  if (body.action === 'setScore') {
    room.state.score.p1 = Number(body.p1 || 0);
    room.state.score.p2 = Number(body.p2 || 0);
    broadcastState(room);
    writeJson(res, 200, { ok: true });
    return;
  }

  writeJson(res, 400, { error: 'unknown test action' });
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function writeJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(value));
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

httpServer.listen(port, () => {
  console.log(`Air Hockey WebSocket server listening on http://127.0.0.1:${port}`);
});
