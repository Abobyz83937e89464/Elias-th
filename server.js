import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import TelegramBot from 'node-telegram-bot-api';
import path from 'path';
import { fileURLToPath } from 'url';

// --- НАСТРОЙКИ ---
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = "8522033211:AAFW_vrhSl1S35APmBSd5_DCv8T9YpR9f-8";
const APP_URL = "https://твой-адрес.onrender.com"; // ЗАМЕНИ НА СВОЙ АДРЕС ОТ RENDER

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, "public")));

// Роуты для Render
app.get('/', (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get('/health', (req, res) => res.sendStatus(200));

// --- БОТ ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Настройка кнопки меню приложения
bot.setChatMenuButton({
    menu_button: JSON.stringify({
        type: "web_app",
        text: "Elians",
        web_app: { url: APP_URL }
    })
});

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `Привет, ${msg.from.first_name}! 👋\n\nЯ — бот игры *Elians*.\n\nНажми на кнопку слева от ввода, чтобы запустить крутой неоновый интерфейс!`, {
        parse_mode: "Markdown"
    });
});

// --- ПАМЯТЬ СЕРВЕРА ---
const rooms = new Map();   // roomId -> { players, scores, word, presenterIdx, timer }
const users = new Map();   // ws -> { userId, username, roomId, team, tgId }
const wordList = ["САМОЛЕТ", "ТЕЛЕФОН", "МАФИЯ", "ПИЦЦА", "КОСМОС", "ГИТАРА", "НИНДЗЯ", "ЗОМБИ", "АРБУЗ", "ШОКОЛАД", "ТАНК", "ВЕРТОЛЕТ", "КЕНГУРУ", "ОКЕАН", "МОРФЕУС"];

// --- УТИЛИТЫ ---
function broadcast(roomId, data) {
    const room = rooms.get(roomId);
    if (room) {
        room.players.forEach(p => {
            if (p.readyState === 1) p.send(JSON.stringify(data));
        });
    }
}

// --- СЕТЕВАЯ ЛОГИКА ---
wss.on("connection", (ws) => {
    users.set(ws, { userId: null, username: "Гость", roomId: null, team: null, tgId: null });

    ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch(e) { return; }
        const user = users.get(ws);

        switch (msg.type) {
            case "REGISTER":
                user.userId = msg.userId;
                user.username = msg.username;
                user.tgId = msg.tgId;
                console.log(`[LOG] Зарегистрирован: ${user.username}`);
                break;

            case "GET_ONLINE_USERS":
                const online = Array.from(users.values())
                    .filter(u => u.userId && u.userId !== user.userId)
                    .map(u => ({ userId: u.userId, username: u.username }));
                ws.send(JSON.stringify({ type: "FRIENDS_LIST", list: online }));
                break;

            case "CREATE_ROOM":
                const rid = Math.random().toString(36).substring(2, 7).toUpperCase();
                rooms.set(rid, {
                    players: [ws],
                    scores: { A: 0, B: 0 },
                    currentWord: "",
                    presenterIdx: 0,
                    mode: msg.mode || 'online'
                });
                user.roomId = rid;
                user.team = "A";
                ws.send(JSON.stringify({ type: "ROOM_CREATED", roomId: rid }));
                break;

            case "JOIN_ROOM":
                const rj = rooms.get(msg.roomId?.toUpperCase());
                if (rj) {
                    if (!rj.players.includes(ws)) rj.players.push(ws);
                    user.roomId = msg.roomId.toUpperCase();
                    user.team = rj.players.length % 2 === 0 ? "B" : "A";
                    
                    broadcast(user.roomId, {
                        type: "PLAYERS_UPDATE",
                        players: rj.players.map(p => ({ name: users.get(p).username, team: users.get(p).team }))
                    });
                } else {
                    ws.send(JSON.stringify({ type: "ERROR", text: "Комната не найдена" }));
                }
                break;

            case "START_ROUND":
                const rs = rooms.get(user.roomId);
                if (!rs) return;
                
                // Рандомное слово
                rs.currentWord = wordList[Math.floor(Math.random() * wordList.length)];
                const presenter = rs.players[rs.presenterIdx];

                rs.players.forEach(p => {
                    const isP = (p === presenter);
                    p.send(JSON.stringify({
                        type: "ROUND_START",
                        word: isP ? rs.currentWord : null,
                        role: isP ? "leader" : "guesser",
                        mode: rs.mode
                    }));
                });
                break;

            case "HINT":
                // Живая подсказка
                broadcast(user.roomId, {
                    type: "HINT_LIVE",
                    text: msg.text,
                    from: user.username
                });
                break;

            case "CORRECT":
                const rc = rooms.get(user.roomId);
                if (!rc) return;

                rc.scores[user.team]++;
                rc.currentWord = wordList[Math.floor(Math.random() * wordList.length)];
                
                broadcast(user.roomId, {
                    type: "SCORE_UPDATE",
                    scores: rc.scores
                });

                // Выдаем ведущему новое слово
                const currentLeader = rc.players[rc.presenterIdx];
                currentLeader.send(JSON.stringify({
                    type: "ROUND_START", // Переиспользуем для обновления слова
                    word: rc.currentWord,
                    role: "leader"
                }));
                break;

            case "INVITE":
                // Поиск игрока для приглашения через бота
                for (let [sock, uData] of users.entries()) {
                    if (uData.userId == msg.targetUserId && uData.tgId) {
                        bot.sendMessage(uData.tgId, `🎮 *${user.username}* приглашает тебя в Elians!\nКод комнаты: \`${msg.roomId}\``, { parse_mode: "Markdown" });
                        break;
                    }
                }
                break;
        }
    });

    ws.on("close", () => {
        const user = users.get(ws);
        if (user && user.roomId) {
            const room = rooms.get(user.roomId);
            if (room) {
                room.players = room.players.filter(p => p !== ws);
                if (room.players.length === 0) rooms.delete(user.roomId);
            }
        }
        users.delete(ws);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Elians запущен на порту ${PORT}`);
});
