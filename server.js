import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import TelegramBot from 'node-telegram-bot-api';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================================
// НАСТРОЙКИ (ВСТАВЛЕНО)
// ==========================================================
const BOT_TOKEN = "8433708366:AAEpLRHtNdCW7-kVnQgZS0kcUSVOJLpUfUs"; 
const APP_URL = "https://elias-th.onrender.com"; 
const PORT = process.env.PORT || 10000;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(__dirname));

// Настройка Бота
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.setChatMenuButton({ 
    menu_button: JSON.stringify({ 
        type: "web_app", 
        text: "Elias Arena", 
        web_app: { url: APP_URL } 
    }) 
});

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "🏆 *Добро пожаловать в Elias Arena!*\n\nНажми кнопку ниже, чтобы войти.", {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [[{ text: "🚀 ИГРАТЬ", web_app: { url: APP_URL } }]]
        }
    });
});

// Игровая база
const users = new Map();
const rooms = new Map();
const wordList = ["Абрикос", "Астероид", "Адвокат", "Альянс", "Бриллиант", "Бумеранг", "Вакуум", "Гравитация", "Демократия", "Дирижер", "Интуиция", "Искусство", "Лабиринт", "Метеорит", "Ностальгия", "Оптимизм", "Парадокс", "Перспектива", "Резонанс", "Стратегия", "Технология", "Философия", "Харизма", "Эволюция", "Юмор", "Явление", "Атмосфера", "Балкон", "Валюта", "Гармония", "Зенит", "Импульс", "Компас", "Легенда", "Магнит", "Орбита", "Пилот", "Радар", "Статус", "Трофей", "Утопия", "Финал", "Цикл", "Шедевр", "Эскиз", "Эпоха"];

function broadcast(roomId, data) {
    const r = rooms.get(roomId);
    if (r) {
        const payload = JSON.stringify(data);
        r.players.forEach(p => { if (p.readyState === 1) p.send(payload); });
    }
}

wss.on("connection", (ws) => {
    users.set(ws, { username: "Гость", roomId: null });

    ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch(e) { return; }
        const user = users.get(ws);

        switch (msg.type) {
            case "REGISTER":
                user.username = msg.username || "Гость";
                break;

            case "CREATE_ROOM":
                const rid = Math.random().toString(36).substring(2, 7).toUpperCase();
                rooms.set(rid, {
                    id: rid, players: [ws], teams: { A: [], B: [] },
                    scores: { A: 0, B: 0 }, state: 'LOBBY', mode: msg.mode,
                    turn: { team: 'A', explainerIdx: { A: 0, B: 0 } },
                    currentWord: "", timer: null
                });
                user.roomId = rid;
                ws.send(JSON.stringify({ type: "ROOM_CREATED", roomId: rid }));
                break;

            case "JOIN_ROOM":
                const rJoin = rooms.get(msg.roomId?.toUpperCase());
                if (rJoin && rJoin.state === 'LOBBY') {
                    rJoin.players.push(ws);
                    user.roomId = rJoin.id;
                    ws.send(JSON.stringify({ type: "JOIN_SUCCESS", roomId: rJoin.id }));
                    broadcast(rJoin.id, { type: "LOBBY_UPDATE", players: rJoin.players.map(p => users.get(p).username) });
                }
                break;

            case "START_GAME":
                const rStart = rooms.get(user.roomId);
                if (rStart && rStart.players[0] === ws) {
                    rStart.state = 'PLAYING';
                    rStart.teams.A = rStart.players.filter((_, i) => i % 2 === 0);
                    rStart.teams.B = rStart.players.filter((_, i) => i % 2 !== 0);
                    runRound(rStart.id);
                }
                break;

            case "CHAT_MESSAGE":
                handleChat(ws, msg.text);
                break;

            case "SKIP_WORD":
                handleSkip(ws);
                break;
        }
    });

    ws.on("close", () => {
        const user = users.get(ws);
        if (user?.roomId) {
            const r = rooms.get(user.roomId);
            if (r) {
                r.players = r.players.filter(p => p !== ws);
                if (r.players.length === 0) {
                    if (r.timer) clearInterval(r.timer);
                    rooms.delete(user.roomId);
                } else {
                    broadcast(r.id, { type: "LOBBY_UPDATE", players: r.players.map(p => users.get(p).username) });
                }
            }
        }
        users.delete(ws);
    });
});

function runRound(roomId) {
    const r = rooms.get(roomId);
    if (!r) return;

    const team = r.turn.team;
    const players = r.teams[team];
    const explainerWs = players[r.turn.explainerIdx[team] % players.length];
    r.currentWord = wordList[Math.floor(Math.random() * wordList.length)];

    const playersInfo = r.players.slice(0, 4).map(p => ({
        name: users.get(p).username,
        team: r.teams.A.includes(p) ? 'A' : 'B'
    }));

    r.players.forEach(p => {
        let role = 'opponent';
        if (p === explainerWs) role = 'explainer';
        else if (players.includes(p)) role = 'guesser';

        p.send(JSON.stringify({
            type: "ROUND_START", role, team,
            word: role === 'explainer' ? r.currentWord : null,
            explainerName: users.get(explainerWs).username,
            playersInfo, time: 60
        }));
    });

    let timeLeft = 60;
    if (r.timer) clearInterval(r.timer);
    r.timer = setInterval(() => {
        timeLeft--;
        broadcast(roomId, { type: "TIMER_TICK", time: timeLeft });
        if (timeLeft <= 0) {
            clearInterval(r.timer);
            r.turn.explainerIdx[team]++;
            r.turn.team = (team === 'A') ? 'B' : 'A';
            broadcast(roomId, { type: "ROUND_END" });
            setTimeout(() => runRound(roomId), 3000);
        }
    }, 1000);
}

function handleChat(ws, text) {
    const user = users.get(ws);
    const r = rooms.get(user.roomId);
    if (!r || r.state !== 'PLAYING' || !text.trim()) return;

    broadcast(r.id, { type: "CHAT_NEW", from: user.username, text: text.trim() });

    const currentTeamPlayers = r.teams[r.turn.team];
    const explainerWs = currentTeamPlayers[r.turn.explainerIdx[r.turn.team] % currentTeamPlayers.length];
    const isGuesser = currentTeamPlayers.includes(ws) && ws !== explainerWs;

    if (isGuesser && text.trim().toLowerCase() === r.currentWord.toLowerCase()) {
        r.scores[r.turn.team]++;
        broadcast(r.id, { type: "WIN_ANIM" });
        broadcast(r.id, { type: "SCORE_UPDATE", scores: r.scores });
        r.currentWord = wordList[Math.floor(Math.random() * wordList.length)];
        explainerWs.send(JSON.stringify({ type: "NEW_WORD", word: r.currentWord }));
    }
}

function handleSkip(ws) {
    const user = users.get(ws);
    const r = rooms.get(user.roomId);
    if (!r || r.state !== 'PLAYING') return;
    const explainerWs = r.teams[r.turn.team][r.turn.explainerIdx[r.turn.team] % r.teams[r.turn.team].length];

    if (ws === explainerWs) {
        r.scores[r.turn.team] = Math.max(0, r.scores[r.turn.team] - 1);
        r.currentWord = wordList[Math.floor(Math.random() * wordList.length)];
        broadcast(r.id, { type: "SCORE_UPDATE", scores: r.scores });
        ws.send(JSON.stringify({ type: "NEW_WORD", word: r.currentWord }));
    }
}

server.listen(PORT, '0.0.0.0');
