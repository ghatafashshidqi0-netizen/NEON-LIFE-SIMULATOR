const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

const players = {};

io.on("connection", socket => {
  console.log("Player connected:", socket.id);

  players[socket.id] = {
    id: socket.id,
    name: "Player",
    x: 350,
    y: 260,
    color: "#00e5ff",
    place: "city"
  };

  socket.emit("players", players);
  socket.broadcast.emit("playerJoined", players[socket.id]);

  socket.on("updatePlayer", data => {
    if (!players[socket.id]) return;

    players[socket.id] = {
      ...players[socket.id],
      name: String(data.name || "Player").slice(0, 20),
      x: Math.max(0, Math.min(700, Number(data.x) || 0)),
      y: Math.max(0, Math.min(500, Number(data.y) || 0)),
      place: String(data.place || "city").slice(0, 30)
    };

    socket.broadcast.emit("playerMoved", players[socket.id]);
  });

  socket.on("chat", message => {
    const text = String(message || "").slice(0, 200);
    if (!text.trim()) return;

    io.emit("chat", {
      id: socket.id,
      name: players[socket.id]?.name || "Player",
      message: text
    });
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("playerLeft", socket.id);
  });
});

app.get("/", (req, res) => {
  res.send("NEON LIFE ONLINE SERVER ACTIVE");
});

server.listen(process.env.PORT || 3000, () => {
  console.log("NEON LIFE ONLINE running!");
});
