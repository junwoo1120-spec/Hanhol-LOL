const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs'); // 파일 저장소용 모듈
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const JWT_SECRET = process.env.JWT_SECRET || 'my_secret_key_12345';

// === 파일 기반 DB 로직 (서버 재부팅되어도 유저 정보 유지) ===
const DB_FILE = path.join(__dirname, 'users.json');

function loadUsersDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      return new Map(JSON.parse(data));
    }
  } catch (err) {
    console.error('DB 로드 에러:', err);
  }
  return new Map();
}

function saveUsersDB() {
  try {
    const data = JSON.stringify(Array.from(usersDB.entries()));
    fs.writeFileSync(DB_FILE, data, 'utf8');
  } catch (err) {
    console.error('DB 저장 에러:', err);
  }
}

const usersDB = loadUsersDB();

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const MAP_SIZE = 2000;
let players = {};
let joinCounter = 0;

const NEXUS_RADIUS = 35;
const INHIBITOR_RADIUS = 25;
const TURRET_RADIUS = 22;

const colliders = [
  // === 블루팀 ===
  { x: 225, y: 1766, radius: NEXUS_RADIUS },
  { x: 309, y: 1748, radius: TURRET_RADIUS },
  { x: 251, y: 1687, radius: TURRET_RADIUS },
  { x: 175, y: 1513, radius: INHIBITOR_RADIUS },
  { x: 446, y: 1561, radius: INHIBITOR_RADIUS },
  { x: 478, y: 1824, radius: INHIBITOR_RADIUS },
  { x: 175, y: 1417, radius: TURRET_RADIUS },
  { x: 506, y: 1495, radius: TURRET_RADIUS },
  { x: 589, y: 1821, radius: TURRET_RADIUS },
  { x: 222, y: 1096, radius: TURRET_RADIUS },
  { x: 692, y: 1347, radius: TURRET_RADIUS },
  { x: 941, y: 1791, radius: TURRET_RADIUS },
  { x: 149, y: 597,  radius: TURRET_RADIUS },
  { x: 798, y: 1136, radius: TURRET_RADIUS },
  { x: 1418, y: 1852, radius: TURRET_RADIUS },

  // === 레드팀 ===
  { x: 1786, y: 223, radius: NEXUS_RADIUS },
  { x: 1759, y: 307, radius: TURRET_RADIUS },
  { x: 1702, y: 242, radius: TURRET_RADIUS },
  { x: 1519, y: 163, radius: INHIBITOR_RADIUS },
  { x: 1564, y: 434, radius: INHIBITOR_RADIUS },
  { x: 1832, y: 479, radius: INHIBITOR_RADIUS },
  { x: 1416, y: 168, radius: TURRET_RADIUS },
  { x: 1501, y: 495, radius: TURRET_RADIUS },
  { x: 1835, y: 579, radius: TURRET_RADIUS },
  { x: 1077, y: 199, radius: TURRET_RADIUS },
  { x: 1319, y: 640, radius: TURRET_RADIUS },
  { x: 1796, y: 893, radius: TURRET_RADIUS },
  { x: 595,  y: 138, radius: TURRET_RADIUS },
  { x: 1211, y: 854, radius: TURRET_RADIUS },
  { x: 1867, y: 1388, radius: TURRET_RADIUS }
];

function isColliding(x, y, playerRadius = 4.2) {
  for (let c of colliders) {
    const dx = x - c.x;
    const dy = y - c.y;
    if (Math.sqrt(dx * dx + dy * dy) < c.radius + playerRadius) return true;
  }
  return false;
}

// 회원가입 API
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: '아이디와 비밀번호를 입력해주세요.' });

    if (usersDB.has(username)) {
      return res.status(400).json({ message: '이미 존재하는 아이디입니다.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    usersDB.set(username, { username, password: hashedPassword });
    saveUsersDB();

    const token = jwt.sign({ username }, JWT_SECRET);
    res.json({ token, username });
  } catch (err) {
    res.status(500).json({ message: '회원가입 처리 중 오류가 발생했습니다.' });
  }
});

