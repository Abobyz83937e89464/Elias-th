import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import TelegramBot from 'node-telegram-bot-api';
import path from 'path';
import { fileURLToPath } from 'url';

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = "8522033211:AAHlMuTys-bIQAWNMFQA0DnOS4CAMYRyj5U";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, "public")));

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// База данных в памяти
const rooms = new Map(); 
const users = new Map(); // ws -> data
const wordList = ["Самолет", "Телефон", "Компьютер", "Пицца", "Космос", "Гитара", "Остров", "Ниндзя", "Зомби", "Арбуз", "Шоколад", "Танк", "Вертолет", "Подводная лодка", "Кенгуру"];

function broadcast(roomId, data) {
    const room = rooms.get(roomId);
    if (room) {
        room.players.forEach(p => { if (p.readyState === 1) p.send(JSON.stringify(data)); });
    }
}

wss.on("connection", (ws) => {
    users.set(ws, { userId: null, username: "Гость", roomId: null, team: null, tgId: null });

    ws.on("message", (raw) => {
        const msg = JSON.parse(raw);
        const user = users.get(ws);

        switch (msg.type) {
            case "REGISTER":
                user.userId = msg.userId;
                user.username = msg.username;
                user.tgId = msg.tgId;
                break;

            case "GET_ONLINE_USERS":
                const online = Array.from(users.values())
                    .filter(u => u.userId && u.userId !== user.userId)
                    .map(u => ({ userId: u.userId, username: u.username }));
                ws.send(JSON.stringify({ type: "ONLINE_USERS", users: online }));
                break;

            case "CREATE_ROOM":
                const rid = Math.random().toString(36).substring(2, 7).toUpperCase();
                rooms.set(rid, {
                    players: [ws],
                    scores: { A: 0, B: 0 },
                    currentWord: "",
                    presenterIdx: 0,
                    status: "waiting"
                });
                user.roomId = rid;
                user.team = "A";
                ws.send(JSON.stringify({ type: "ROOM_CREATED", roomId: rid }));
                break;

            case "JOIN_ROOM":
                const roomToJoin = rooms.get(msg.roomId);
                if (roomToJoin) {
                    roomToJoin.players.push(ws);
                    user.roomId = msg.roomId;
                    user.team = roomToJoin.players.length % 2 === 0 ? "B" : "A";
                    broadcast(msg.roomId, {
                        type: "PLAYERS_UPDATE",
                        players: roomToJoin.players.map(p => ({ name: users.get(p).username, team: users.get(p).team }))
                    });
                }
                break;

            case "INVITE":
                const target = Array.from(users.entries()).find(([s, u]) => u.userId === msg.targetUserId);
                if (target && target[1].tgId) {
                    bot.sendMessage(target[1].tgId, `📩 ${user.username} зовет тебя в игру Elians!\nКод комнаты: ${msg.roomId}`);
                }
                break;

            case "START_ROUND":
                const r = rooms.get(user.roomId);
                r.status = "playing";
                r.currentWord = wordList[Math.floor(Math.random() * wordList.length)];
                const presenter = r.players[r.presenterIdx];
                
                r.players.forEach(p => {
                    const isP = (p === presenter);
                    p.send(JSON.stringify({
                        type: "ROUND_START",
                        word: isP ? r.currentWord : null,
                        role: isP ? "leader" : "guesser"
                    }));
                });
                break;

            case "HINT":
                broadcast(user.roomId, { type: "HINT_LIVE", text: msg.text, from: user.username });
                break;

            case "CORRECT":
                const rCorr = rooms.get(user.roomId);
                rCorr.scores[user.team]++;
                rCorr.currentWord = wordList[Math.floor(Math.random() * wordList.length)];
                const nextPresenter = rCorr.players[rCorr.presenterIdx];
                
                broadcast(user.roomId, { 
                    type: "SCORE_UPDATE", 
                    scores: rCorr.scores,
                    newWord: rCorr.currentWord,
                    presenterId: users.get(nextPresenter).userId
                });
                break;
        }
    });

    ws.on("close", () => users.delete(ws));
});

server.listen(PORT, () => console.log(`Server on ${PORT}`));
