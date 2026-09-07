const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const MAP_SIZE = 2000;
let players = {};

function getBalancedTeam() {
  let blueCount = 0;
  let redCount = 0;

  for (let id in players) {
    if (players[id].team === 'blue') blueCount++;
    else if (players[id].team === 'red') redCount++;
  }

  return blueCount <= redCount ? 'blue' : 'red';
}

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
        .auth-box button {
          width: 100%; padding: 10px; margin-top: 12px; border-radius: 6px; border: none; background: #0088ff; color: #fff; font-weight: bold; cursor: pointer;
        }
        .auth-box button:hover { background: #0066cc; }
        .warning-text { color: #ffaa00; font-size: 12px; margin-bottom: 12px; line-height: 1.4; word-break: keep-all; }

        /* === 상단 플레이어 리스트 UI === */
        #player-list-container {
          position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.75); border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 8px; z-index: 5; display: none; flex-direction: column;
          box-shadow: 0 4px 15px rgba(0,0,0,0.5); backdrop-filter: blur(4px);
          min-width: 180px; text-align: center; overflow: hidden;
        }
        #player-list-header {
          padding: 8px 14px; font-size: 13px; font-weight: bold; cursor: pointer;
          user-select: none; background: rgba(255, 255, 255, 0.05); display: flex;
          justify-content: space-between; align-items: center; gap: 10px;
        }
        #player-list-header:hover { background: rgba(255, 255, 255, 0.15); }
        #player-list-content {
          display: none; padding: 10px; max-height: 150px; overflow-y: auto;
          border-top: 1px solid rgba(255, 255, 255, 0.1); font-size: 13px;
        }
        .player-item { padding: 4px 0; font-weight: bold; }
        .player-item.blue { color: #00aaff; }
        .player-item.red { color: #ff4444; }

        /* === 채팅 UI === */
        #chat-container {
          position: absolute; left: 24px; bottom: 24px; width: 336px;
          background: rgba(0, 0, 0, 0.75); border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 10px; z-index: 5; display: none; flex-direction: column;
          box-shadow: 0 5px 18px rgba(0,0,0,0.5); backdrop-filter: blur(4px);
        }
        #chat-messages {
          height: 192px; padding: 12px; overflow-y: auto; font-size: 14px;
          display: flex; flex-direction: column; gap: 7px; word-break: break-all;
        }
        #chat-messages::-webkit-scrollbar { width: 5px; }
        #chat-messages::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.3); border-radius: 3px; }
        .chat-msg { color: #eee; line-height: 1.3; }
        .chat-msg .type { font-size: 11px; font-weight: bold; margin-right: 4px; padding: 1px 4px; border-radius: 3px; }
        .chat-msg .type.all { background: #555; color: #fff; }
        .chat-msg .type.team { background: #15803d; color: #fff; }
        .chat-msg .sender { font-weight: bold; }
        .chat-msg .sender.blue { color: #0088ff; }
        .chat-msg .sender.red { color: #ff3333; }
        .chat-msg .system { color: #ffea00; font-style: italic; }
        
        #chat-mode-bar {
          display: flex; border-top: 1px solid rgba(255, 255, 255, 0.1); background: rgba(0, 0, 0, 0.4);
        }
        .mode-btn {
          flex: 1; background: transparent; border: none; color: #888; padding: 6px 0; font-size: 12px; font-weight: bold; cursor: pointer;
        }
        .mode-btn.active { color: #fff; background: rgba(255, 255, 255, 0.15); }
        
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

        /* === 미니맵 UI === */
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
      <!-- 게스트 로그인 화면 -->
      <div id="auth-screen">
        <div class="auth-box">
          <h2>게스트 입장</h2>
          <div class="warning-text">※ 플레이에 사용할 닉네임을 입력해 주세요. (1회성)</div>
          <input type="text" id="username" placeholder="닉네임 입력 (한글 가능)" maxlength="12" />
          <button id="auth-btn" onclick="handleGuestLogin()">게임 시작</button>
        </div>
      </div>

      <!-- 상단 접속자 UI -->
      <div id="player-list-container">
        <div id="player-list-header" onclick="togglePlayerList()">
          <span>👥 접속자 (<span id="player-count">0</span>명)</span>
          <span id="player-list-icon">∨</span>
        </div>
        <div id="player-list-content"></div>
      </div>

      <div id="chat-container">
        <div id="chat-messages"></div>
        <div id="chat-mode-bar">
          <button class="mode-btn active" id="btn-mode-all" onclick="setChatMode('all')">전체 (Shift+Enter)</button>
          <button class="mode-btn" id="btn-mode-team" onclick="setChatMode('team')">팀 (Shift+Enter)</button>
        </div>
        <div id="chat-input-container">
          <input type="text" id="chat-input" placeholder="전체 메시지 입력..." maxlength="100" />
          <button id="chat-send-btn" onclick="sendChatMessage()">전송</button>
        </div>
      </div>

      <div id="minimap-container">
        <canvas id="minimap" width="180" height="180"></canvas>
      </div>

      <canvas id="game"></canvas>
      <script src="/socket.io/socket.io.js"></script>
      <script>
        let myUsername = '';
        let socket = null;
        let chatTargetMode = 'all';
        let isPlayerListExpanded = false;

        function togglePlayerList() {
          isPlayerListExpanded = !isPlayerListExpanded;
          const content = document.getElementById('player-list-content');
          const icon = document.getElementById('player-list-icon');

          if (isPlayerListExpanded) {
            content.style.display = 'block';
            icon.innerText = '∧';
          } else {
            content.style.display = 'none';
            icon.innerText = '∨';
          }
        }

        function updatePlayerListUI(playersData) {
          const countSpan = document.getElementById('player-count');
          const contentDiv = document.getElementById('player-list-content');

          const playerArray = Object.values(playersData);
          countSpan.innerText = playerArray.length;

          contentDiv.innerHTML = '';
          playerArray.forEach(p => {
            const item = document.createElement('div');
            item.className = \`player-item \${p.team}\`;
            item.innerText = \`\${p.username} (\${p.team === 'blue' ? '블루' : '레드'})\`;
            contentDiv.appendChild(item);
          });
        }

        function handleGuestLogin() {
          const usernameInput = document.getElementById('username');
          const username = usernameInput.value.trim();

          if (!username) return alert('사용할 닉네임을 입력해주세요.');

          myUsername = username;
          document.getElementById('auth-screen').style.display = 'none';
          document.getElementById('player-list-container').style.display = 'flex';
          document.getElementById('chat-container').style.display = 'flex';
          document.getElementById('minimap-container').style.display = 'block';
          
          initGame(myUsername);
        }

        // Enter 키로도 게스트 로그인 가능
        document.getElementById('username').addEventListener('keydown', (e) => {
          if (e.key === 'Enter') handleGuestLogin();
        });

        function setChatMode(mode) {
          chatTargetMode = mode;
          const btnAll = document.getElementById('btn-mode-all');
          const btnTeam = document.getElementById('btn-mode-team');
          const chatInput = document.getElementById('chat-input');

          if (mode === 'all') {
            btnAll.classList.add('active');
            btnTeam.classList.remove('active');
            chatInput.placeholder = '전체 메시지 입력...';
          } else {
            btnTeam.classList.add('active');
            btnAll.classList.remove('active');
            chatInput.placeholder = '팀 메시지 입력...';
          }
        }

        function sendChatMessage() {
          const chatInput = document.getElementById('chat-input');
          const text = chatInput.value.trim();
          if (text && socket) {
            socket.emit('chatMessage', { text, targetMode: chatTargetMode });
            chatInput.value = '';
          }
        }

        function appendChatMessage(sender, text, team = '', isSystem = false, targetMode = 'all') {
          const msgContainer = document.getElementById('chat-messages');
          const msgDiv = document.createElement('div');
          msgDiv.className = 'chat-msg';

          if (isSystem) {
            msgDiv.innerHTML = \`<span class="system">\${text}</span>\`;
          } else {
            const teamClass = team === 'blue' ? 'blue' : (team === 'red' ? 'red' : '');
            const typeLabel = targetMode === 'team' ? '<span class="type team">팀</span>' : '<span class="type all">전체</span>';
            msgDiv.innerHTML = \`\${typeLabel}<span class="sender \${teamClass}">\${sender}:</span> \${text}\`;
          }

          msgContainer.appendChild(msgDiv);
          msgContainer.scrollTop = msgContainer.scrollHeight;
        }

        function initGame(username) {
          socket = io({ auth: { username } });
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
              if (e.shiftKey) {
                setChatMode(chatTargetMode === 'all' ? 'team' : 'all');
              } else {
                sendChatMessage();
              }
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

          socket.on('gameState', (data) => { 
            players = data.players; 
            updatePlayerListUI(players);
          });

          socket.on('chatMessage', (data) => {
            appendChatMessage(data.username, data.text, data.team, data.isSystem, data.targetMode);
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

            const me = players[socket.id];

            for (let id in players) {
              const p = players[id];

              if (me && p.team !== me.team) continue;

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

// 소켓 커넥션 시 닉네임 유효성 확인
io.use((socket, next) => {
  const username = socket.handshake.auth.username;
  if (!username) return next(new Error('닉네임이 올바르지 않습니다.'));
  socket.username = username;
  next();
});

io.on('connection', (socket) => {
  const team = getBalancedTeam();
  
  socket.join(team);

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
    isSystem: true,
    targetMode: 'all'
  });

  socket.on('keyMove', (dir) => {
    if (players[socket.id]) {
      players[socket.id].dirX = dir.x;
      players[socket.id].dirY = dir.y;
    }
  });

  socket.on('chatMessage', (data) => {
    const senderPlayer = players[socket.id];
    if (!senderPlayer) return;

    let text = '';
    let targetMode = 'all';

    if (typeof data === 'string') {
      text = data;
    } else if (typeof data === 'object' && data.text) {
      text = data.text;
      targetMode = data.targetMode || 'all';
    }

    text = text.trim().substring(0, 100);
    if (!text) return;

    const payload = {
      username: socket.username,
      text: text,
      team: senderPlayer.team,
      isSystem: false,
      targetMode: targetMode
    };

    if (targetMode === 'team') {
      io.to(senderPlayer.team).emit('chatMessage', payload);
    } else {
      io.emit('chatMessage', payload);
    }
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
      io.emit('chatMessage', {
        username: '시스템',
        text: `${players[socket.id].username}님이 퇴장하셨습니다.`,
        isSystem: true,
        targetMode: 'all'
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
