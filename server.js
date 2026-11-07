const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingInterval: 25000,
  pingTimeout: 20000
});

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 20;

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    game: "NEON LIFE Online",
    rooms: rooms.size
  });
});

// =====================================
// ROOM DATABASE
// =====================================

const rooms = new Map();
const playerRooms = new Map();

function createRoom(type = "public", ownerId = null) {
  const id = type === "public"
    ? "city-" + crypto.randomBytes(3).toString("hex")
    : crypto.randomBytes(3).toString("hex").toUpperCase();

  const room = {
    id,
    type,
    ownerId,
    players: new Map(),
    createdAt: Date.now()
  };

  rooms.set(id, room);
  return room;
}

function getPublicRoom() {
  for (const room of rooms.values()) {
    if (
      room.type === "public" &&
      room.players.size < MAX_PLAYERS
    ) {
      return room;
    }
  }

  return createRoom("public");
}

function sanitizeName(name) {
  return String(name || "Guest")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 16) || "Guest";
}

function sanitizeChat(message) {
  return String(message || "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 180);
}

function getPlayerList(room) {
  return [...room.players.values()].map(player => ({
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    direction: player.direction,
    animation: player.animation,
    online: true
  }));
}

function broadcastRoom(room) {
  io.to(room.id).emit("room:players", getPlayerList(room));
}

function leaveRoom(socket) {
  const roomId = playerRooms.get(socket.id);
  if (!roomId) return;

  const room = rooms.get(roomId);

  if (room) {
    room.players.delete(socket.id);
    socket.leave(roomId);

    io.to(roomId).emit("player:left", {
      id: socket.id
    });

    if (room.players.size === 0) {
      rooms.delete(roomId);
    } else {
      broadcastRoom(room);

      if (room.ownerId === socket.id) {
        room.ownerId = room.players.keys().next().value;
      }
    }
  }

  playerRooms.delete(socket.id);
}

function enterRoom(socket, room, name) {
  if (!room || room.players.size >= MAX_PLAYERS) {
    socket.emit("room:error", "Room penuh!");
    return false;
  }

  leaveRoom(socket);

  const player = {
    id: socket.id,
    name: sanitizeName(name),
    x: 350,
    y: 260,
    direction: "down",
    animation: "idle",
    lastMove: 0,
    lastChat: 0
  };

  room.players.set(socket.id, player);
  playerRooms.set(socket.id, room.id);

  socket.join(room.id);

  socket.emit("room:joined", {
    roomId: room.id,
    roomType: room.type,
    maxPlayers: MAX_PLAYERS,
    selfId: socket.id,
    players: getPlayerList(room)
  });

  socket.to(room.id).emit("player:joined", player);

  broadcastRoom(room);
  return true;
}

// =====================================
// ROOM LIST
// =====================================

function getRoomList() {
  return [...rooms.values()]
    .filter(room => room.type === "public")
    .map(room => ({
      id: room.id,
      players: room.players.size,
      maxPlayers: MAX_PLAYERS
    }));
}

// =====================================
// SOCKET CONNECTION
// =====================================

io.on("connection", socket => {
  console.log("Connected:", socket.id);

  socket.emit("server:ready", {
    message: "Welcome to NEON LIFE Online",
    maxPlayers: MAX_PLAYERS
  });

  // -------------------------------
  // JOIN PUBLIC CITY
  // -------------------------------

  socket.on("room:joinPublic", data => {
    const name = sanitizeName(data?.name);
    const room = getPublicRoom();

    enterRoom(socket, room, name);
  });

  // -------------------------------
  // CREATE PRIVATE ROOM
  // -------------------------------

  socket.on("room:createPrivate", data => {
    const name = sanitizeName(data?.name);
    const room = createRoom("private", socket.id);

    enterRoom(socket, room, name);

    socket.emit("room:privateCreated", {
      code: room.id
    });
  });

  // -------------------------------
  // JOIN PRIVATE ROOM
  // -------------------------------

  socket.on("room:joinPrivate", data => {
    const code = String(data?.code || "")
      .trim()
      .toUpperCase();

    const room = rooms.get(code);

    if (!room || room.type !== "private") {
      socket.emit("room:error", "Kode room tidak ditemukan!");
      return;
    }

    enterRoom(
      socket,
      room,
      sanitizeName(data?.name)
    );
  });

  // -------------------------------
  // GET PUBLIC ROOMS
  // -------------------------------

  socket.on("room:getList", () => {
    socket.emit("room:list", getRoomList());
  });

  // -------------------------------
  // PLAYER MOVEMENT
  // -------------------------------

  socket.on("player:move", data => {
    const roomId = playerRooms.get(socket.id);
    const room = rooms.get(roomId);

    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    const now = Date.now();

    // Limit movement packets
    if (now - player.lastMove < 40) return;
    player.lastMove = now;

    const x = Number(data?.x);
    const y = Number(data?.y);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }

    // World boundary
    player.x = Math.max(0, Math.min(2000, x));
    player.y = Math.max(0, Math.min(2000, y));

    const directions = [
      "up",
      "down",
      "left",
      "right"
    ];

    if (directions.includes(data?.direction)) {
      player.direction = data.direction;
    }

    player.animation =
      data?.animation === "walk" ? "walk" : "idle";

    socket.to(roomId).emit("player:moved", {
      id: socket.id,
      x: player.x,
      y: player.y,
      direction: player.direction,
      animation: player.animation
    });
  });

  // -------------------------------
  // CHAT
  // -------------------------------

  socket.on("chat:send", data => {
    const roomId = playerRooms.get(socket.id);
    const room = rooms.get(roomId);

    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    const now = Date.now();

    if (now - player.lastChat < 1000) return;
    player.lastChat = now;

    const message = sanitizeChat(data?.message);
    if (!message) return;

    io.to(roomId).emit("chat:message", {
      id: socket.id,
      name: player.name,
      message,
      time: now
    });
  });

  // -------------------------------
  // DISCONNECT
  // -------------------------------

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
    leaveRoom(socket);
  });

  socket.on("room:leave", () => {
    leaveRoom(socket);
  });
});

// =====================================
// START SERVER
// =====================================

server.listen(PORT, "0.0.0.0", () => {
  console.log("================================");
  console.log(" NEON LIFE ONLINE SERVER");
  console.log(" Port:", PORT);
  console.log(" Max Players:", MAX_PLAYERS);
  console.log("================================");
});