// 로그인 API
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = usersDB.get(username);

    if (!user) return res.status(400).json({ message: '아이디 또는 비밀번호가 틀렸습니다.' });

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(400).json({ message: '아이디 또는 비밀번호가 틀렸습니다.' });

    const token = jwt.sign({ username: user.username }, JWT_SECRET);
    res.json({ token, username: user.username });
  } catch (err) {
    res.status(500).json({ message: '로그인 처리 중 오류가 발생했습니다.' });
  }
});

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Summoner's Rift Classic</title>
      <style>
        * { box-sizing: border-box; }
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #111; color: white; font-family: sans-serif; }
        canvas { display: block; width: 100vw; height: 100vh; background: #000; }
        
        #auth-screen {
          position: absolute; top: 0; left: 0; width: 100%; height: 100%;
          background: rgba(0, 0, 0, 0.85); display: flex; justify-content: center; align-items: center; z-index: 10;
        }
        .auth-box {
          background: #222; padding: 30px; border-radius: 12px; width: 340px; text-align: center;
          border: 1px solid #444; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        }
        .auth-box h2 { margin-top: 0; }
        .auth-box input {
          width: 100%; padding: 10px; margin: 8px 0; border-radius: 6px; border: 1px solid #555; background: #333; color: #fff;
        }
        .password-container { position: relative; width: 100%; }
        .password-container input { padding-right: 40px; }
        .toggle-password {
          position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
          cursor: pointer; user-select: none; font-size: 16px;
        }
        .auth-box button {
          width: 100%; padding: 10px; margin-top: 12px; border-radius: 6px; border: none; background: #0088ff; color: #fff; font-weight: bold; cursor: pointer;
        }
        .auth-box button:hover { background: #0066cc; }
        .warning-text { color: #ffaa00; font-size: 12px; margin-bottom: 12px; }
        .toggle-text { margin-top: 15px; font-size: 13px; color: #aaa; cursor: pointer; text-decoration: underline; }

        /* === 왼쪽 아래 채팅 UI (1.2배 확대) === */
        #chat-container {
          position: absolute; left: 24px; bottom: 24px; width: 336px;
          background: rgba(0, 0, 0, 0.75); border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 10px; z-index: 5; display: none; flex-direction: column;
          box-shadow: 0 5px 18px rgba(0,0,0,0.5); backdrop-filter: blur(4px);
        }
        #chat-messages {
          height: 192px; padding: 12px; overflow-y: auto; font-size: 15px;
          display: flex; flex-direction: column; gap: 7px; word-break: break-all;
        }
        #chat-messages::-webkit-scrollbar { width: 5px; }
        #chat-messages::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.3); border-radius: 3px; }
        .chat-msg { color: #eee; line-height: 1.3; }
        .chat-msg .sender { font-weight: bold; }
        .chat-msg .sender.blue { color: #0088ff; }
        .chat-msg .sender.red { color: #ff3333; }
        .chat-msg .system { color: #ffea00; font-style: italic; }
        #chat-input-container { display: flex; border-top: 1px solid rgba(255, 255, 255, 0.1); }
        #chat-input {
          flex: 1; background: transparent; border: none; padding: 10px 12px;
          color: #fff; font-size: 14px; outline: none;
        }
        #chat-send-btn {
          background: #0088ff; border: none; color: #fff; padding: 0 15px;
          font-size: 14px; font-weight: bold; cursor: pointer; border-bottom-right-radius: 9px;
        }
        #chat-send-btn:hover { background: #0066cc; }

        /* === 오른쪽 아래 미니맵 UI === */
        #minimap-container {
          position: absolute; right: 15px; bottom: 15px; width: 180px; height: 180px;
          background: rgba(0, 0, 0, 0.85); border: 2px solid rgba(255, 255, 255, 0.4);
          border-radius: 6px; z-index: 5; display: none; overflow: hidden;
          box-shadow: 0 4px 15px rgba(0,0,0,0.6);
        }
        #minimap { width: 100%; height: 100%; display: block; }
      </style>
    </head>
    <body>
      <div id="auth-screen">
        <div class="auth-box">
          <h2 id="auth-title">로그인</h2>
          <div class="warning-text">※ 아이디는 한글 설정 가능하며, 한 번 정하면 변경할 수 없습니다.</div>
          <input type="text" id="username" placeholder="아이디 (한글 가능)" />
          
          <div class="password-container">
            <input type="password" id="password" placeholder="비밀번호" />
            <span class="toggle-password" id="eye-icon" onclick="togglePasswordVisibility()">👁️</span>
          </div>

          <button id="auth-btn" onclick="handleAuth()">로그인</button>
          <div class="toggle-text" id="toggle-btn" onclick="toggleAuthMode()">회원가입하러 가기</div>
        </div>
      </div>

      <!-- 왼쪽 아래 채팅창 -->
      <div id="chat-container">
        <div id="chat-messages"></div>
        <div id="chat-input-container">
          <input type="text" id="chat-input" placeholder="메시지 입력 (Enter)" maxlength="100" />
          <button id="chat-send-btn" onclick="sendChatMessage()">전송</button>
        </div>
      </div>

      <!-- 오른쪽 아래 미니맵 -->
      <div id="minimap-container">
        <canvas id="minimap" width="180" height="180"></canvas>
      </div>

      <canvas id="game"></canvas>
      <script src="/socket.io/socket.io.js"></script>
      <script>
        let isSignUpMode = false;
        let myUsername = '';
        let socket = null;

        function togglePasswordVisibility() {
          const passInput = document.getElementById('password');
          const eyeIcon = document.getElementById('eye-icon');
          if (passInput.type === 'password') {
            passInput.type = 'text';
            eyeIcon.innerText = '🙈';
          } else {
            passInput.type = 'password';
            eyeIcon.innerText = '👁️';
          }
        }

        function toggleAuthMode() {
          isSignUpMode = !isSignUpMode;
          document.getElementById('auth-title').innerText = isSignUpMode ? '회원가입' : '로그인';
          document.getElementById('auth-btn').innerText = isSignUpMode ? '회원가입' : '로그인';
          document.getElementById('toggle-btn').innerText = isSignUpMode ? '로그인하러 가기' : '회원가입하러 가기';
        }

        async function handleAuth() {
          const username = document.getElementById('username').value.trim();
          const password = document.getElementById('password').value.trim();

          if (!username || !password) return alert('아이디와 비밀번호를 모두 입력해주세요.');

          const endpoint = isSignUpMode ? '/api/register' : '/api/login';
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
          });

          const data = await res.json();
          if (!res.ok) return alert(data.message);

          myUsername = data.username;
          document.getElementById('auth-screen').style.display = 'none';
          document.getElementById('chat-container').style.display = 'flex';
          document.getElementById('minimap-container').style.display = 'block';
          initGame(data.token);
        }

        function sendChatMessage() {
          const chatInput = document.getElementById('chat-input');
          const text = chatInput.value.trim();
          if (text && socket) {
            socket.emit('chatMessage', text);
            chatInput.value = '';
          }
        }

        function appendChatMessage(sender, text, team = '', isSystem = false) {
          const msgContainer = document.getElementById('chat-messages');
          const msgDiv = document.createElement('div');
          msgDiv.className = 'chat-msg';

          if (isSystem) {
            msgDiv.innerHTML = \`<span class="system">\${text}</span>\`;
          } else {
            const teamClass = team === 'blue' ? 'blue' : (team === 'red' ? 'red' : '');
            msgDiv.innerHTML = \`<span class="sender \${teamClass}">\${sender}:</span> \${text}\`;
          }

          msgContainer.appendChild(msgDiv);
          msgContainer.scrollTop = msgContainer.scrollHeight;
        }

        function initGame(token) {
          socket = io({ auth: { token } });
          const canvas = document.getElementById('game');
          const ctx = canvas.getContext('2d');

          const miniCanvas = document.getElementById('minimap');
          const miniCtx = miniCanvas.getContext('2d');

          const MAP_SIZE = 2000;

          let dpr = window.devicePixelRatio || 1;
          function resizeCanvas() {
            dpr = window.devicePixelRatio || 1;
            canvas.width = window.innerWidth * dpr;
            canvas.height = window.innerHeight * dpr;
          }
          window.addEventListener('resize', resizeCanvas);
          resizeCanvas();

          const mapImage = new Image();
          mapImage.src = 'web.webp';

          let players = {};
          const keys = {};
          let camX = 1000, camY = 1000;

          const chatInput = document.getElementById('chat-input');
          chatInput.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              sendChatMessage();
            }
          });

          window.addEventListener('keydown', (e) => {
            if (document.activeElement === chatInput) return;
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
              e.preventDefault(); keys[e.key] = true; sendMovement();
            }
          });

          window.addEventListener('keyup', (e) => {
            if (document.activeElement === chatInput) return;
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
              keys[e.key] = false; sendMovement();
            }
          });

          function sendMovement() {
            let dir = { x: 0, y: 0 };
            if (keys['ArrowUp']) dir.y -= 1;
            if (keys['ArrowDown']) dir.y += 1;
            if (keys['ArrowLeft']) dir.x -= 1;
            if (keys['ArrowRight']) dir.x += 1;
            socket.emit('keyMove', dir);
          }

          socket.on('gameState', (data) => { players = data.players; });

          socket.on('chatMessage', (data) => {
            appendChatMessage(data.username, data.text, data.team, data.isSystem);
          });

          function renderLoop() {
            drawGame();
            drawMinimap();
            requestAnimationFrame(renderLoop);
          }
          requestAnimationFrame(renderLoop);

          function drawGame() {
            const me = players[socket.id];
            ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.save();
            
            if (me) {
              camX += (me.x - camX) * 0.15;
              camY += (me.y - camY) * 0.15;
              const cssWidth = canvas.width / dpr, cssHeight = canvas.height / dpr;
              ctx.scale(dpr, dpr); ctx.translate(cssWidth / 2, cssHeight / 2);
              ctx.scale(4.0, 4.0); ctx.translate(-camX, -camY);
            }

            if (mapImage.complete && mapImage.naturalWidth !== 0) {
              ctx.drawImage(mapImage, 0, 0, MAP_SIZE, MAP_SIZE);
            }

            for (let id in players) {
              const p = players[id];

              ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
              ctx.beginPath(); ctx.arc(p.x + 0.5, p.y + 0.5, 4.2, 0, Math.PI * 2); ctx.fill();

              ctx.fillStyle = p.team === 'blue' ? '#0077ff' : '#ff2222';
              ctx.beginPath(); ctx.arc(p.x, p.y, 4.2, 0, Math.PI * 2); ctx.fill();
              
              // 블루팀과 레드팀 모두 윤곽선을 검은색으로 설정
              ctx.lineWidth = 0.8;
              ctx.strokeStyle = '#000000';
              ctx.stroke();

              ctx.fillStyle = '#ffffff';
              ctx.font = 'bold 4.5px sans-serif';
              ctx.textAlign = 'center';
              ctx.fillText(p.username, p.x, p.y - 6);
            }
            ctx.restore();
          }

          function drawMinimap() {
            const scale = 180 / MAP_SIZE;
            miniCtx.fillStyle = '#111';
            miniCtx.fillRect(0, 0, 180, 180);

            if (mapImage.complete && mapImage.naturalWidth !== 0) {
              miniCtx.drawImage(mapImage, 0, 0, 180, 180);
            }

            for (let id in players) {
              const p = players[id];
              const mx = p.x * scale;
              const my = p.y * scale;

              miniCtx.fillStyle = p.team === 'blue' ? '#00aaff' : '#ff4444';
              miniCtx.beginPath();
              miniCtx.arc(mx, my, 3.5, 0, Math.PI * 2);
              miniCtx.fill();
              miniCtx.strokeStyle = '#000000';
              miniCtx.lineWidth = 1;
              miniCtx.stroke();
            }

            const me = players[socket.id];
            if (me) {
              const cssWidth = canvas.width / dpr;
              const cssHeight = canvas.height / dpr;
              const viewW = (cssWidth / 4.0) * scale;
              const viewH = (cssHeight / 4.0) * scale;
              const viewX = (camX * scale) - (viewW / 2);
              const viewY = (camY * scale) - (viewH / 2);

              miniCtx.strokeStyle = '#ffffff';
              miniCtx.lineWidth = 1;
              miniCtx.strokeRect(viewX, viewY, viewW, viewH);
            }
          }
        }
      </script>
    </body>
    </html>
  `);
});

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('인증 에러'));

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error('인증 에러'));
    socket.username = decoded.username;
    next();
  });
});

