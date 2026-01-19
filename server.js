import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import TelegramBot from 'node-telegram-bot-api';
import path from 'path';
import { fileURLToPath } from 'url';

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = "8512268012:AAEK3XSangGvRj_0rcfv7Aul2smeRSoK1Jw"; 
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
const MIN_PLAYERS = 2; // Для теста 2, для игры ставь 4
const ROUND_TIME = 60; // Секунды

const users = new Map();
const rooms = new Map();
const wordList = ["Абрикос", "Авангард", "Авторитет", "Агент", "Адвокат", "Адмирал", "Азарт", "Айсберг", "Аккорд", "Актёр", "Алмаз", "Ананас", "Ангел", "Антенна", "Апельсин", "Аппетит", "Апрель", "Арбуз", "Арена", "Армия", "Аромат", "Артист", "Архив", "Астроном", "Асфальт", "Атака", "Атлет", "Атом", "Афиша", "Аэропорт", "Бабочка", "Багаж", "Баклажан", "Балет", "Балкон", "Банан", "Банкир", "Барабан", "Бассейн", "Батальон", "Башня", "Бегемот", "Белка", "Берег", "Билет", "Бинокль", "Боксер", "Бомба", "Борода", "Браслет", "Бриллиант", "Будильник", "Букет", "Бумага", "Бутылка", "Вампир", "Ведро", "Велосипед", "Вертолет", "Весы", "Ветер", "Вилка", "Виноград", "Вода", "Волк", "Волшебник", "Время", "Вулкан", "Газета", "Галстук", "Гвоздь", "Герой", "Гитара", "Глаз", "Глобус", "Гном", "Гора", "Горох", "Гриб", "Гром", "Груша", "Гусь", "Дверь", "Деньги", "Дерево", "Детектив", "Диван", "Дождь", "Дом", "Дорога", "Дракон", "Душ", "Дым", "Еж", "Елка", "Жираф", "Жук", "Забор", "Замок", "Заяц", "Звезда", "Звонок", "Зеркало", "Змея", "Зонт", "Зуб", "Игла", "Игра", "Изба", "Икона", "Император", "Индейка", "Интернет", "Иск", "Йогурт", "Календарь", "Камень", "Камера", "Капитан", "Карта", "Картина", "Картофель", "Каска", "Квадрат", "Кенгуру", "Кино", "Кит", "Клад", "Клетка", "Клоун", "Ключ", "Книга", "Ковер", "Колесо", "Кольцо", "Комар", "Комета", "Компьютер", "Конверт", "Конь", "Корабль", "Корона", "Космос", "Кость", "Кот", "Кофе", "Кран", "Кресло", "Кровать", "Крокодил", "Крыша", "Кукла", "Кухня", "Лампа", "Лев", "Лед", "Лимон", "Лиса", "Лифт", "Лицо", "Лодка", "Ложка", "Лук", "Луна", "Лягушка", "Магазин", "Магнит", "Машина", "Медведь", "Мел", "Меч", "Мешок", "Микрофон", "Молоко", "Молоток", "Монета", "Море", "Мороженое", "Мост", "Музыка", "Муха", "Мыло", "Мышь", "Мяч", "Нож", "Носки", "Ночь", "Обезьяна", "Облако", "Обувь", "Огонь", "Огурец", "Одеяло", "Окно", "Очки", "Пальто", "Паровоз", "Паук", "Пельмень", "Пень", "Перец", "Песок", "Печенье", "Пианино", "Пингвин", "Пирамида", "Пирог", "Письмо", "Пицца", "Планета", "Платье", "Подарок", "Поезд", "Помидор", "Попугай", "Портфель", "Посуда", "Почта", "Пояс", "Праздник", "Призрак", "Принц", "Пробка", "Птица", "Пуговица", "Пуля", "Пушка", "Пчела", "Пятно", "Радуга", "Ракета", "Ракушка", "Расческа", "Река", "Робот", "Роза", "Ромашка", "Рот", "Рубашка", "Рука", "Ручка", "Рыба", "Рыцарь", "Рюкзак", "Салют", "Самолет", "Свеча", "Свинья", "Светофор", "Сердце", "Сетка", "Сигарета", "Скрипка", "Слон", "Снег", "Снеговик", "Собака", "Сова", "Солдат", "Солнце", "Соль", "Сон", "Сосиска", "Спички", "Спорт", "Спутник", "Стакан", "Стена", "Стол", "Стул", "Судья", "Сумка", "Суп", "Сыр", "Таблетка", "Тарелка", "Тигр", "Топор", "Торт", "Трава", "Трактор", "Трамвай", "Труба", "Туфли", "Тыква", "Улыбка", "Утюг", "Ухо", "Флаг", "Фонарь", "Фотоаппарат", "Футбол", "Футболка", "Хлеб", "Холодильник", "Цветок", "Цепь", "Церковь", "Цирк", "Чай", "Часы", "Чашка", "Чемодан", "Черепаха", "Чеснок", "Шапка", "Шар", "Шахматы", "Шкаф", "Школа", "Шляпа", "Шоколад", "Штаны", "Шуба", "Щетка", "Экран", "Яблоко", "Ягода", "Яйцо", "Якорь", "Ящик"];

