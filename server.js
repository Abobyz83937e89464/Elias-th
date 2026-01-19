import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import TelegramBot from 'node-telegram-bot-api';
import path from 'path';
import { fileURLToPath } from 'url';

// ====== НАСТРОЙКИ ======
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = "8522033211:AAHlMuTys-bIQAWNMFQA0DnOS4CAMYRyj5U";
if (!BOT_TOKEN) throw new Error("BOT_TOKEN не задан!");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== EXPRESS + WS ======
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Health check (важно для Render)
app.get("/health", (req, res) => res.send("OK"));

// ====== TELEGRAM BOT (WEBHOOK) ======
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

const WEBHOOK_URL = process.env.RENDER_EXTERNAL_URL
  ? `https://${process.env.RENDER_EXTERNAL_URL}/bot`
  : `http://localhost:${PORT}/bot`;

bot.setWebHook(WEBHOOK_URL);

// Приём обновлений от Telegram
app.post("/bot", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Кнопка Mini App
const MINI_APP_URL = process.env.RENDER_EXTERNAL_URL
  ? `https://${process.env.RENDER_EXTERNAL_URL}`
  : `http://localhost:${PORT}`;

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  const text = `Приветствую! 👋\n\n` +
    `Вы попали в бота *Elians*, созданного Morpheus (Nikita).\n\n` +
    `👉 Нажмите кнопку *Elians* ниже, чтобы открыть приложение и начать игру.\n\n` +
    `Удачной игры! ✨`;

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[
        { text: "🎮 Elians", web_app: { url: MINI_APP_URL } }
      ]]
    }
  });
});

// ====== ПАМЯТЬ (временное хранилище) ======
const rooms = new Map();   // roomId -> { players, scores, timer, timeLeft }
const users = new Map();   // ws -> { userId, username, roomId, tgId }

// ====== УТИЛИТЫ ======
function shortRoomId() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function broadcast(roomId, data) {
  const room = rooms.get(roomId);
  if (!room) return;
  room.players.forEach(ws => {
    if (ws.readyState === 1) ws.send(JSON.stringify(data));
  });
}

// ====== WEBSOCKET ======
wss.on("connection", (ws) => {

  ws.on("message", async (raw) => {
    const msg = JSON.parse(raw);

    switch (msg.type) {

      case "REGISTER":
        users.set(ws, {
          userId: msg.userId,
          username: msg.username,
          tgId: msg.tgId || null,
          roomId: null
        });
        ws.send(JSON.stringify({ type: "REGISTERED" }));
        break;

      case "GET_ONLINE_USERS":
        const online = Array.from(users.values()).map(u => ({
          userId: u.userId,
          username: u.username
        }));
        ws.send(JSON.stringify({ type: "ONLINE_USERS", users: online }));
        break;

      case "CREATE_ROOM": {
        const roomId = shortRoomId();
        rooms.set(roomId, {
          host: ws,
          players: [ws],
          scores: { A: 0, B: 0 },
          timer: null,
          timeLeft: 60
        });

        users.get(ws).roomId = roomId;

        ws.send(JSON.stringify({
          type: "ROOM_CREATED",
          roomId
        }));
        break;
      }

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

        targetWs.send(JSON.stringify({
          type: "INVITE",
          roomId,
          from: users.get(ws).username
        }));

        if (targetUser.tgId) {
          await bot.sendMessage(
            targetUser.tgId,
            `📨 Вас пригласили в комнату *${roomId}*\nОткройте приложение Elians.`,
            { parse_mode: "Markdown" }
          );
        }
        break;
      }

      case "JOIN_ROOM": {
        const { roomId } = msg;
        const room = rooms.get(roomId);

        if (!room) {
          ws.send(JSON.stringify({ type: "ERROR", text: "Комната не найдена" }));
          return;
        }

        if (!room.players.includes(ws)) {
          room.players.push(ws);
        }

        users.get(ws).roomId = roomId;

        broadcast(roomId, {
          type: "PLAYERS_UPDATE",
          players: room.players.map(p => users.get(p).username)
        });
        break;
      }

      case "START_ROUND": {
        const user = users.get(ws);
        const room = rooms.get(user.roomId);
        if (!room) return;

        room.timeLeft = 60;

        room.timer = setInterval(() => {
          room.timeLeft--;

          broadcast(user.roomId, {
            type: "TIMER",
            time: room.timeLeft
          });

          if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            broadcast(user.roomId, { type: "LAST_WORD" });
          }
        }, 1000);

        broadcast(user.roomId, {
          type: "ROUND_START",
          word: "САМОЛЁТ",
          time: 60
        });
        break;
      }

      case "HINT":
        broadcast(users.get(ws).roomId, {
          type: "HINT",
          text: msg.text,
          from: users.get(ws).username
        });
        break;

      case "GUESS":
        broadcast(users.get(ws).roomId, {
          type: "GUESS",
          text: msg.text,
          from: users.get(ws).username
        });
        break;

      case "SKIP": {
        const room = rooms.get(users.get(ws).roomId);
        room.scores.A -= 1;
        broadcast(users.get(ws).roomId, {
          type: "SCORE_UPDATE",
          scores: room.scores
        });
        break;
      }

      case "CORRECT": {
        const room = rooms.get(users.get(ws).roomId);
        room.scores.A += 1;
        broadcast(users.get(ws).roomId, {
          type: "SCORE_UPDATE",
          scores: room.scores
        });
        break;
      }

      case "LAST_WORD":
        broadcast(users.get(ws).roomId, { type: "LAST_WORD" });
        break;
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
        broadcast(roomId, {
          type: "PLAYERS_UPDATE",
          players: room.players.map(p => users.get(p)?.username)
        });
      }
    }

    users.delete(ws);
  });
});

server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