io.on('connection', (socket) => {
  joinCounter++;
  const team = (joinCounter % 2 === 1) ? 'blue' : 'red';
  
  const spawnX = team === 'blue' ? 100 : 1900;
  const spawnY = team === 'blue' ? 1900 : 100;

  players[socket.id] = { 
    x: spawnX, 
    y: spawnY, 
    dirX: 0, 
    dirY: 0,
    username: socket.username,
    team: team
  };

  const teamName = team === 'blue' ? '블루팀' : '레드팀';
  io.emit('chatMessage', {
    username: '시스템',
    text: `${socket.username}님이 ${teamName}으로 입장하셨습니다.`,
    isSystem: true
  });

  socket.on('keyMove', (dir) => {
    if (players[socket.id]) {
      players[socket.id].dirX = dir.x;
      players[socket.id].dirY = dir.y;
    }
  });

  socket.on('chatMessage', (text) => {
    if (typeof text === 'string' && text.trim().length > 0 && players[socket.id]) {
      io.emit('chatMessage', {
        username: socket.username,
        text: text.trim().substring(0, 100),
        team: players[socket.id].team,
        isSystem: false
      });
    }
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
      io.emit('chatMessage', {
        username: '시스템',
        text: `${players[socket.id].username}님이 퇴장하셨습니다.`,
        isSystem: true
      });
      delete players[socket.id];
    }
  });
});

setInterval(() => {
  const SPEED = 0.75;
  for (let id in players) {
    const p = players[id];
    let moveX = p.dirX, moveY = p.dirY;

    if (moveX !== 0 && moveY !== 0) {
      moveX *= 0.7071; moveY *= 0.7071;
    }

    const nextX = p.x + moveX * SPEED;
    const nextY = p.y + moveY * SPEED;

    if (nextX >= 10 && nextX <= MAP_SIZE - 10 && !isColliding(nextX, p.y)) p.x = nextX;
    if (nextY >= 10 && nextY <= MAP_SIZE - 10 && !isColliding(p.x, nextY)) p.y = nextY;
  }
  io.emit('gameState', { players });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`게임 서버 작동 중 (포트: ${PORT})`); });