function broadcast(roomId, data) {
    const r = rooms.get(roomId);
    if (r) r.players.forEach(p => { if (p.readyState === 1) p.send(JSON.stringify(data)); });
}

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
    r.scores = { A: 0, B: 0 };
    
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
    
    // Сбрасываем таймер
    if (r.timer) clearInterval(r.timer);
    
    r.players.forEach(ws => {
        const u = users.get(ws);
        let role = 'spectator';
        
        if (ws === explainerWs) role = 'explainer';
        else if (teamPlayers.includes(ws)) role = 'guesser';
        
        ws.send(JSON.stringify({
            type: "ROUND_START",
            team: teamName,
            role: role,
            word: ws === explainerWs ? r.currentWord : null,
            explainerName: users.get(explainerWs).username,
            time: ROUND_TIME
        }));
    });

    let timeLeft = ROUND_TIME;
    r.timer = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
            endRound(roomId);
        }
    }, 1000);
}

function endRound(roomId) {
    const r = rooms.get(roomId);
    if (!r) return;
    clearInterval(r.timer);
    
    r.turn.explainerIndex[r.turn.team]++;
    r.turn.team = r.turn.team === 'A' ? 'B' : 'A';
    
    broadcast(roomId, { type: "ROUND_END", scores: r.scores, nextTeam: r.turn.team });
    setTimeout(() => startRound(roomId), 3000);
}

// --- БОТ ---
bot.setChatMenuButton({ menu_button: JSON.stringify({ type: "web_app", text: "Играть", web_app: { url: APP_URL } }) });
bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "Запускай приложение!", { parse_mode: "Markdown" }));

// --- SOCKETS ---
wss.on("connection", (ws) => {
    users.set(ws, { userId: null, username: "Гость" });

    ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch(e) { return; }
        const user = users.get(ws);

        switch (msg.type) {
            case "REGISTER":
                user.userId = msg.userId;
                user.username = msg.username;
                break;

            case "CREATE_ROOM":
                const rid = Math.random().toString(36).substring(2, 7).toUpperCase();
                rooms.set(rid, {
                    players: [ws],
                    teams: { A: [], B: [] },
                    scores: { A: 0, B: 0 },
                    mode: msg.mode || 'online',
                    state: 'LOBBY',
                    turn: { team: 'A', explainerIndex: { A: 0, B: 0 } },
                    timer: null,
                    currentWord: ""
                });
                user.roomId = rid;
                ws.send(JSON.stringify({ type: "ROOM_CREATED", roomId: rid }));
                break;

            case "JOIN_ROOM":
                const r = rooms.get(msg.roomId?.toUpperCase());
                if (r && r.state === 'LOBBY') {
                    if (!r.players.includes(ws)) r.players.push(ws);
                    user.roomId = msg.roomId.toUpperCase();
                    ws.send(JSON.stringify({ type: "JOIN_SUCCESS", roomId: user.roomId }));
                    const names = r.players.map(p => users.get(p).username);
                    r.players.forEach(p => p.send(JSON.stringify({ type: "LOBBY_UPDATE", players: names, count: r.players.length })));
                } else {
                    ws.send(JSON.stringify({ type: "ERROR", text: "Ошибка входа" }));
                }
                break;

            case "START_GAME":
                const roomToStart = rooms.get(user.roomId);
                if (roomToStart) {
                    if (roomToStart.players.length < MIN_PLAYERS) {
                        ws.send(JSON.stringify({ type: "ERROR", text: `Минимум ${MIN_PLAYERS} игрока!` }));
                        return;
                    }
                    startGame(user.roomId);
                }
                break;

            case "CHAT_MESSAGE":
                // Обработка сообщений в чате (Подсказки и Догадки)
                const room = rooms.get(user.roomId);
                if (!room || room.state !== 'PLAYING') return;

                const text = msg.text.trim();
                if(!text) return;

                // 1. Отправляем сообщение ВСЕМ в чат
                broadcast(user.roomId, {
                    type: "CHAT_NEW",
                    from: user.username,
                    text: text,
                    isSystem: false
                });

                // 2. Если это написал УГАДЫВАЮЩИЙ и это СОВПАДАЕТ со словом
                const isGuesser = room.teams[room.turn.team].includes(ws) && 
                                  room.teams[room.turn.team][room.turn.explainerIndex[room.turn.team] % room.teams[room.turn.team].length] !== ws;

                if (isGuesser && text.toLowerCase() === room.currentWord.toLowerCase()) {
                    // УГАДАЛИ!
                    room.scores[room.turn.team]++;
                    
                    // Уведомление о победе
                    broadcast(user.roomId, {
                        type: "CHAT_NEW",
                        from: "SYSTEM",
                        text: `✅ ${user.username} угадал слово: ${room.currentWord}!`,
                        isSystem: true
                    });
                    
                    broadcast(user.roomId, { type: "SCORE_UPDATE", scores: room.scores });

                    // Новое слово
                    room.currentWord = wordList[Math.floor(Math.random() * wordList.length)];
                    
                    // Отправляем новое слово ТОЛЬКО ведущему
                    const team = room.teams[room.turn.team];
                    const expIdx = room.turn.explainerIndex[room.turn.team] % team.length;
                    const explainer = team[expIdx];
                    
                    explainer.send(JSON.stringify({ type: "NEW_WORD", word: room.currentWord }));
                }
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
                     const names = r.players.map(p => users.get(p).username);
                     r.players.forEach(p => p.send(JSON.stringify({ type: "LOBBY_UPDATE", players: names, count: r.players.length })));
                }
            }
        }
        users.delete(ws);
    });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Server running on ${PORT}`));
