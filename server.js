import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import TelegramBot from 'node-telegram-bot-api';
import path from 'path';
import { fileURLToPath } from 'url';

// ====== НАСТРОЙКИ ======
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN не задан!");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== EXPRESS + WS ======
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Раздаём Mini App
app.use(express.static(path.join(__dirname, "public")));

// ====== TELEGRAM BOT ======
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ====== ХРАНИЛИЩЕ (в памяти) ======
const rooms = new Map(); 
// roomId -> {
//   host: ws,
//   players: [ws],
//   roundActive: false,
//   word: null,
//   timeLeft: 60,
//   timer: null,
//   turn: 0,
//   teams: { A: [], B: [] },
//   roles: { explainer: ws, guesser: ws },
//   scores: { A: 0, B: 0 }
// }

const users = new Map(); 
// ws -> { userId, username, roomId, tgId }

// ====== ВСПОМОГАТЕЛЬНЫЕ ======

function shortRoomId() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function broadcast(roomId, data) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.players.forEach(ws => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  });
}

function assignTeams(room) {
  room.teams.A = [];
  room.teams.B = [];

  room.players.forEach((ws, i) => {
    if (i % 2 === 0) room.teams.A.push(ws);
    else room.teams.B.push(ws);
  });
}

function startRoundTimer(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.timeLeft = 60;

  room.timer = setInterval(() => {
    room.timeLeft--;

    broadcast(roomId, {
      type: "TIMER",
      time: room.timeLeft
    });

    if (room.timeLeft <= 0) {
      clearInterval(room.timer);
      room.roundActive = false;

      broadcast(roomId, {
        type: "LAST_WORD"
      });
    }
  }, 1000);
}

function pickRoles(room) {
  const team = room.turn % 2 === 0 ? room.teams.A : room.teams.B;
  room.roles.explainer = team[0];
  room.roles.guesser = team[1];
  room.turn++;
}

