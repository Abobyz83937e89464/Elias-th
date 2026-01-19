import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import TelegramBot from 'node-telegram-bot-api';
import path from 'path';
import { fileURLToPath } from 'url';

// --- НАСТРОЙКИ ---
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = "8522033211:AAHBzsYb3EcchhWRaB094zQksBv-WoVum-4";
// Укажи здесь свою ссылку на Render:
const APP_URL = "https://elias-tg.onrender.com"; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Работаем с файлами в корне репозитория
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.get('/health', (req, res) => res.sendStatus(200));

// --- БОТ ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Настройка кнопки меню возле строки ввода
bot.setChatMenuButton({
    menu_button: JSON.stringify({
        type: "web_app",
        text: "Elians",
        web_app: { url: APP_URL }
    })
});

bot.onText(/\/start/, (msg) => {
    const welcomeText = `Приветствую! 👋\n\nВы попали в бота *Elians*, созданного *Morpheus (Nikita)*.\n\nДля продолжения нажмите на кнопку «Elians» возле строки ввода сообщений, чтобы открыть приложение и ознакомиться с интерфейсом!\n\nВ приложении вы сможете:\n- выбрать режим игры,\n- прочитать правила,\n- создать комнату,\n- пригласить друзей,\n- играть в Alias в реальном времени.\n\nУдачной игры!`;
    
    bot.sendMessage(msg.chat.id, welcomeText, { parse_mode: "Markdown" });
});

// --- ЛОГИКА ИГРЫ ---
const rooms = new Map();
const users = new Map(); // ws -> data
const wordList = ["САМОЛЕТ", "ТЕЛЕФОН", "КОМПЬЮТЕР", "ПИЦЦА", "КОСМОС", "ГИТАРА", "ОСТРОВ", "АРБУЗ", "ТАНК", "ВЕРТОЛЕТ", "КЕНГУРУ", "ШОКОЛАД", "МАФИЯ", "ЗОМБИ", "МОРФЕУС"];

function broadcast(roomId, data) {
    const room = rooms.get(roomId);
    if (room) {
        room.players.forEach(p => {
            if (p.readyState === 1) p.send(JSON.stringify(data));
        });
    }
}

wss.on("connection", (ws) => {
    console.log("[WS] Новое подключение");
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
                console.log(`[USER] Зарегистрирован: ${user.username}`);
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

            case "HINT":
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
                
                broadcast(user.roomId, { type: "SCORE_UPDATE", scores: rc.scores });
                
                // Смена слова для ведущего
                rc.players[rc.presenterIdx].send(JSON.stringify({
                    type: "ROUND_START",
                    word: rc.currentWord,
                    role: "leader"
                }));
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
    console.log(`[SERVER] Запущен на порту ${PORT}`);
});
