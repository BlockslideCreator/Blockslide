const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use(express.json());

const GRID_SIZE = 25;
const GAME_DURATION = 120; // seconds

// ===== ACCOUNTS =====
let accounts = {};
try {
    accounts = JSON.parse(fs.readFileSync("accounts.json"));
} catch(e) {
    accounts = {};
}

function saveAccounts() {
    fs.writeFileSync("accounts.json", JSON.stringify(accounts, null, 2));
}

// ===== SERVERS =====
let rooms = {};

function generateCode() {
    let code;
    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (rooms[code]);
    return code;
}

io.on("connection", (socket) => {

    // ===== ACCOUNT CREATION & LOGIN =====
    socket.on("createAccount", ({ username1, username2 }) => {
        if (username1.length < 3) {
            socket.emit("accountError", "First username must be at least 3 characters");
            return;
        }
        if (username2.length < 8) {
            socket.emit("accountError", "Second username must be at least 8 characters");
            return;
        }
        if (accounts[username1]) {
            socket.emit("accountError", "Username already exists");
            return;
        }
        accounts[username1] = { username2 };
        saveAccounts();
        socket.emit("accountSuccess");
    });

    socket.on("login", ({ username1, username2 }) => {
        if (!accounts[username1] || accounts[username1].username2 !== username2) {
            socket.emit("accountError", "Invalid login");
            return;
        }
        socket.username1 = username1;
        socket.username2 = username2;
        socket.emit("loginSuccess");
    });

    // ===== SERVER MANAGEMENT =====
    socket.on("createServer", () => {
        const code = generateCode();
        rooms[code] = {
            host: socket.id,
            players: {},
            lobby: [],
            inGame: false,
            grid: createGrid(),
            timer: GAME_DURATION,
            code
        };
        joinRoom(socket, code);
        socket.emit("serverCreated", code);
    });

    socket.on("joinServer", (code) => {
        if (!rooms[code]) {
            socket.emit("serverError", "Server not found");
            return;
        }
        joinRoom(socket, code);
    });

    socket.on("leaveServer", () => leaveRoom(socket));

    socket.on("startGame", () => {
        const room = rooms[socket.room];
        if (!room || room.host !== socket.id) return;

        room.inGame = true;
        room.grid = createGrid();
        room.timer = GAME_DURATION;

        // spawn only players who were already in lobby
        for (let id in room.players) {
            const p = room.players[id];
            p.inGame = true;
        }

        assignCorners(room);
        io.to(socket.room).emit("gameStarted", room);
        startTimer(socket.room);
    });

    socket.on("move", (direction) => {
        const room = rooms[socket.room];
        if (!room || !room.inGame) return;
        const player = room.players[socket.id];
        if (!player || !player.inGame) return;

        let newX = player.x;
        let newY = player.y;

        if (direction === "ArrowUp") newY--;
        if (direction === "ArrowDown") newY++;
        if (direction === "ArrowLeft") newX--;
        if (direction === "ArrowRight") newX++;

        // bounds
        if (newX < 0 || newY < 0 || newX >= GRID_SIZE || newY >= GRID_SIZE)
            return;

        // collision
        for (let id in room.players) {
            if (id !== socket.id) {
                const other = room.players[id];
                if (other.inGame && other.x === newX && other.y === newY) return;
            }
        }

        player.x = newX;
        player.y = newY;
        room.grid[newY][newX] = player.color;

        io.to(socket.room).emit("updateGame", room);
    });

    socket.on("transferHost", (targetId) => {
        const room = rooms[socket.room];
        if (!room || room.host !== socket.id) return;
        room.host = targetId;
        io.to(socket.room).emit("updateLobby", room);
    });

    socket.on("disconnect", () => leaveRoom(socket, true));
});

function createGrid() {
    let grid = [];
    for (let y = 0; y < GRID_SIZE; y++) {
        grid[y] = [];
        for (let x = 0; x < GRID_SIZE; x++) grid[y][x] = null;
    }
    return grid;
}

function assignCorners(room) {
    const corners = [
        { x: 0, y: 0 },
        { x: GRID_SIZE - 1, y: 0 },
        { x: 0, y: GRID_SIZE - 1 },
        { x: GRID_SIZE - 1, y: GRID_SIZE - 1 }
    ];
    let i = 0;
    for (let id in room.players) {
        const p = room.players[id];
        if (!p.inGame) continue;
        p.x = corners[i].x;
        p.y = corners[i].y;
        i++;
    }
}

function joinRoom(socket, code) {
    const room = rooms[code];
    if (Object.keys(room.players).length >= 4) {
        socket.emit("serverError", "Server full");
        return;
    }

    socket.join(code);
    socket.room = code;

    const colors = ["red", "blue", "yellow", "green"];
    const used = Object.values(room.players).map(p => p.color);
    const color = colors.find(c => !used.includes(c));

    room.players[socket.id] = {
        username1: socket.username1,
        username2: socket.username2,
        color,
        x: 0,
        y: 0,
        inGame: !room.inGame // if mid-game join, won't spawn
    };

    io.to(code).emit("updateLobby", room);
}

function leaveRoom(socket, disconnect = false) {
    const room = rooms[socket.room];
    if (!room) return;

    delete room.players[socket.id];

    if (room.host === socket.id) {
        const ids = Object.keys(room.players);
        if (ids.length > 0) {
            room.host = ids[Math.floor(Math.random() * ids.length)];
        }
    }

    if (Object.keys(room.players).length === 0) {
        delete rooms[socket.room];
    } else {
        io.to(socket.room).emit("updateLobby", room);
    }

    if (!disconnect) socket.leave(socket.room);
}

function startTimer(code) {
    const interval = setInterval(() => {
        const room = rooms[code];
        if (!room || !room.inGame) {
            clearInterval(interval);
            return;
        }

        room.timer--;
        io.to(code).emit("updateGame", room);

        if (room.timer <= 0) {
            room.inGame = false;
            io.to(code).emit("gameEnded", room);
            clearInterval(interval);
        }
    }, 1000);
}

server.listen(3000, () => console.log("Blockslide running on http://localhost:3000"));