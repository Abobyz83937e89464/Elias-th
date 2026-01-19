import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import TelegramBot from 'node-telegram-bot-api';
import path from 'path';
import { fileURLToPath } from 'url';

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = "8512268012:AAGgYX7uKJhR8a2k4DncwJb7KRgETEoWtYU"; 
const APP_URL = "https://elias-th.onrender.com"; // Твоя ссылка

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, "index.html")));

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// --- БАЗА ДАННЫХ ---
const users = new Map(); // ws -> {userId, username, roomId, tgId}
const rooms = new Map(); 
// Структура комнаты:
// {
//   id: string,
//   players: [],
//   teams: { A: [], B: [] },
//   scores: { A: 0, B: 0 },
//   config: { roundTime: 60, winScore: 30 },
//   state: 'LOBBY' | 'PLAYING',
//   turn: { team: 'A', explainerIndex: { A: 0, B: 0 } },
//   timer: null,
//   currentWord: ""
// }

const wordList = ["Абрикос", "Авангард", "Авторитет", "Агент", "Адвокат", "Адмирал", "Азарт", "Айсберг", "Аккорд", "Актёр", "Алмаз", "Ананас", "Ангел", "Антенна", "Апельсин", "Аппетит", "Апрель", "Арбуз", "Арена", "Армия", "Аромат", "Артист", "Архив", "Астроном", "Асфальт", "Атака", "Атлет", "Атом", "Афиша", "Аэропорт", "Бабочка", "Багаж", "Баклажан", "Балет", "Балкон", "Банан", "Банкир", "Барабан", "Бассейн", "Батальон", "Башня", "Бегемот", "Белка", "Берег", "Билет", "Бинокль", "Боксер", "Бомба", "Борода", "Браслет", "Бриллиант", "Будильник", "Букет", "Бумага", "Бутылка", "Вампир", "Ведро", "Велосипед", "Вертолет", "Весы", "Ветер", "Вилка", "Виноград", "Вода", "Волк", "Волшебник", "Время", "Вулкан", "Газета", "Галстук", "Гвоздь", "Герой", "Гитара", "Глаз", "Глобус", "Гном", "Гора", "Горох", "Гриб", "Гром", "Груша", "Гусь", "Дверь", "Деньги", "Дерево", "Детектив", "Диван", "Дождь", "Дом", "Дорога", "Дракон", "Душ", "Дым", "Еж", "Елка", "Жираф", "Жук", "Забор", "Замок", "Заяц", "Звезда", "Звонок", "Зеркало", "Змея", "Зонт", "Зуб", "Игла", "Игра", "Изба", "Икона", "Император", "Индейка", "Интернет", "Иск", "Йогурт", "Календарь", "Камень", "Камера", "Капитан", "Карта", "Картина", "Картофель", "Каска", "Квадрат", "Кенгуру", "Кино", "Кит", "Клад", "Клетка", "Клоун", "Ключ", "Книга", "Ковер", "Колесо", "Кольцо", "Комар", "Комета", "Компьютер", "Конверт", "Конь", "Корабль", "Корона", "Космос", "Кость", "Кот", "Кофе", "Кран", "Кресло", "Кровать", "Крокодил", "Крыша", "Кукла", "Кухня", "Лампа", "Лев", "Лед", "Лимон", "Лиса", "Лифт", "Лицо", "Лодка", "Ложка", "Лук", "Луна", "Лягушка", "Магазин", "Магнит", "Машина", "Медведь", "Мел", "Меч", "Мешок", "Микрофон", "Молоко", "Молоток", "Монета", "Море", "Мороженое", "Мост", "Музыка", "Муха", "Мыло", "Мышь", "Мяч", "Нож", "Носки", "Ночь", "Обезьяна", "Облако", "Обувь", "Огонь", "Огурец", "Одеяло", "Окно", "Очки", "Пальто", "Паровоз", "Паук", "Пельмень", "Пень", "Перец", "Песок", "Печенье", "Пианино", "Пингвин", "Пирамида", "Пирог", "Письмо", "Пицца", "Планета", "Платье", "Подарок", "Поезд", "Помидор", "Попугай", "Портфель", "Посуда", "Почта", "Пояс", "Праздник", "Призрак", "Принц", "Пробка", "Птица", "Пуговица", "Пуля", "Пушка", "Пчела", "Пятно", "Радуга", "Ракета", "Ракушка", "Расческа", "Река", "Робот", "Роза", "Ромашка", "Рот", "Рубашка", "Рука", "Ручка", "Рыба", "Рыцарь", "Рюкзак", "Салют", "Самолет", "Свеча", "Свинья", "Светофор", "Сердце", "Сетка", "Сигарета", "Скрипка", "Слон", "Снег", "Снеговик", "Собака", "Сова", "Солдат", "Солнце", "Соль", "Сон", "Сосиска", "Спички", "Спорт", "Спутник", "Стакан", "Стена", "Стол", "Стул", "Судья", "Сумка", "Суп", "Сыр", "Таблетка", "Тарелка", "Тигр", "Топор", "Торт", "Трава", "Трактор", "Трамвай", "Труба", "Туфли", "Тыква", "Улыбка", "Утюг", "Ухо", "Флаг", "Фонарь", "Фотоаппарат", "Футбол", "Футболка", "Хлеб", "Холодильник", "Цветок", "Цепь", "Церковь", "Цирк", "Чай", "Часы", "Чашка", "Чемодан", "Черепаха", "Чеснок", "Шапка", "Шар", "Шахматы", "Шкаф", "Школа", "Шляпа", "Шоколад", "Штаны", "Шуба", "Щетка", "Экран", "Яблоко", "Ягода", "Яйцо", "Якорь", "Ящик"];