// ====== WEBSOCKET ======
wss.on("connection", (ws) => {

  ws.on("message", async (raw) => {
    const msg = JSON.parse(raw);

    switch (msg.type) {

      // ===== РЕГИСТРАЦИЯ =====
      case "REGISTER":
        users.set(ws, {
          userId: msg.userId,
          username: msg.username,
          tgId: msg.tgId || null,
          roomId: null
        });

        ws.send(JSON.stringify({ type: "REGISTERED" }));
        break;

      // ===== СПИСОК ОНЛАЙН-ДРУЗЕЙ =====
      case "GET_ONLINE_USERS":
        const online = [];
        for (let u of users.values()) {
          online.push({ userId: u.userId, username: u.username });
        }

        ws.send(JSON.stringify({
          type: "ONLINE_USERS",
          users: online
        }));
        break;

      // ===== СОЗДАТЬ КОМНАТУ =====
      case "CREATE_ROOM": {
        const roomId = shortRoomId();

        rooms.set(roomId, {
          host: ws,
          players: [ws],
          roundActive: false,
          word: null,
          timeLeft: 60,
          timer: null,
          turn: 0,
          teams: { A: [], B: [] },
          roles: { explainer: null, guesser: null },
          scores: { A: 0, B: 0 }
        });

        users.get(ws).roomId = roomId;

        ws.send(JSON.stringify({
          type: "ROOM_CREATED",
          roomId
        }));
        break;
      }

      // ===== ПРИГЛАСИТЬ ЧЕРЕЗ БОТА =====
      case "INVITE": {
        const { roomId, targetUserId } = msg;
        const room = rooms.get(roomId);

        if (!room) {
          ws.send(JSON.stringify({ type: "ERROR", text: "Комната не найдена" }));
          return;
        }

        let targetWs = null;
        let targetUser = null;

        for (let [sock, u] of users.entries()) {
          if (u.userId === targetUserId) {
            targetWs = sock;
            targetUser = u;
            break;
          }
        }

        if (!targetWs) {
          ws.send(JSON.stringify({ type: "ERROR", text: "Пользователь не онлайн" }));
          return;
        }

        // Отправляем приглашение в Mini App
        targetWs.send(JSON.stringify({
          type: "INVITE",
          roomId,
          from: users.get(ws).username
        }));

        // Отправляем уведомление в Telegram, если есть tgId
        if (targetUser.tgId) {
          await bot.sendMessage(
            targetUser.tgId,
            `📨 Вас пригласили в комнату *${roomId}*\n\nОткройте приложение Elians и нажмите «Войти в комнату».`,
            { parse_mode: "Markdown" }
          );
        }

        break;
      }

      // ===== ПРИНЯТЬ ПРИГЛАШЕНИЕ =====
      case "JOIN_ROOM": {
        const { roomId } = msg;
        const room = rooms.get(roomId);

        if (!room) {
          ws.send(JSON.stringify({ type: "ERROR", text: "Комната не найдена" }));
          return;
        }

        if (room.players.includes(ws)) {
          return;
        }

        room.players.push(ws);
        users.get(ws).roomId = roomId;

        assignTeams(room);

        broadcast(roomId, {
          type: "PLAYERS_UPDATE",
          players: room.players.map(p => users.get(p).username),
          teams: {
            A: room.teams.A.map(p => users.get(p).username),
            B: room.teams.B.map(p => users.get(p).username)
          }
        });

        break;
      }

      // ===== СТАРТ РАУНДА =====
      case "START_ROUND": {
        const user = users.get(ws);
        const room = rooms.get(user.roomId);

        if (!room) return;

        room.roundActive = true;
        room.word = msg.word || "САМОЛЁТ"; // потом заменим на список слов

        assignTeams(room);
        pickRoles(room);
        startRoundTimer(user.roomId);

        broadcast(user.roomId, {
          type: "ROUND_START",
          word: room.word,
          time: room.timeLeft,
          explainer: users.get(room.roles.explainer).username,
          guesser: users.get(room.roles.guesser).username
        });
        break;
      }

      // ===== ПОДСКАЗКА =====
      case "HINT": {
        const user = users.get(ws);
        broadcast(user.roomId, {
          type: "HINT",
          text: msg.text,
          from: user.username
        });
        break;
      }

      // ===== УГАДЫВАНИЕ =====
      case "GUESS": {
        const user = users.get(ws);
        broadcast(user.roomId, {
          type: "GUESS",
          text: msg.text,
          from: user.username
        });
        break;
      }

      // ===== СКИП =====
      case "SKIP": {
        const user = users.get(ws);
        const room = rooms.get(user.roomId);

        room.scores.A -= 1;

        broadcast(user.roomId, {
          type: "SCORE_UPDATE",
          scores: room.scores
        });
        break;
      }

      // ===== УГАДАЛИ =====
      case "CORRECT": {
        const user = users.get(ws);
        const room = rooms.get(user.roomId);

        room.scores.A += 1;

        broadcast(user.roomId, {
          type: "SCORE_UPDATE",
          scores: room.scores
        });
        break;
      }

      // ===== ПОСЛЕДНЕЕ СЛОВО =====
      case "LAST_WORD": {
        const user = users.get(ws);
        broadcast(user.roomId, { type: "LAST_WORD" });
        break;
      }
    }
  });

  ws.on("close", () => {
    const user = users.get(ws);
    if (!user) return;

    const roomId = user.roomId;
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.players = room.players.filter(p => p !== ws);

      if (room.players.length === 0) {
        rooms.delete(roomId);
      } else {
        assignTeams(room);
        broadcast(roomId, {
          type: "PLAYERS_UPDATE",
          players: room.players.map(p => users.get(p)?.username),
          teams: {
            A: room.teams.A.map(p => users.get(p).username),
            B: room.teams.B.map(p => users.get(p).username)
          }
        });
      }
    }

    users.delete(ws);
  });
});

// ====== ЗАПУСК ======
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
