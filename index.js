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
let gameOver = false;
let winnerTeam = null;

let nexuses = {
  blue: { x: 225, y: 1766, hp: 4000, maxHp: 4000, radius: 35 },
  red: { x: 1786, y: 223, hp: 4000, maxHp: 4000, radius: 35 }
};

function getBalancedTeam() {
  let blueCount = 0;
  let redCount = 0;

  for (let id in players) {
    if (players[id].team === 'blue') blueCount++;
    else if (players[id].team === 'red') redCount++;
  }

  return blueCount <= redCount ? 'blue' : 'red';
}

const INHIBITOR_RADIUS = 25;
const TURRET_RADIUS = 22;

const colliders = [
  // === 블루팀 ===
  { x: 225, y: 1766, radius: nexuses.blue.radius },
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
  { x: 1786, y: 223, radius: nexuses.red.radius },
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

function isColliding(x, y, playerRadius = 15) {
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
      <title>Summoner's Rift Classic - Garen</title>
      <style>
        * { box-sizing: border-box; }
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #111; color: white; font-family: sans-serif; user-select: none; }
        canvas { display: block; width: 100vw; height: 100vh; background: #000; }
        
        .dead-screen { filter: grayscale(100%); }

        #respawn-overlay {
          position: absolute; top: 30%; left: 50%; transform: translate(-50%, -50%);
          font-size: 28px; font-weight: bold; color: #ff3333; text-shadow: 2px 2px 4px #000;
          display: none; z-index: 10; pointer-events: none;
        }

        #recall-overlay {
          position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%);
          font-size: 24px; font-weight: bold; color: #38bdf8; text-shadow: 2px 2px 4px #000;
          display: none; z-index: 10; pointer-events: none;
        }

        #game-over-overlay {
          position: absolute; top: 0; left: 0; width: 100%; height: 100%;
          background: rgba(0, 0, 0, 0.85); display: none; flex-direction: column;
          justify-content: center; align-items: center; z-index: 20;
        }
        #game-over-text { font-size: 72px; font-weight: 900; letter-spacing: 4px; margin-bottom: 20px; text-shadow: 0 0 20px rgba(255,255,255,0.5); }
        .victory { color: #38bdf8; }
        .defeat { color: #f87171; }
        #restart-btn {
          padding: 14px 32px; font-size: 20px; font-weight: bold; background: #c8aa6e;
          color: #111; border: none; border-radius: 8px; cursor: pointer; transition: 0.2s;
        }
        #restart-btn:hover { background: #f0e6d2; transform: scale(1.05); }

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

        #player-list-container {
          position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.75); border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 8px; z-index: 5; display: none; flex-direction: column;
          box-shadow: 0 4px 15px rgba(0,0,0,0.5); backdrop-filter: blur(4px);
          min-width: 220px; text-align: center; overflow: hidden;
        }
        #player-list-header {
          padding: 8px 14px; font-size: 13px; font-weight: bold; cursor: pointer;
          user-select: none; background: rgba(255, 255, 255, 0.05); display: flex;
          justify-content: space-between; align-items: center; gap: 10px;
        }
        #player-list-header:hover { background: rgba(255, 255, 255, 0.15); }
        #player-list-content {
          display: none; padding: 10px; max-height: 180px; overflow-y: auto;
          border-top: 1px solid rgba(255, 255, 255, 0.1); font-size: 13px;
        }
        .player-item {
          padding: 5px 0; font-weight: bold; display: flex;
          justify-content: space-between; align-items: center; gap: 8px;
        }
        .player-item.blue { color: #00aaff; }
        .player-item.red { color: #ff4444; }

        #chat-container {
          position: absolute; left: 24px; bottom: 24px; width: 320px;
          background: rgba(0, 0, 0, 0.85); border: 1px solid #444;
          border-radius: 8px; z-index: 5; display: none; flex-direction: column;
          box-shadow: 0 5px 18px rgba(0,0,0,0.6); backdrop-filter: blur(4px); overflow: hidden;
        }
        #chat-header {
          padding: 7px 12px; font-size: 12px; font-weight: bold; cursor: pointer;
          background: rgba(255, 255, 255, 0.08); display: flex;
          justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        #chat-body { display: flex; flex-direction: column; }
        #chat-messages {
          height: 160px; padding: 10px; overflow-y: auto; font-size: 13px;
          display: flex; flex-direction: column; gap: 6px; word-break: break-all;
        }
        .chat-msg { color: #eee; line-height: 1.3; }
        .chat-msg .type { font-size: 10px; font-weight: bold; margin-right: 4px; padding: 1px 3px; border-radius: 3px; }
        .chat-msg .type.all { background: #555; color: #fff; }
        .chat-msg .type.team { background: #15803d; color: #fff; }
        .chat-msg .sender { font-weight: bold; }
        .chat-msg .sender.blue { color: #0088ff; }
        .chat-msg .sender.red { color: #ff3333; }
        .chat-msg .system { color: #ffea00; font-style: italic; }
        
        #chat-mode-bar { display: flex; border-top: 1px solid rgba(255, 255, 255, 0.1); background: rgba(0, 0, 0, 0.4); }
        .mode-btn { flex: 1; background: transparent; border: none; color: #888; padding: 5px 0; font-size: 11px; font-weight: bold; cursor: pointer; }
        .mode-btn.active { color: #fff; background: rgba(255, 255, 255, 0.15); }
        
        #chat-input-container { display: flex; border-top: 1px solid rgba(255, 255, 255, 0.1); }
        #chat-input { flex: 1; background: transparent; border: none; padding: 8px 10px; color: #fff; font-size: 13px; outline: none; }
        #chat-send-btn { background: #0088ff; border: none; color: #fff; padding: 0 12px; font-size: 12px; font-weight: bold; cursor: pointer; }

        #minimap-container {
          position: absolute; right: 15px; bottom: 15px; width: 180px; height: 180px;
          background: rgba(0, 0, 0, 0.85); border: 2px solid rgba(255, 255, 255, 0.4);
          border-radius: 6px; z-index: 5; display: none; overflow: hidden;
        }
        #minimap { width: 100%; height: 100%; display: block; }

        #hud-container {
          position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%);
          display: none; align-items: flex-end; gap: 10px; z-index: 6;
          background: rgba(10, 15, 20, 0.85); border: 2px solid #5b4622;
          padding: 8px 16px; border-radius: 12px; box-shadow: 0 0 15px rgba(0,0,0,0.8);
        }
        .portrait-box {
          position: relative; width: 64px; height: 64px; border-radius: 50%;
          border: 3px solid #c8aa6e; overflow: hidden; background: #000;
        }
        .portrait-box canvas { width: 100%; height: 100%; }

        .skills-container { display: flex; gap: 8px; align-items: center; }
        .skill-slot {
          position: relative; width: 48px; height: 48px; background: #1e2328;
          border: 2px solid #5b4622; border-radius: 6px; display: flex;
          justify-content: center; align-items: center; font-weight: bold; overflow: hidden;
        }
        .skill-key { position: absolute; top: 2px; left: 4px; font-size: 10px; color: #c8aa6e; text-shadow: 1px 1px 2px #000; z-index: 2; }
        .skill-icon-canvas { width: 100%; height: 100%; display: block; }
        .cooldown-overlay {
          position: absolute; top: 0; left: 0; width: 100%; height: 100%;
          background: rgba(0, 0, 0, 0.75); display: flex; justify-content: center;
          align-items: center; color: #fff; font-size: 18px; font-weight: bold; z-index: 3;
        }
      </style>
    </head>
    <body>
      <div id="respawn-overlay">부활 대기 중... <span id="respawn-timer">10</span>초</div>
      <div id="recall-overlay">귀환 중... <span id="recall-timer">8</span>초</div>

      <div id="game-over-overlay">
        <div id="game-over-text">VICTORY</div>
        <button id="restart-btn" onclick="restartGame()">다시 플레이 하기</button>
      </div>

      <div id="auth-screen">
        <div class="auth-box">
          <h2>게스트 입장</h2>
          <div class="warning-text">※ 플레이에 사용할 닉네임을 입력해 주세요. (1회성)</div>
          <input type="text" id="username" placeholder="닉네임 입력 (한글 가능)" maxlength="12" />
          <button id="auth-btn" onclick="handleGuestLogin()">게임 시작</button>
        </div>
      </div>

      <div id="player-list-container">
        <div id="player-list-header" onclick="togglePlayerList()">
          <span>👥 접속자 (<span id="player-count">0</span>명)</span>
          <span id="player-list-icon">∨</span>
        </div>
        <div id="player-list-content"></div>
      </div>

      <div id="chat-container">
        <div id="chat-header" onclick="toggleChat()">
          <span>💬 채팅</span>
          <span id="chat-toggle-icon">∨</span>
        </div>
        <div id="chat-body">
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
      </div>

      <div id="minimap-container">
        <canvas id="minimap" width="180" height="180"></canvas>
      </div>

      <div id="hud-container">
        <div class="portrait-box">
          <canvas id="portrait-canvas" width="64" height="64"></canvas>
        </div>
        <div class="skills-container">
          <div class="skill-slot" id="slot-q">
            <span class="skill-key">Q</span>
            <canvas class="skill-icon-canvas" id="icon-q" width="48" height="48"></canvas>
            <div class="cooldown-overlay" id="cd-q" style="display:none;">0</div>
          </div>
          <div class="skill-slot" id="slot-w">
            <span class="skill-key">W</span>
            <canvas class="skill-icon-canvas" id="icon-w" width="48" height="48"></canvas>
            <div class="cooldown-overlay" id="cd-w" style="display:none;">0</div>
          </div>
          <div class="skill-slot" id="slot-e">
            <span class="skill-key">E</span>
            <canvas class="skill-icon-canvas" id="icon-e" width="48" height="48"></canvas>
            <div class="cooldown-overlay" id="cd-e" style="display:none;">0</div>
          </div>
          <div class="skill-slot" id="slot-r">
            <span class="skill-key">R</span>
            <canvas class="skill-icon-canvas" id="icon-r" width="48" height="48"></canvas>
          </div>
        </div>
      </div>

      <canvas id="game"></canvas>
      <script src="/socket.io/socket.io.js"></script>
      <script>
        let myUsername = '';
        let socket = null;
        let chatTargetMode = 'all';
        let isPlayerListExpanded = false;
        let isChatExpanded = true;

        function togglePlayerList() {
          isPlayerListExpanded = !isPlayerListExpanded;
          document.getElementById('player-list-content').style.display = isPlayerListExpanded ? 'block' : 'none';
          document.getElementById('player-list-icon').innerText = isPlayerListExpanded ? '∧' : '∨';
        }

        function toggleChat() {
          isChatExpanded = !isChatExpanded;
          document.getElementById('chat-body').style.display = isChatExpanded ? 'flex' : 'none';
          document.getElementById('chat-toggle-icon').innerText = isChatExpanded ? '∨' : '∧';
        }

        function restartGame() {
          if (socket) socket.emit('requestRestart');
        }

        function updatePlayerListUI(playersData) {
          const countSpan = document.getElementById('player-count');
          const contentDiv = document.getElementById('player-list-content');
          const entries = Object.entries(playersData);
          countSpan.innerText = entries.length;
          contentDiv.innerHTML = '';
          entries.forEach(([id, p]) => {
            const item = document.createElement('div');
            item.className = \`player-item \${p.team}\`;
            item.innerHTML = \`<span>\${p.username} (\${p.team === 'blue' ? '블루' : '레드'})\`;
            contentDiv.appendChild(item);
          });
        }

        function handleGuestLogin() {
          const username = document.getElementById('username').value.trim();
          if (!username) return alert('사용할 닉네임을 입력해주세요.');
          myUsername = username;
          document.getElementById('auth-screen').style.display = 'none';
          document.getElementById('player-list-container').style.display = 'flex';
          document.getElementById('chat-container').style.display = 'flex';
          document.getElementById('minimap-container').style.display = 'block';
          document.getElementById('hud-container').style.display = 'flex';
          initGame(myUsername);
        }

        document.getElementById('username').addEventListener('keydown', (e) => {
          if (e.key === 'Enter') handleGuestLogin();
        });

        function setChatMode(mode) {
          chatTargetMode = mode;
          document.getElementById('btn-mode-all').classList.toggle('active', mode === 'all');
          document.getElementById('btn-mode-team').classList.toggle('active', mode === 'team');
          document.getElementById('chat-input').placeholder = mode === 'all' ? '전체 메시지 입력...' : '팀 메시지 입력...';
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
          const miniCtx = document.getElementById('minimap').getContext('2d');
          const portraitCtx = document.getElementById('portrait-canvas').getContext('2d');

          const respawnOverlay = document.getElementById('respawn-overlay');
          const respawnTimer = document.getElementById('respawn-timer');
          const recallOverlay = document.getElementById('recall-overlay');
          const recallTimer = document.getElementById('recall-timer');

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

          let serverPlayers = {};
          let clientPlayers = {};
          let serverNexuses = { blue: { hp: 4000, maxHp: 4000 }, red: { hp: 4000, maxHp: 4000 } };
          const keys = {};
          let camX = 1000, camY = 1000;

          drawSkillIcons();

          const chatInput = document.getElementById('chat-input');
          chatInput.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              if (e.shiftKey) setChatMode(chatTargetMode === 'all' ? 'team' : 'all');
              else sendChatMessage();
            }
          });

          window.addEventListener('keydown', (e) => {
            if (document.activeElement === chatInput) return;
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
              e.preventDefault(); keys[e.key] = true; sendMovement();
            }
            if (e.code === 'Space') { e.preventDefault(); socket.emit('attack'); }
            if (e.key === 'q' || e.key === 'Q' || e.key === 'ㅂ') socket.emit('useQ');
            if (e.key === 'w' || e.key === 'W' || e.key === 'ㅈ') socket.emit('useW');
            if (e.key === 'e' || e.key === 'E' || e.key === 'ㄷ') socket.emit('useE');
            if (e.key === 'b' || e.key === 'B' || e.key === 'ㅠ') socket.emit('useRecall');
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
            serverPlayers = data.players; 
            if (data.nexuses) serverNexuses = data.nexuses;
            updatePlayerListUI(serverPlayers);

            for (let id in serverPlayers) {
              const sp = serverPlayers[id];
              if (!clientPlayers[id]) {
                clientPlayers[id] = { ...sp, renderX: sp.x, renderY: sp.y, renderAngle: 0 };
              } else {
                Object.assign(clientPlayers[id], sp);
              }
            }

            for (let id in clientPlayers) {
              if (!serverPlayers[id]) delete clientPlayers[id];
            }

            const gameOverOverlay = document.getElementById('game-over-overlay');
            const gameOverText = document.getElementById('game-over-text');
            const me = clientPlayers[socket.id];

            if (data.gameOver && me) {
              gameOverOverlay.style.display = 'flex';
              if (data.winnerTeam === me.team) {
                gameOverText.innerText = 'VICTORY';
                gameOverText.className = 'victory';
              } else {
                gameOverText.innerText = 'DEFEAT';
                gameOverText.className = 'defeat';
              }
            } else {
              gameOverOverlay.style.display = 'none';
            }
          });

          socket.on('chatMessage', (data) => {
            appendChatMessage(data.username, data.text, data.team, data.isSystem, data.targetMode);
          });

          let lastTime = performance.now();

          function renderLoop(currentTime) {
            const dt = (currentTime - lastTime) / 1000;
            lastTime = currentTime;

            for (let id in clientPlayers) {
              const cp = clientPlayers[id];
              
              let moveSpeedMultiplier = 1.0;
              if (cp.hasSpeedBuff) moveSpeedMultiplier *= 1.35;
              if (cp.isEActive) moveSpeedMultiplier *= 1.3;

              const baseSpeed = 21 * moveSpeedMultiplier; 

              if (cp.dirX !== 0 || cp.dirY !== 0) {
                cp.renderAngle = Math.atan2(cp.dirY, cp.dirX);
                let mx = cp.dirX, my = cp.dirY;
                if (mx !== 0 && my !== 0) { mx *= 0.7071; my *= 0.7071; }
                cp.renderX += mx * baseSpeed * dt;
                cp.renderY += my * baseSpeed * dt;
              }

              cp.renderX += (cp.x - cp.renderX) * 0.2;
              cp.renderY += (cp.y - cp.renderY) * 0.2;
            }

            const me = clientPlayers[socket.id];
            if (me) {
              if (me.isDead) {
                document.body.classList.add('dead-screen');
                respawnOverlay.style.display = 'block';
                respawnTimer.innerText = Math.max(0, Math.ceil((me.respawnTime - Date.now()) / 1000));
              } else {
                document.body.classList.remove('dead-screen');
                respawnOverlay.style.display = 'none';
              }

              if (me.isRecalling) {
                recallOverlay.style.display = 'block';
                recallTimer.innerText = Math.max(0, (me.recallEndTime - Date.now()) / 1000).toFixed(1);
              } else {
                recallOverlay.style.display = 'none';
              }
            }

            drawGame();
            drawMinimap();
            drawHUD();
            requestAnimationFrame(renderLoop);
          }
          requestAnimationFrame(renderLoop);

          function drawGarenCharacter(ctx, p) {
            if (p.isDead) return;

            ctx.save();
            ctx.translate(p.renderX, p.renderY);

            // W 스킬 보호막 효과
            if (p.hasShieldPhase || p.hasDamageReducePhase) {
              ctx.beginPath();
              ctx.arc(0, 0, 24, 0, Math.PI * 2);
              ctx.fillStyle = 'rgba(255, 215, 0, 0.25)';
              ctx.fill();
              ctx.strokeStyle = '#ffd700';
              ctx.lineWidth = 2;
              ctx.stroke();
            }

            // 회전 적용
            ctx.rotate(p.renderAngle);

            // 본체 (원형 기본 디자인 원복)
            ctx.beginPath();
            ctx.arc(0, 0, 16, 0, Math.PI * 2);
            ctx.fillStyle = p.team === 'blue' ? '#2563eb' : '#dc2626';
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#f59e0b'; // 가렌 특유의 금빛 갑옷 테두리
            ctx.stroke();

            // 어깨 갑옷 표현
            ctx.fillStyle = '#fbbf24';
            ctx.fillRect(-6, -18, 12, 5);
            ctx.fillRect(-6, 13, 12, 5);

            // 검 / E 스킬 휠풍 효과
            if (p.isEActive) {
              const elapsed = Date.now() - p.eStartTime;
              const angle = (elapsed / 100) * Math.PI;
              
              ctx.save();
              ctx.rotate(angle);
              ctx.beginPath();
              ctx.arc(0, 0, 32, 0, Math.PI * 2);
              ctx.strokeStyle = 'rgba(251, 191, 36, 0.6)';
              ctx.lineWidth = 6;
              ctx.stroke();

              ctx.fillStyle = '#eab308';
              ctx.fillRect(0, -4, 36, 8);
              ctx.restore();
            } else {
              // 일반 검
              ctx.fillStyle = p.hasQBuff ? '#facc15' : '#cbd5e1';
              ctx.fillRect(8, -3, 20, 6);
              if (p.hasQBuff) {
                ctx.shadowColor = '#facc15';
                ctx.shadowBlur = 10;
              }
            }

            ctx.restore();
          }

          function drawGarenPortrait(ctx) {
            ctx.clearRect(0, 0, 64, 64);
            ctx.fillStyle = '#1e293b'; ctx.fillRect(0, 0, 64, 64);
            
            ctx.beginPath();
            ctx.arc(32, 32, 20, 0, Math.PI * 2);
            ctx.fillStyle = '#2563eb'; ctx.fill();
            ctx.lineWidth = 3; ctx.strokeStyle = '#fbbf24'; ctx.stroke();
          }

          function drawSkillIcons() {
            const drawIcon = (id, color, label) => {
              const c = document.getElementById(id).getContext('2d');
              c.fillStyle = color; c.fillRect(0, 0, 48, 48);
              c.fillStyle = '#fff'; c.font = 'bold 16px sans-serif';
              c.textAlign = 'center'; c.textBaseline = 'middle';
              c.fillText(label, 24, 24);
            };

            drawIcon('icon-q', '#1e3a8a', 'Q');
            drawIcon('icon-w', '#065f46', 'W');
            drawIcon('icon-e', '#991b1b', 'E');
            drawIcon('icon-r', '#581c87', 'R');
          }

          function drawHUD() {
            const me = clientPlayers[socket.id];
            if (!me) return;
            drawGarenPortrait(portraitCtx);

            const now = Date.now();
            ['q', 'w', 'e'].forEach(skill => {
              const cdBox = document.getElementById(\`cd-\${skill}\`);
              const lastTime = me[\`last\${skill.toUpperCase()}Time\`];
              const cooldown = me[\`\${skill}Cooldown\`];
              const remaining = Math.max(0, Math.ceil(((lastTime + cooldown) - now) / 1000));
              cdBox.style.display = remaining > 0 ? 'flex' : 'none';
              if (remaining > 0) cdBox.innerText = remaining;
            });
          }

          function drawGame() {
            const me = clientPlayers[socket.id];
            ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.save();
            
            if (me) {
              camX += (me.renderX - camX) * 0.2;
              camY += (me.renderY - camY) * 0.2;
              const cssWidth = canvas.width / dpr, cssHeight = canvas.height / dpr;
              ctx.scale(dpr, dpr); ctx.translate(cssWidth / 2, cssHeight / 2);
              ctx.scale(1.2, 1.2); ctx.translate(-camX, -camY);
            }

            if (mapImage.complete && mapImage.naturalWidth !== 0) {
              ctx.drawImage(mapImage, 0, 0, MAP_SIZE, MAP_SIZE);
            }

            // 넥서스 체력바 그리기
            ['blue', 'red'].forEach(team => {
              const nx = team === 'blue' ? 225 : 1786;
              const ny = team === 'blue' ? 1766 : 223;
              const nData = serverNexuses[team];
              
              if (nData) {
                const barW = 60, barH = 8;
                ctx.fillStyle = 'rgba(0,0,0,0.8)';
                ctx.fillRect(nx - barW/2, ny - 50, barW, barH);
                ctx.fillStyle = team === 'blue' ? '#00aaff' : '#ff4444';
                ctx.fillRect(nx - barW/2, ny - 50, barW * (nData.hp / nData.maxHp), barH);
              }
            });

            for (let id in clientPlayers) {
              const p = clientPlayers[id];
              if (p.isDead) continue;

              drawGarenCharacter(ctx, p);

              // HP Bar
              const barWidth = 40, barHeight = 6;
              const barX = p.renderX - barWidth / 2, barY = p.renderY - 30;
              const hpRatio = Math.max(0, p.hp / p.maxHp);

              ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
              ctx.fillRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);
              ctx.fillStyle = (p.team === 'blue') ? '#22c55e' : '#ef4444';
              ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);

              ctx.font = 'bold 12px sans-serif';
              ctx.textAlign = 'center';
              ctx.fillStyle = (p.team === 'blue') ? '#38bdf8' : '#f87171';
              ctx.fillText(p.username, p.renderX, p.renderY - 36);
            }
            ctx.restore();
          }

          function drawMinimap() {
            const scale = 180 / MAP_SIZE;
            miniCtx.fillStyle = '#111'; miniCtx.fillRect(0, 0, 180, 180);

            if (mapImage.complete && mapImage.naturalWidth !== 0) {
              miniCtx.drawImage(mapImage, 0, 0, 180, 180);
            }

            const me = clientPlayers[socket.id];
            for (let id in clientPlayers) {
              const p = clientPlayers[id];
              if (p.isDead || (me && p.team !== me.team)) continue;
              miniCtx.fillStyle = p.team === 'blue' ? '#00aaff' : '#ff4444';
              miniCtx.beginPath();
              miniCtx.arc(p.renderX * scale, p.renderY * scale, 4, 0, Math.PI * 2);
              miniCtx.fill();
            }
          }
        }
      </script>
    </body>
    </html>
  `);
});

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
    x: spawnX, y: spawnY, dirX: 0, dirY: 0,
    username: socket.username, team: team,
    isAttacking: false, attackProgress: 0, lastAttackTime: 0,
    isDead: false, respawnTime: 0,
    isRecalling: false, recallEndTime: 0,

    hp: 680, maxHp: 680, shield: 0, attackDamage: 68, armor: 38, magicResist: 32, hpRegen: 8,
    wBonusStats: 0,

    qCooldown: 8000, lastQTime: 0,
    wCooldown: 23000, lastWTime: 0,
    eCooldown: 9000, lastETime: 0, isEActive: false, eStartTime: 0, eHitCount: {}, eDamageLevel: 0.25,

    isArmorDebuffed: false, armorDebuffEndTime: 0,
    hasQBuff: false, qBuffEndTime: 0,
    hasSpeedBuff: false, speedBuffEndTime: 0,
    hasShieldPhase: false, shieldPhaseEndTime: 0,
    hasDamageReducePhase: false, damageReducePhaseEndTime: 0
  };

  io.emit('chatMessage', {
    username: '시스템',
    text: `${socket.username}님이 ${team === 'blue' ? '블루팀' : '레드팀'}으로 입장하셨습니다.`,
    isSystem: true, targetMode: 'all'
  });

  socket.on('keyMove', (dir) => {
    const p = players[socket.id];
    if (p && !p.isDead) {
      if (dir.x !== 0 || dir.y !== 0) p.isRecalling = false;
      p.dirX = dir.x;
      p.dirY = dir.y;
    }
  });

  socket.on('useRecall', () => {
    const p = players[socket.id];
    if (p && !p.isDead && !p.isRecalling) {
      p.isRecalling = true;
      p.recallEndTime = Date.now() + 8000;
    }
  });

  socket.on('useQ', () => {
    const p = players[socket.id];
    if (!p || p.isDead) return;
    const now = Date.now();
    if (now - p.lastQTime < p.qCooldown) return;

    p.lastQTime = now; p.hasQBuff = true; p.qBuffEndTime = now + 4500;
    p.hasSpeedBuff = true; p.speedBuffEndTime = now + 3000;
    p.isRecalling = false;
  });

  socket.on('useW', () => {
    const p = players[socket.id];
    if (!p || p.isDead) return;
    const now = Date.now();
    if (now - p.lastWTime < p.wCooldown) return;

    p.lastWTime = now; p.shield = p.maxHp * 0.15;
    p.hasShieldPhase = true; p.shieldPhaseEndTime = now + 750;
    p.hasDamageReducePhase = false; p.damageReducePhaseEndTime = now + 4750;
    p.isRecalling = false;
  });

  socket.on('useE', () => {
    const p = players[socket.id];
    if (!p || p.isDead) return;
    const now = Date.now();
    if (now - p.lastETime < p.eCooldown) return;

    p.lastETime = now; p.isEActive = true; p.eStartTime = now; p.eHitCount = {};
    p.isRecalling = false;
  });

  socket.on('attack', () => {
    const p = players[socket.id];
    const now = Date.now();
    if (p && !p.isDead && !p.isAttacking && !p.isEActive && (now - p.lastAttackTime >= 1000)) {
      p.isAttacking = true; p.attackProgress = 0; p.lastAttackTime = now;
      p.isRecalling = false;

      let damage = p.hasQBuff ? p.attackDamage * 1.5 : p.attackDamage;
      if (p.hasQBuff) p.hasQBuff = false;

      const enemyTeam = p.team === 'blue' ? 'red' : 'blue';
      const enemyNexus = nexuses[enemyTeam];
      const ndx = enemyNexus.x - p.x, ndy = enemyNexus.y - p.y;
      if (Math.sqrt(ndx * ndx + ndy * ndy) <= enemyNexus.radius + 30) {
        enemyNexus.hp = Math.max(0, enemyNexus.hp - damage);
        if (enemyNexus.hp === 0 && !gameOver) {
          gameOver = true;
          winnerTeam = p.team;
        }
      }

      for (let targetId in players) {
        if (targetId === socket.id) continue;
        const target = players[targetId];
        if (target.team === p.team || target.isDead) continue;

        if (Math.sqrt((target.x - p.x)**2 + (target.y - p.y)**2) <= 50) {
          let incomingDamage = Math.max(1, damage - target.armor);
          target.hp = Math.max(0, target.hp - incomingDamage);
          if (target.hp === 0) {
            target.isDead = true;
            target.respawnTime = Date.now() + 10000;
          }
        }
      }
    }
  });

  socket.on('requestRestart', () => {
    if (gameOver) {
      gameOver = false;
      winnerTeam = null;
      nexuses.blue.hp = 4000;
      nexuses.red.hp = 4000;
      for (let id in players) {
        players[id].hp = players[id].maxHp;
        players[id].x = players[id].team === 'blue' ? 100 : 1900;
        players[id].y = players[id].team === 'blue' ? 1900 : 100;
        players[id].isDead = false;
      }
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
  });
});

setInterval(() => {
  const now = Date.now();

  for (let id in players) {
    const p = players[id];

    if (p.isDead) {
      if (now >= p.respawnTime) {
        p.isDead = false; p.hp = p.maxHp;
        p.x = p.team === 'blue' ? 100 : 1900;
        p.y = p.team === 'blue' ? 1900 : 100;
      }
      continue;
    }

    if (p.isRecalling && now >= p.recallEndTime) {
      p.isRecalling = false;
      p.x = p.team === 'blue' ? 100 : 1900;
      p.y = p.team === 'blue' ? 1900 : 100;
    }

    const fountainX = p.team === 'blue' ? 100 : 1900;
    const fountainY = p.team === 'blue' ? 1900 : 100;
    if (Math.sqrt((p.x - fountainX)**2 + (p.y - fountainY)**2) < 200) {
      p.hp = Math.min(p.maxHp, p.hp + (p.maxHp * 0.25 / 60));
    }

    if (p.isEActive) {
      if (now - p.eStartTime >= 3000) p.isEActive = false;
      else {
        for (let tId in players) {
          if (tId === id) continue;
          const target = players[tId];
          if (target.team === p.team || target.isDead) continue;

          if (Math.sqrt((target.x - p.x)**2 + (target.y - p.y)**2) <= 60) {
            target.hp = Math.max(0, target.hp - p.eDamageLevel);
            if (target.hp === 0) {
              target.isDead = true;
              target.respawnTime = Date.now() + 10000;
            }
          }
        }
      }
    }

    if (p.hasQBuff && now >= p.qBuffEndTime) p.hasQBuff = false;
    if (p.hasSpeedBuff && now >= p.speedBuffEndTime) p.hasSpeedBuff = false;

    if (p.isAttacking) {
      p.attackProgress += 0.05;
      if (p.attackProgress >= 1) { p.isAttacking = false; p.attackProgress = 0; }
    }

    let currentSpeed = 0.35;
    if (p.hasSpeedBuff) currentSpeed *= 1.35;
    if (p.isEActive) currentSpeed *= 1.3;

    let moveX = p.dirX, moveY = p.dirY;
    if (moveX !== 0 && moveY !== 0) { moveX *= 0.7071; moveY *= 0.7071; }

    const nextX = p.x + moveX * currentSpeed;
    const nextY = p.y + moveY * currentSpeed;

    if (nextX >= 10 && nextX <= MAP_SIZE - 10 && !isColliding(nextX, p.y)) p.x = nextX;
    if (nextY >= 10 && nextY <= MAP_SIZE - 10 && !isColliding(p.x, nextY)) p.y = nextY;
  }

  io.emit('gameState', { players, nexuses, gameOver, winnerTeam });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`게임 서버 작동 중 (포트: ${PORT})`); });