// --- ЛОГИКА ИГРЫ ---

function shuffle(array) {
    return array.sort(() => Math.random() - 0.5);
}

function startGame(roomId) {
    const r = rooms.get(roomId);
    if (!r) return;
    
    // 1. Делим на команды
    const shuffled = shuffle([...r.players]);
    // В идеале нужно четное кол-во, но если нечетное - в одной команде будет больше
    const mid = Math.ceil(shuffled.length / 2);
    r.teams.A = shuffled.slice(0, mid);
    r.teams.B = shuffled.slice(mid);
    
    r.state = 'PLAYING';
    r.turn.team = 'A'; // Начинает команда А
    
    // Сбрасываем индексы объясняющих
    r.turn.explainerIndex = { A: 0, B: 0 };
    
    broadcastRoom(roomId, { type: "GAME_STARTED", teams: {
        A: r.teams.A.map(ws => users.get(ws).username),
        B: r.teams.B.map(ws => users.get(ws).username)
    }});
    
    startRound(roomId);
}

function startRound(roomId) {
    const r = rooms.get(roomId);
    if (!r) return;

    const currentTeamName = r.turn.team; // 'A' или 'B'
    const teamPlayers = r.teams[currentTeamName];
    
    // Кто объясняет? Берем по индексу
    const expIdx = r.turn.explainerIndex[currentTeamName] % teamPlayers.length;
    const explainerWs = teamPlayers[expIdx];
    
    // Остальные в этой команде - угадывают
    const guessersWs = teamPlayers.filter(p => p !== explainerWs);
    
    r.currentWord = wordList[Math.floor(Math.random() * wordList.length)];
    
    // Рассылаем роли
    r.players.forEach(ws => {
        const u = users.get(ws);
        let role = 'spectator';
        let word = null;
        
        if (ws === explainerWs) {
            role = 'explainer';
            word = r.currentWord;
        } else if (guessersWs.includes(ws)) {
            role = 'guesser';
        }
        
        ws.send(JSON.stringify({
            type: "ROUND_START",
            team: currentTeamName,
            role: role,
            word: word,
            explainerName: users.get(explainerWs).username,
            time: 60
        }));
    });

    // Запускаем таймер на сервере
    let timeLeft = 60;
    clearInterval(r.timer);
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
    
    // Сдвигаем индекс объясняющего для текущей команды, чтобы в след. раз объяснял другой
    r.turn.explainerIndex[r.turn.team]++;
    
    // Меняем команду
    r.turn.team = r.turn.team === 'A' ? 'B' : 'A';
    
    broadcastRoom(roomId, { type: "ROUND_END", scores: r.scores, nextTeam: r.turn.team });
    
    // Пауза 3 секунды перед следующим раундом
    setTimeout(() => startRound(roomId), 3000);
}

