import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import TelegramBot from 'node-telegram-bot-api';
import path from 'path';
import { fileURLToPath } from 'url';

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = "8512268012:AAGK2FiAlTLbodOP3yjlbO3atHpD8ap44yc"; 
const APP_URL = "https://elias-th.onrender.com"; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, "index.html")));

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// --- КОНФИГ ---
const MIN_PLAYERS = 2; // Поставь 4 для релизной версии! Сейчас 2 для теста.

const users = new Map();
const rooms = new Map();
const wordList = ["САМОЛЕТ", "ТЕЛЕФОН", "МАФИЯ", "КОСМОС", "ГИТАРА", "НИНДЗЯ", "ЗОМБИ", "АРБУЗ", "ТАНК", "ВЕРТОЛЕТ", "КЕНГУРУ", "ОКЕАН", "МОРФЕУС", "БИТКОИН", "ПЕЛЬМЕНИ", "РОБОТ", "ВАМПИР"];

// --- ЛОГИКА ИГРЫ ---
function shuffle(array) { return array.sort(() => Math.random() - 0.5); }

function startGame(roomId) {
    const r = rooms.get(roomId);
    if (!r) return;
    
    // Делим на команды
    const shuffled = shuffle([...r.players]);
    const mid = Math.ceil(shuffled.length / 2);
    r.teams.A = shuffled.slice(0, mid);
    r.teams.B = shuffled.slice(mid);
    
    r.state = 'PLAYING';
    r.turn.team = 'A';
    r.turn.explainerIndex = { A: 0, B: 0 };
    
    startRound(roomId);
}

function startRound(roomId) {
    const r = rooms.get(roomId);
    if (!r) return;

    const teamName = r.turn.team; 
    const teamPlayers = r.teams[teamName];
    const expIdx = r.turn.explainerIndex[teamName] % teamPlayers.length;
    const explainerWs = teamPlayers[expIdx];
    
    r.currentWord = wordList[Math.floor(Math.random() * wordList.length)];
    
    // Рассылка состояний
    r.players.forEach(ws => {
        const u = users.get(ws);
        let role = 'spectator';
        
        // В режиме "Звонок" (call) угадывают ВСЕ из команды, кроме ведущего
        // В режиме "Онлайн" (online) угадывают те, кто видит чат
        
        if (ws === explainerWs) {
            role = 'explainer';
        } else if (teamPlayers.includes(ws)) {
            role = 'guesser';
        }
        
        ws.send(JSON.stringify({
            type: "ROUND_START",
            mode: r.mode, // Важно: передаем режим
            team: teamName,
            role: role,
            word: ws === explainerWs ? r.currentWord : null,
            explainerName: users.get(explainerWs).username,
            time: 60
        }));
    });

    // Таймер
    let timeLeft = 60;
    if (r.timer) clearInterval(r.timer);
    r.timer = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) endRound(roomId);
    }, 1000);
}

function endRound(roomId) {
    const r = rooms.get(roomId);
    if (!r) return;
    clearInterval(r.timer);
    
    r.turn.explainerIndex[r.turn.team]++;
    r.turn.team = r.turn.team === 'A' ? 'B' : 'A';
    
    // Пауза перед сменой хода
    r.players.forEach(p => p.send(JSON.stringify({ type: "ROUND_END", scores: r.scores, nextTeam: r.turn.team })));
    setTimeout(() => startRound(roomId), 3000);
}

// --- БОТ ---
bot.setChatMenuButton({ menu_button: JSON.stringify({ type: "web_app", text: "Играть", web_app: { url: APP_URL } }) });
bot.onText(/\/start/, (msg) => {
    // Сохраняем ID телеграма для приглашений
    // (В реальном проекте тут нужна база данных, пока храним в памяти активных сессий)
});

