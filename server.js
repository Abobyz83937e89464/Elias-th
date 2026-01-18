import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import TelegramBot from 'node-telegram-bot-api';
import { v4 as uuidv4 } from 'uuid';
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

// Кнопка Mini App
const MINI_APP_URL = process.env.RENDER_EXTERNAL_URL
  ? `https://${process.env.RENDER_EXTERNAL_URL}`
  : "http://localhost:3000";

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  const text = `Приветствую! 👋\n\n` +
    `Вы попали в бота *Elians*, созданного Morpheus (Nikita).\n\n` +
    `👉 Нажмите кнопку *Elians* ниже, чтобы открыть приложение и начать игру.\n\n` +
    `В приложении вы сможете:\n` +
    `• выбрать режим\n` +
    `• прочитать правила\n` +
    `• создать комнату\n` +
    `• пригласить друзей\n` +
    `• играть в Alias в реальном времени.\n\n` +
    `Удачной игры! ✨`;

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🎮 Elians",
            web_app: { url: MINI_APP_URL }
          }
        ]
      ]
    }
  });
});

// ====== ХРАНИЛИЩЕ (в памяти) ======
const rooms = new Map(); // roomId -> { players, host, roundActive, word, turn, scores }
const users = new Map(); // ws -> { userId, username, roomId }

// ====== ВСПОМОГАТЕЛЬНЫЕ ======
function broadcast(roomId, data) {
  rooms.get(roomId)?.players.forEach(ws => {
    if (ws.readyState === 1) ws.send(JSON.stringify(data));
  });
}

// ====== WEBSOCKET ======
wss.on("connection", (ws, req) => {

  ws.on("message", async (raw) => {
    const msg = JSON.parse(raw);

    switch (msg.type) {

      // ===== РЕГИСТРАЦИЯ =====
      case "REGISTER":
        users.set(ws, {
          userId: msg.userId,
          username: msg.username,
          roomId: null
        });
        ws.send(JSON.stringify({ type: "REGISTERED" }));
        break;

      // ===== СОЗДАТЬ КОМНАТУ =====
      case "CREATE_ROOM": {
        const roomId = uuidv4();
        rooms.set(roomId, {
          host: ws,
          players: [ws],
          roundActive: false,
          word: null,
          turn: 0,
          scores: { A: 0, B: 0 }
        });

        users.get(ws).roomId = roomId;

        ws.send(JSON.stringify({
          type: "ROOM_CREATED",
          roomId
        }));
        break;
      }

      // ===== ПРИГЛАСИТЬ В КОМНАТУ =====
      case "INVITE": {
        const { roomId, targetUserId } = msg;

        // Найдём WS целевого пользователя
        let targetWs = null;
        for (let [sock, u] of users.entries()) {
          if (u.userId === targetUserId) targetWs = sock;
        }

        if (!targetWs) {
          ws.send(JSON.stringify({ type: "ERROR", text: "Пользователь не онлайн" }));
          return;
        }

        targetWs.send(JSON.stringify({
          type: "INVITE",
          roomId,
          from: users.get(ws).username
        }));
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

        room.players.push(ws);
        users.get(ws).roomId = roomId;

        // Обновляем список игроков всем
        broadcast(roomId, {
          type: "PLAYERS_UPDATE",
          players: room.players.map(p => users.get(p).username)
        });
        break;
      }

      // ===== СТАРТ РАУНДА =====
      case "START_ROUND": {
        const user = users.get(ws);
        const room = rooms.get(user.roomId);

        room.roundActive = true;
        room.word = "САМОЛЁТ"; // временно — потом заменим на список слов

        broadcast(user.roomId, {
          type: "ROUND_START",
          word: room.word,
          time: 60
        });
        break;
      }

      // ===== ПОДСКАЗКА В РЕАЛЬНОМ ВРЕМЕНИ =====
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
        broadcast(user.roomId, {
          type: "LAST_WORD"
        });
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

      broadcast(roomId, {
        type: "PLAYERS_UPDATE",
        players: room.players.map(p => users.get(p)?.username)
      });
    }

    users.delete(ws);
  });
});

// ====== ЗАПУСК ======
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