function broadcastRoom(roomId, data) {
    const r = rooms.get(roomId);
    if (r) r.players.forEach(p => { if (p.readyState === 1) p.send(JSON.stringify(data)); });
}

// --- БОТ ---
bot.setChatMenuButton({ menu_button: JSON.stringify({ type: "web_app", text: "Играть", web_app: { url: APP_URL } }) });
bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "Жми кнопку внизу!", { parse_mode: "Markdown" }));

// --- SOCKETS ---
wss.on("connection", (ws) => {
    users.set(ws, { userId: null, username: "Гость", roomId: null });

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
                    state: 'LOBBY',
                    turn: { team: 'A', explainerIndex: { A: 0, B: 0 } },
                    timer: null
                });
                user.roomId = rid;
                ws.send(JSON.stringify({ type: "ROOM_CREATED", roomId: rid }));
                break;

            case "JOIN_ROOM":
                const r = rooms.get(msg.roomId.toUpperCase());
                if (r && r.state === 'LOBBY') {
                    if (!r.players.includes(ws)) r.players.push(ws);
                    user.roomId = msg.roomId.toUpperCase();
                    // Рассылаем всем список
                    const names = r.players.map(p => users.get(p).username);
                    r.players.forEach(p => p.send(JSON.stringify({ type: "LOBBY_UPDATE", players: names, count: r.players.length })));
                } else {
                    ws.send(JSON.stringify({ type: "ERROR", text: "Комната не найдена или игра уже идет" }));
                }
                break;

            case "START_GAME":
                const roomToStart = rooms.get(user.roomId);
                if (roomToStart) {
                    // ПРОВЕРКА НА МИНИМУМ 4 ИГРОКА (Раскомментируй для продакшена)
                    if (roomToStart.players.length < 4) {
                       ws.send(JSON.stringify({ type: "ERROR", text: "Нужно минимум 4 игрока!" }));
                       return; 
                    }
                    startGame(user.roomId);
                }
                break;

            case "HINT":
                const rh = rooms.get(user.roomId);
                if (rh) {
                    // Рассылаем подсказку всем
                    rh.players.forEach(p => p.send(JSON.stringify({ type: "LIVE_HINT", text: msg.text })));
                }
                break;

            case "CORRECT":
                const rc = rooms.get(user.roomId);
                if (rc && rc.state === 'PLAYING') {
                    rc.scores[rc.turn.team]++;
                    rc.currentWord = wordList[Math.floor(Math.random() * wordList.length)];
                    broadcastRoom(user.roomId, { type: "SCORE_UPDATE", scores: rc.scores });
                    
                    // Обновляем слово ТОЛЬКО объясняющему
                    const team = rc.teams[rc.turn.team];
                    const expIdx = rc.turn.explainerIndex[rc.turn.team] % team.length;
                    const explainer = team[expIdx];
                    explainer.send(JSON.stringify({ type: "NEW_WORD", word: rc.currentWord }));
                }
                break;
                
             case "INVITE_FRIEND":
                bot.sendMessage(msg.targetTgId, `🎮 *${user.username}* зовет играть в Alias 2x2!\nКод: \`${msg.roomId}\``, { parse_mode: "Markdown" });
                break;
                
             case "GET_FRIENDS":
                // В реальном коде нужен глобальный список, здесь упрощено
                 ws.send(JSON.stringify({ type: "FRIENDS_LIST", list: [] }));
                 break;
        }
    });
    
    ws.on("close", () => {
        // Упрощенная логика выхода. В идеале нужно ставить паузу игре.
        const user = users.get(ws);
        if(user && user.roomId) {
            const r = rooms.get(user.roomId);
            if(r) {
                r.players = r.players.filter(p => p !== ws);
                if(r.players.length === 0) rooms.delete(user.roomId);
            }
        }
        users.delete(ws);
    });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Server running on ${PORT}`));