// --- SOCKETS ---
wss.on("connection", (ws) => {
    users.set(ws, { userId: null, username: "Гость", tgId: null });

    ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch(e) { return; }
        const user = users.get(ws);

        switch (msg.type) {
            case "REGISTER":
                user.userId = msg.userId;
                user.username = msg.username;
                user.tgId = msg.tgId; 
                break;

            case "CREATE_ROOM":
                const rid = Math.random().toString(36).substring(2, 7).toUpperCase();
                rooms.set(rid, {
                    players: [ws],
                    teams: { A: [], B: [] },
                    scores: { A: 0, B: 0 },
                    mode: msg.mode || 'online', // 'online' или 'call'
                    state: 'LOBBY',
                    turn: { team: 'A', explainerIndex: { A: 0, B: 0 } },
                    timer: null
                });
                user.roomId = rid;
                ws.send(JSON.stringify({ type: "ROOM_CREATED", roomId: rid }));
                break;

            case "JOIN_ROOM":
                const r = rooms.get(msg.roomId?.toUpperCase());
                if (r && r.state === 'LOBBY') {
                    if (!r.players.includes(ws)) r.players.push(ws);
                    user.roomId = msg.roomId.toUpperCase();
                    
                    // ОТВЕТ ИГРОКУ ЧТО ОН ВОШЕЛ (Фикс твоей проблемы)
                    ws.send(JSON.stringify({ type: "JOIN_SUCCESS", roomId: user.roomId, mode: r.mode }));

                    // Обновляем всем лобби
                    const names = r.players.map(p => users.get(p).username);
                    r.players.forEach(p => p.send(JSON.stringify({ type: "LOBBY_UPDATE", players: names, count: r.players.length })));
                } else {
                    ws.send(JSON.stringify({ type: "ERROR", text: "Комната не найдена!" }));
                }
                break;

            case "START_GAME":
                const roomToStart = rooms.get(user.roomId);
                if (roomToStart) {
                    if (roomToStart.players.length < MIN_PLAYERS) {
                        ws.send(JSON.stringify({ type: "ERROR", text: `Нужно минимум ${MIN_PLAYERS} игрока!` }));
                        return;
                    }
                    startGame(user.roomId);
                }
                break;

            case "HINT":
                // Подсказки работают только в режиме ONLINE
                const rh = rooms.get(user.roomId);
                if (rh && rh.mode === 'online') {
                    rh.players.forEach(p => p.send(JSON.stringify({ type: "LIVE_HINT", text: msg.text })));
                }
                break;

            case "CORRECT":
                const rc = rooms.get(user.roomId);
                if (rc) {
                    rc.scores[rc.turn.team]++;
                    rc.currentWord = wordList[Math.floor(Math.random() * wordList.length)];
                    
                    // Обновляем счет всем
                    rc.players.forEach(p => p.send(JSON.stringify({ type: "SCORE_UPDATE", scores: rc.scores })));
                    
                    // Обновляем слово ведущему
                    const team = rc.teams[rc.turn.team];
                    const expIdx = rc.turn.explainerIndex[rc.turn.team] % team.length;
                    const explainer = team[expIdx];
                    explainer.send(JSON.stringify({ type: "NEW_WORD", word: rc.currentWord }));
                }
                break;

            case "INVITE_FRIEND":
                // Отправляем сообщение в ТГ через бота (нужен ID)
                // Тут пока заглушка, так как для отправки нужно знать ChatID друга
                // Лучше использовать на клиенте tg.openTelegramLink
                break;
        }
    });

    ws.on("close", () => {
        const user = users.get(ws);
        if (user?.roomId) {
            const r = rooms.get(user.roomId);
            if (r) {
                r.players = r.players.filter(p => p !== ws);
                if (r.players.length === 0) rooms.delete(user.roomId);
                else {
                     // Если кто-то вышел в лобби - обновим список
                     const names = r.players.map(p => users.get(p).username);
                     r.players.forEach(p => p.send(JSON.stringify({ type: "LOBBY_UPDATE", players: names, count: r.players.length })));
                }
            }
        }
        users.delete(ws);
    });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Server running on ${PORT}`));
