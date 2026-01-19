import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import TelegramBot from 'node-telegram-bot-api';
import path from 'path';
import { fileURLToPath } from 'url';

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = "8522033211:AAHlMuTys-bIQAWNMFQA0DnOS4CAMYRyj5U";
const APP_URL = "https://твой-адрес.onrender.com"; // ЗАМЕНИ НА СВОЙ АДРЕС ОТ RENDER

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, "public")));

// --- ДИАГНОСТИКА: Зайди на ссылку сервера в браузере, должен увидеть это ---
app.get('/', (req, res) => res.send('<h1>Сервер Elians работает!</h1>'));
app.get('/health', (req, res) => res.sendStatus(200));

// --- НАСТРОЙКА БОТА ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, `Привет, ${msg.from.first_name}! 🎮\nНажми кнопку, чтобы открыть Elians:`, {
    reply_markup: {
      inline_keyboard: [[{ text: "Играть в Elians", web_app: { url: APP_URL } }]]
    }
  });
});

bot.on('polling_error', (err) => console.log("Бот (ошибка):", err.code));

// --- ЛОГИКА ИГРЫ ---
const rooms = new Map();
const users = new Map();
const wordList = ["Самолет", "Телефон", "Компьютер", "Пицца", "Космос", "Гитара", "Остров", "Арбуз", "Танк", "Вертолет", "Кенгуру", "Шоколад"];

function broadcast(roomId, data) {
  const room = rooms.get(roomId);
  if (room) {
    room.players.forEach(p => { if (p.readyState === 1) p.send(JSON.stringify(data)); });
  }
}

wss.on("connection", (ws) => {
  console.log("Новое WS соединение!");
  users.set(ws, { userId: null, username: "Гость", roomId: null, team: null });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch(e) { return; }
    const user = users.get(ws);

    switch (msg.type) {
      case "REGISTER":
        user.userId = msg.userId;
        user.username = msg.username;
        console.log(`Зарегистрирован: ${user.username}`);
        break;

      case "CREATE_ROOM":
        const rid = Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms.set(rid, { players: [ws], scores: { A: 0, B: 0 }, currentWord: "", presenterIdx: 0 });
        user.roomId = rid;
        user.team = "A";
        ws.send(JSON.stringify({ type: "ROOM_CREATED", roomId: rid }));
        break;

      case "JOIN_ROOM":
        const rj = rooms.get(msg.roomId?.toUpperCase());
        if (rj) {
          rj.players.push(ws);
          user.roomId = msg.roomId.toUpperCase();
          user.team = rj.players.length % 2 === 0 ? "B" : "A";
          broadcast(user.roomId, {
            type: "PLAYERS_UPDATE",
            players: rj.players.map(p => ({ name: users.get(p).username, team: users.get(p).team }))
          });
        }
        break;

      case "START_ROUND":
        const rs = rooms.get(user.roomId);
        if (!rs) return;
        rs.currentWord = wordList[Math.floor(Math.random() * wordList.length)];
        rs.players.forEach(p => {
          const isP = (p === rs.players[rs.presenterIdx]);
          p.send(JSON.stringify({ type: "ROUND_START", word: isP ? rs.currentWord : null, role: isP ? "leader" : "guesser", time: 60 }));
        });
        break;

      case "HINT":
        broadcast(user.roomId, { type: "HINT_LIVE", text: msg.text, from: user.username });
        break;

      case "CORRECT":
        const rc = rooms.get(user.roomId);
        if (!rc) return;
        rc.scores[user.team]++;
        rc.currentWord = wordList[Math.floor(Math.random() * wordList.length)];
        broadcast(user.roomId, { type: "SCORE_UPDATE", scores: rc.scores });
        // Даем ведущему новое слово
        rc.players[rc.presenterIdx].send(JSON.stringify({ type: "NEW_WORD", word: rc.currentWord }));
        break;
    }
  });

  ws.on("close", () => users.delete(ws));
});

server.listen(PORT, '0.0.0.0', () => console.log(`Сервер на порту ${PORT}`));
