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

const FOUNTAIN_RADIUS = 130;
const FOUNTAIN_HEAL_PERCENT_PER_SEC = 0.2;
const FOUNTAIN_POS = {
  blue: { x: 100, y: 1900 },
  red: { x: 1900, y: 100 }
};

const R_RANGE = 190; // 화면(4배 줌 기준)에 보이는 정도의 사거리
const R_HALF_ANGLE = Math.PI / 3; // 바라보는 방향 기준 좌우 60도(총 120도)
const R_IMPACT_DELAY = 900; // ms, 시전 후 실제 데미지가 들어가기까지 시간

const DEV_USERNAME = '박준우';

function refundRCooldown(casterId) {
  const caster = players[casterId];
  if (caster) {
    caster.lastRTime = 0; // 쿨타임 즉시 초기화 (재사용 가능)
  }
}

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
      <title>Summoner's Rift Classic - Custom Garen</title>
      <style>
        * { box-sizing: border-box; }
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #111; color: white; font-family: sans-serif; user-select: none; }
        canvas { display: block; width: 100vw; height: 100vh; background: #000; }
        
        .dead-screen {
          filter: grayscale(100%);
        }

        #respawn-overlay {
          position: absolute; top: 30%; left: 50%; transform: translate(-50%, -50%);
          font-size: 28px; font-weight: bold; color: #ff3333; text-shadow: 2px 2px 4px #000;
          display: none; z-index: 10; pointer-events: none;
        }

        #recall-overlay {
          position: absolute; top: 30%; left: 50%; transform: translate(-50%, -50%);
          font-size: 24px; font-weight: bold; color: #33ccff; text-shadow: 2px 2px 4px #000;
          display: none; z-index: 10; pointer-events: none;
        }

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
        .kick-btn {
          background: #ff2222; color: #fff; border: none; padding: 2px 6px;
          border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: bold;
        }
        .kick-btn:hover { background: #cc0000; }

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
        #chat-header:hover { background: rgba(255, 255, 255, 0.18); }
        #chat-body { display: flex; flex-direction: column; }
        #chat-messages {
          height: 160px; padding: 10px; overflow-y: auto; font-size: 13px;
          display: flex; flex-direction: column; gap: 6px; word-break: break-all;
        }
        #chat-messages::-webkit-scrollbar { width: 4px; }
        #chat-messages::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.3); border-radius: 2px; }
        .chat-msg { color: #eee; line-height: 1.3; }
        .chat-msg .type { font-size: 10px; font-weight: bold; margin-right: 4px; padding: 1px 3px; border-radius: 3px; }
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
          flex: 1; background: transparent; border: none; color: #888; padding: 5px 0; font-size: 11px; font-weight: bold; cursor: pointer;
        }
        .mode-btn.active { color: #fff; background: rgba(255, 255, 255, 0.15); }
        
        #chat-input-container { display: flex; border-top: 1px solid rgba(255, 255, 255, 0.1); }
        #chat-input {
          flex: 1; background: transparent; border: none; padding: 8px 10px;
          color: #fff; font-size: 13px; outline: none;
        }
        #chat-send-btn {
          background: #0088ff; border: none; color: #fff; padding: 0 12px;
          font-size: 12px; font-weight: bold; cursor: pointer;
        }
        #chat-send-btn:hover { background: #0066cc; }

        #minimap-container {
          position: absolute; right: 15px; bottom: 15px; width: 180px; height: 180px;
          background: rgba(0, 0, 0, 0.85); border: 2px solid rgba(255, 255, 255, 0.4);
          border-radius: 6px; z-index: 5; display: none; overflow: hidden;
          box-shadow: 0 4px 15px rgba(0,0,0,0.6);
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
          display: flex; justify-content: center; align-items: center;
        }
        .portrait-box canvas { width: 100%; height: 100%; }

        .skills-container { display: flex; gap: 8px; align-items: center; }
        .skill-slot {
          position: relative; width: 48px; height: 48px; background: #1e2328;
          border: 2px solid #5b4622; border-radius: 6px; display: flex;
          justify-content: center; align-items: center; font-weight: bold; overflow: hidden;
        }
        .skill-key {
          position: absolute; top: 2px; left: 4px; font-size: 10px; color: #c8aa6e; text-shadow: 1px 1px 2px #000; z-index: 2;
        }
        .skill-icon-canvas { width: 100%; height: 100%; display: block; }
        .cooldown-overlay {
          position: absolute; top: 0; left: 0; width: 100%; height: 100%;
          background: rgba(0, 0, 0, 0.75); display: flex; justify-content: center;
          align-items: center; color: #fff; font-size: 18px; font-weight: bold; z-index: 3;
        }

        #dev-panel {
          position: absolute; top: 12px; right: 15px; z-index: 6;
          background: rgba(0, 0, 0, 0.8); border: 1px solid #ff2222; border-radius: 8px;
          padding: 10px; display: none; flex-direction: column; gap: 6px;
          box-shadow: 0 4px 15px rgba(0,0,0,0.6);
        }
        #dev-panel .dev-title {
          font-size: 11px; color: #ff6666; font-weight: bold; text-align: center; margin-bottom: 2px;
        }
        #dev-panel button {
          background: #333; color: #fff; border: 1px solid #666; border-radius: 5px;
          padding: 6px 10px; font-size: 12px; font-weight: bold; cursor: pointer; white-space: nowrap;
        }
        #dev-panel button:hover { background: #444; }
        #dev-panel button.active { background: #cc2222; border-color: #ff4444; }
      </style>
    </head>
    <body>
      <div id="respawn-overlay">부활 대기 중... <span id="respawn-timer">10</span>초</div>
      <div id="recall-overlay">귀환 중... <span id="recall-timer">8</span>초</div>

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

      <div id="dev-panel">
        <div class="dev-title">🛠 개발자 테스트</div>
        <button id="dev-reset-cd-btn" onclick="devResetCooldowns()">쿨타임 초기화</button>
        <button id="dev-speed-btn" onclick="devToggleSpeedBoost()">이속 5배 (OFF)</button>
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
            <div class="cooldown-overlay" id="cd-r" style="display:none;">0</div>
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
        let devSpeedBoostLocal = false;

        function togglePlayerList() {
          isPlayerListExpanded = !isPlayerListExpanded;
          const content = document.getElementById('player-list-content');
          const icon = document.getElementById('player-list-icon');
          content.style.display = isPlayerListExpanded ? 'block' : 'none';
          icon.innerText = isPlayerListExpanded ? '∧' : '∨';
        }

        function toggleChat() {
          isChatExpanded = !isChatExpanded;
          const body = document.getElementById('chat-body');
          const icon = document.getElementById('chat-toggle-icon');
          body.style.display = isChatExpanded ? 'flex' : 'none';
          icon.innerText = isChatExpanded ? '∨' : '∧';
        }

        function kickPlayer(targetId, targetName) {
          if (confirm(\`'\${targetName}' 님을 강퇴하시겠습니까?\`)) {
            socket.emit('kickPlayer', targetId);
          }
        }

        function devResetCooldowns() {
          socket.emit('devResetCooldowns');
        }

        function devToggleSpeedBoost() {
          socket.emit('devToggleSpeedBoost');
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
            
            let nameSpan = document.createElement('span');
            nameSpan.innerText = \`\${p.username} (\${p.team === 'blue' ? '블루' : '레드'})\`;
            item.appendChild(nameSpan);

            if (myUsername === '박준우' && id !== socket.id) {
              let kickBtn = document.createElement('button');
              kickBtn.className = 'kick-btn';
              kickBtn.innerText = '강퇴';
              kickBtn.onclick = () => kickPlayer(id, p.username);
              item.appendChild(kickBtn);
            }

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
          document.getElementById('hud-container').style.display = 'flex';

          if (myUsername === '박준우') {
            document.getElementById('dev-panel').style.display = 'flex';
          }
          
          initGame(myUsername);
        }

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

          const portraitCanvas = document.getElementById('portrait-canvas');
          const portraitCtx = portraitCanvas.getContext('2d');

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
          const keys = {};
          let camX = 1000, camY = 1000;

          drawSkillIcons();

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
            if (e.code === 'Space') {
              e.preventDefault();
              socket.emit('attack');
            }
            if (e.key === 'q' || e.key === 'Q' || e.key === 'ㅂ') {
              e.preventDefault();
              socket.emit('useQ');
            }
            if (e.key === 'w' || e.key === 'W' || e.key === 'ㅈ') {
              e.preventDefault();
              socket.emit('useW');
            }
            if (e.key === 'e' || e.key === 'E' || e.key === 'ㄷ') {
              e.preventDefault();
              socket.emit('useE');
            }
            if (e.key === 'r' || e.key === 'R' || e.key === 'ㄱ') {
              e.preventDefault();
              socket.emit('useR');
            }
            if (e.key === 'b' || e.key === 'B' || e.key === 'ㅠ') {
              e.preventDefault();
              socket.emit('recall');
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
            serverPlayers = data.players; 
            updatePlayerListUI(serverPlayers);

            for (let id in serverPlayers) {
              const sp = serverPlayers[id];
              if (!clientPlayers[id]) {
                clientPlayers[id] = { ...sp, renderX: sp.x, renderY: sp.y, renderAngle: -40 * (Math.PI / 180) };
              } else {
                clientPlayers[id].x = sp.x;
                clientPlayers[id].y = sp.y;
                clientPlayers[id].dirX = sp.dirX;
                clientPlayers[id].dirY = sp.dirY;
                clientPlayers[id].isAttacking = sp.isAttacking;
                clientPlayers[id].attackProgress = sp.attackProgress;
                clientPlayers[id].username = sp.username;
                clientPlayers[id].team = sp.team;
                clientPlayers[id].hp = sp.hp;
                clientPlayers[id].maxHp = sp.maxHp;
                clientPlayers[id].shield = sp.shield;
                clientPlayers[id].isDead = sp.isDead;
                clientPlayers[id].respawnTime = sp.respawnTime;
                
                clientPlayers[id].lastQTime = sp.lastQTime;
                clientPlayers[id].qCooldown = sp.qCooldown;
                clientPlayers[id].lastWTime = sp.lastWTime;
                clientPlayers[id].wCooldown = sp.wCooldown;
                clientPlayers[id].lastETime = sp.lastETime;
                clientPlayers[id].eCooldown = sp.eCooldown;
                clientPlayers[id].lastRTime = sp.lastRTime;
                clientPlayers[id].rCooldown = sp.rCooldown;

                clientPlayers[id].hasQBuff = sp.hasQBuff;
                clientPlayers[id].hasSpeedBuff = sp.hasSpeedBuff;
                clientPlayers[id].hasShieldPhase = sp.hasShieldPhase;
                clientPlayers[id].hasDamageReducePhase = sp.hasDamageReducePhase;
                
                clientPlayers[id].isEActive = sp.isEActive;
                clientPlayers[id].eStartTime = sp.eStartTime;
                clientPlayers[id].isArmorDebuffed = sp.isArmorDebuffed;

                clientPlayers[id].isRecalling = sp.isRecalling;
                clientPlayers[id].recallStartTime = sp.recallStartTime;

                clientPlayers[id].isRMarked = sp.isRMarked;
                clientPlayers[id].rMarkStartTime = sp.rMarkStartTime;
                clientPlayers[id].rImpactTime = sp.rImpactTime;

                clientPlayers[id].devSpeedBoost = sp.devSpeedBoost;
              }
            }

            for (let id in clientPlayers) {
              if (!serverPlayers[id]) delete clientPlayers[id];
            }

            const me = serverPlayers[socket.id];
            if (me) {
              devSpeedBoostLocal = !!me.devSpeedBoost;
              const speedBtn = document.getElementById('dev-speed-btn');
              if (speedBtn) {
                speedBtn.innerText = devSpeedBoostLocal ? '이속 5배 (ON)' : '이속 5배 (OFF)';
                speedBtn.classList.toggle('active', devSpeedBoostLocal);
              }
            }
          });

          socket.on('chatMessage', (data) => {
            appendChatMessage(data.username, data.text, data.team, data.isSystem, data.targetMode);
          });

          socket.on('kicked', (reason) => {
            alert(reason || '방장에 의해 강제 퇴장되었습니다.');
            window.location.reload();
          });

          let lastTime = performance.now();

          function renderLoop(currentTime) {
            const dt = (currentTime - lastTime) / 1000;
            lastTime = currentTime;

            for (let id in clientPlayers) {
              const cp = clientPlayers[id];
              
              let baseSpeed = 36.8;
              if (cp.hasSpeedBuff) baseSpeed *= 1.35;
              if (cp.isEActive) baseSpeed *= 1.3;
              if (cp.devSpeedBoost) baseSpeed *= 5;

              if (!cp.isEActive) {
                if (cp.dirX < 0 && cp.dirY < 0) {
                  cp.renderAngle = -140 * (Math.PI / 180);
                } else if (cp.dirX > 0 && cp.dirY < 0) {
                  cp.renderAngle = -40 * (Math.PI / 180);
                } else if (cp.dirX < 0 && cp.dirY > 0) {
                  cp.renderAngle = 140 * (Math.PI / 180);
                } else if (cp.dirX > 0 && cp.dirY > 0) {
                  cp.renderAngle = 40 * (Math.PI / 180);
                } else if (cp.dirX < 0) {
                  cp.renderAngle = -140 * (Math.PI / 180);
                } else if (cp.dirX > 0) {
                  cp.renderAngle = -40 * (Math.PI / 180);
                } else if (cp.dirY < 0) {
                  cp.renderAngle = -90 * (Math.PI / 180);
                } else if (cp.dirY > 0) {
                  cp.renderAngle = 90 * (Math.PI / 180);
                }
              }

              if (cp.dirX !== 0 || cp.dirY !== 0) {
                let mx = cp.dirX, my = cp.dirY;
                if (mx !== 0 && my !== 0) { mx *= 0.7071; my *= 0.7071; }
                cp.renderX += mx * baseSpeed * dt;
                cp.renderY += my * baseSpeed * dt;
              }

              cp.renderX += (cp.x - cp.renderX) * 0.2;
              cp.renderY += (cp.y - cp.renderY) * 0.2;
            }

            const me = clientPlayers[socket.id];
            if (me && me.isDead) {
              document.body.classList.add('dead-screen');
              respawnOverlay.style.display = 'block';
              const remaining = Math.max(0, Math.ceil((me.respawnTime - Date.now()) / 1000));
              respawnTimer.innerText = remaining;
            } else {
              document.body.classList.remove('dead-screen');
              respawnOverlay.style.display = 'none';
            }

            if (me && me.isRecalling && !me.isDead) {
              recallOverlay.style.display = 'block';
              const remaining = Math.max(0, Math.ceil((8000 - (Date.now() - me.recallStartTime)) / 1000));
              recallTimer.innerText = remaining;
            } else {
              recallOverlay.style.display = 'none';
            }

            drawGame();
            drawMinimap();
            drawHUD();
            requestAnimationFrame(renderLoop);
          }
          requestAnimationFrame(renderLoop);

          function renderSword(ctx, isQBuff = false) {
            if (isQBuff) {
              ctx.shadowColor = '#FFE200';
              ctx.shadowBlur = 10;
            }

            ctx.fillStyle = '#653311';
            ctx.fillRect(3, -0.6, 2.5, 1.2);

            ctx.fillStyle = isQBuff ? '#FFF000' : '#D1AC38';
            ctx.beginPath();
            ctx.arc(6, 0, 1.8, 0, Math.PI * 2);
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(6, -2.5); ctx.lineTo(7, 0); ctx.lineTo(6, 2.5); ctx.lineTo(5, 0);
            ctx.fill();

            ctx.fillStyle = '#1A1A1A';
            ctx.fillRect(7.2, -1, 7, 2);

            ctx.fillStyle = isQBuff ? '#FFFF88' : '#A0A0A0';
            ctx.beginPath();
            ctx.moveTo(7.2, -1.3);
            ctx.lineTo(13.5, -1.3);
            ctx.lineTo(16, 0);
            ctx.lineTo(13.5, 1.3);
            ctx.lineTo(7.2, 1.3);
            ctx.fill();

            ctx.fillStyle = '#1A1A1A';
            ctx.fillRect(8, -0.7, 5.5, 1.4);

            ctx.fillStyle = '#D1AC38';
            ctx.beginPath();
            ctx.arc(8.5, 0, 0.5, 0, Math.PI * 2);
            ctx.fill();
          }

          // R스킬 전용: 오직 황금색 계열로만 이루어진 검 (다른 색 없음)
          function renderGoldenSword(ctx) {
            ctx.shadowColor = '#FFE200';
            ctx.shadowBlur = 10;

            ctx.fillStyle = '#B8860B';
            ctx.fillRect(3, -0.6, 2.5, 1.2);

            ctx.fillStyle = '#FFD700';
            ctx.beginPath();
            ctx.arc(6, 0, 1.8, 0, Math.PI * 2);
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(6, -2.5); ctx.lineTo(7, 0); ctx.lineTo(6, 2.5); ctx.lineTo(5, 0);
            ctx.fill();

            ctx.fillStyle = '#FFC107';
            ctx.fillRect(7.2, -1, 7, 2);

            ctx.fillStyle = '#FFF176';
            ctx.beginPath();
            ctx.moveTo(7.2, -1.3);
            ctx.lineTo(13.5, -1.3);
            ctx.lineTo(16, 0);
            ctx.lineTo(13.5, 1.3);
            ctx.lineTo(7.2, 1.3);
            ctx.fill();

            ctx.fillStyle = '#FFFDE7';
            ctx.fillRect(8, -0.7, 5.5, 1.4);

            ctx.fillStyle = '#FFD700';
            ctx.beginPath();
            ctx.arc(8.5, 0, 0.5, 0, Math.PI * 2);
            ctx.fill();
          }

          function drawSimpleGaren(ctx, p) {
            if (p.isDead) return;

            if (p.hasShieldPhase || p.hasDamageReducePhase) {
              ctx.save();
              ctx.shadowColor = '#FFD700';
              ctx.shadowBlur = 15;
              ctx.strokeStyle = 'rgba(255, 215, 0, 0.9)';
              ctx.lineWidth = 2.5;
              ctx.beginPath();
              ctx.arc(0, 0, 11, 0, Math.PI * 2);
              ctx.stroke();
              ctx.restore();
            }

            ctx.fillStyle = '#FFE268';
            ctx.beginPath();
            ctx.arc(0, 0, 5, 0, Math.PI * 2);
            ctx.fill();

            if (p.isEActive) {
              // E스킬 회전 연산
              const elapsed = Date.now() - p.eStartTime;
              const spins = (elapsed / 3000) * (7 * Math.PI * 2);
              
              ctx.save();
              ctx.rotate(spins);

              // 검 길이에만 맞춰 남아있는 황금빛 궤적/잔상 (호 형태)
              ctx.save();
              ctx.shadowColor = '#FFE200';
              ctx.shadowBlur = 10;
              ctx.strokeStyle = 'rgba(255, 226, 104, 0.6)';
              ctx.lineWidth = 4;
              ctx.beginPath();
              // 검의 날 부분 시작점(7.2)부터 끝점(16)까지의 범위에 잔상 궤적 형성
              ctx.arc(0, 0, 12, -0.8, 0.2);
              ctx.stroke();
              ctx.restore();

              // 실제 칼 그리기
              renderSword(ctx, true);

              ctx.restore();
            } else {
              let swingAngle = 0;
              if (p.isAttacking) {
                swingAngle = -1.2 + (p.attackProgress * 2.4);
              }

              ctx.save();
              ctx.rotate(swingAngle);

              if (p.isAttacking) {
                ctx.fillStyle = p.hasQBuff ? 'rgba(255, 230, 0, 0.7)' : 'rgba(255, 226, 104, 0.45)';
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.arc(0, 0, 18, -1.2, -1.2 + (p.attackProgress * 2.4));
                ctx.fill();
              }

              renderSword(ctx, p.hasQBuff);
              ctx.restore();
            }
          }

          function drawRMarker(ctx, p) {
            if (!p.isRMarked) return;

            const now = Date.now();
            const totalDuration = Math.max(1, p.rImpactTime - p.rMarkStartTime);
            let progress = (now - p.rMarkStartTime) / totalDuration;
            progress = Math.max(0, Math.min(1, progress));

            const swordScale = 3.0;
            const startHeight = 150; // 아주 높은 곳에서 시작
            const endHeight = 60;    // 머리 위, 캐릭터와 닿지 않는 높이에서 정지
            const hoverHeight = startHeight + (endHeight - startHeight) * progress;

            // 바닥의 황금빛 원형 글로우
            ctx.save();
            ctx.translate(p.renderX, p.renderY);
            const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 12);
            grad.addColorStop(0, 'rgba(255, 246, 190, 0.95)');
            grad.addColorStop(0.45, 'rgba(255, 215, 80, 0.65)');
            grad.addColorStop(1, 'rgba(255, 200, 40, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(0, 0, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // 머리 위에서 떨어지는 황금빛 검 (캐릭터와 닿지 않음, 오직 황금색만 사용)
            ctx.save();
            ctx.translate(p.renderX, p.renderY - hoverHeight);
            ctx.scale(swordScale, swordScale);
            ctx.rotate(100 * Math.PI / 180);

            ctx.shadowColor = '#FFF7B0';
            ctx.shadowBlur = 22;
            renderGoldenSword(ctx);
            ctx.shadowBlur = 34;
            renderGoldenSword(ctx);
            ctx.restore();
          }

          function drawGarenPortrait(ctx) {
            ctx.clearRect(0, 0, 64, 64);
            ctx.fillStyle = '#0a0f14';
            ctx.fillRect(0, 0, 64, 64);

            ctx.save();
            ctx.translate(26, 38);
            
            ctx.fillStyle = '#FFE268';
            ctx.beginPath();
            ctx.arc(0, 0, 10, 0, Math.PI * 2);
            ctx.fill();

            ctx.save();
            ctx.rotate(-60 * (Math.PI / 180));

            ctx.fillStyle = '#653311';
            ctx.fillRect(6, -1.2, 5, 2.4);

            ctx.fillStyle = '#D1AC38';
            ctx.beginPath();
            ctx.arc(11, 0, 3.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#A0A0A0';
            ctx.beginPath();
            ctx.moveTo(13, -2.5);
            ctx.lineTo(26, -2.5);
            ctx.lineTo(31, 0);
            ctx.lineTo(26, 2.5);
            ctx.lineTo(13, 2.5);
            ctx.fill();

            ctx.restore();
            ctx.restore();
          }

          function drawSkillIcons() {
            const qCanvas = document.getElementById('icon-q');
            const qCtx = qCanvas.getContext('2d');
            qCtx.fillStyle = '#1c1917'; qCtx.fillRect(0, 0, 48, 48);
            qCtx.save();
            qCtx.translate(16, 32);
            qCtx.rotate(-45 * Math.PI / 180);
            qCtx.scale(1.8, 1.8);
            renderSword(qCtx, true);
            qCtx.restore();

            const wCanvas = document.getElementById('icon-w');
            const wCtx = wCanvas.getContext('2d');
            wCtx.fillStyle = '#064e3b'; wCtx.fillRect(0, 0, 48, 48);
            wCtx.save();
            wCtx.translate(24, 24);
            wCtx.shadowColor = '#FFD700'; wCtx.shadowBlur = 10;
            wCtx.strokeStyle = '#FFD700'; wCtx.lineWidth = 3;
            wCtx.beginPath(); wCtx.arc(0, 0, 14, 0, Math.PI * 2); wCtx.stroke();
            wCtx.fillStyle = 'rgba(255, 215, 0, 0.3)'; wCtx.fill();
            wCtx.restore();

            const eCanvas = document.getElementById('icon-e');
            const eCtx = eCanvas.getContext('2d');
            eCtx.fillStyle = '#7f1d1d'; eCtx.fillRect(0, 0, 48, 48);
            eCtx.strokeStyle = '#fca5a5'; eCtx.lineWidth = 3;
            eCtx.beginPath(); eCtx.arc(24, 24, 12, 0, Math.PI * 1.5); eCtx.stroke();

            const rCanvas = document.getElementById('icon-r');
            const rCtx = rCanvas.getContext('2d');
            rCtx.fillStyle = '#581c87'; rCtx.fillRect(0, 0, 48, 48);
            rCtx.fillStyle = '#c084fc';
            rCtx.fillRect(22, 10, 4, 28);
          }

          function drawHUD() {
            const me = clientPlayers[socket.id];
            if (!me) return;

            drawGarenPortrait(portraitCtx);

            const now = Date.now();

            const qCdBox = document.getElementById('cd-q');
            const qRemaining = Math.max(0, Math.ceil(((me.lastQTime + me.qCooldown) - now) / 1000));
            qCdBox.style.display = qRemaining > 0 ? 'flex' : 'none';
            if (qRemaining > 0) qCdBox.innerText = qRemaining;

            const wCdBox = document.getElementById('cd-w');
            const wRemaining = Math.max(0, Math.ceil(((me.lastWTime + me.wCooldown) - now) / 1000));
            wCdBox.style.display = wRemaining > 0 ? 'flex' : 'none';
            if (wRemaining > 0) wCdBox.innerText = wRemaining;

            const eCdBox = document.getElementById('cd-e');
            const eRemaining = Math.max(0, Math.ceil(((me.lastETime + me.eCooldown) - now) / 1000));
            eCdBox.style.display = eRemaining > 0 ? 'flex' : 'none';
            if (eRemaining > 0) eCdBox.innerText = eRemaining;

            const rCdBox = document.getElementById('cd-r');
            const rRemaining = Math.max(0, Math.ceil(((me.lastRTime + me.rCooldown) - now) / 1000));
            rCdBox.style.display = rRemaining > 0 ? 'flex' : 'none';
            if (rRemaining > 0) rCdBox.innerText = rRemaining;
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
              ctx.scale(4.0, 4.0); ctx.translate(-camX, -camY);
            }

            if (mapImage.complete && mapImage.naturalWidth !== 0) {
              ctx.drawImage(mapImage, 0, 0, MAP_SIZE, MAP_SIZE);
            }

            for (let id in clientPlayers) {
              const p = clientPlayers[id];
              if (p.isDead) continue;

              ctx.save();
              ctx.translate(p.renderX, p.renderY);
              
              ctx.scale(1.3, 1.3);
              if (!p.isEActive) ctx.rotate(p.renderAngle);

              drawSimpleGaren(ctx, p);

              ctx.restore();

              drawRMarker(ctx, p);

              const barWidth = 14;
              const barHeight = 2;
              const barX = p.renderX - barWidth / 2;
              const barY = p.renderY - 10;
              const hpRatio = Math.max(0, p.hp / p.maxHp);
              const shieldRatio = Math.min(1, p.shield / p.maxHp);

              ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
              ctx.fillRect(barX - 0.5, barY - 0.5, barWidth + 1, barHeight + 1);

              ctx.fillStyle = (p.team === 'blue') ? '#22c55e' : '#ef4444';
              ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);

              if (p.shield > 0) {
                ctx.fillStyle = '#FFFFCC';
                const hpWidth = barWidth * hpRatio;
                ctx.fillRect(barX + hpWidth, barY, Math.min(barWidth - hpWidth, barWidth * shieldRatio), barHeight);
              }

              // 방깎 이펙트 표시
              if (p.isArmorDebuffed) {
                ctx.fillStyle = '#A855F7';
                ctx.font = 'bold 3px sans-serif';
                ctx.fillText('🛡️-25%', p.renderX, p.renderY + 8);
              }

              ctx.font = 'bold 4.5px sans-serif';
              ctx.textAlign = 'center';
              ctx.fillStyle = (p.team === 'blue') ? '#38bdf8' : '#f87171';
              
              ctx.strokeStyle = '#000000';
              ctx.lineWidth = 0.8;
              ctx.strokeText(p.username, p.renderX, p.renderY - 13);
              ctx.fillText(p.username, p.renderX, p.renderY - 13);
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

            const me = clientPlayers[socket.id];

            for (let id in clientPlayers) {
              const p = clientPlayers[id];

              if (p.isDead || (me && p.team !== me.team)) continue;

              const mx = p.renderX * scale;
              const my = p.renderY * scale;

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
    facingX: team === 'blue' ? 1 : -1,
    facingY: team === 'blue' ? -1 : 1,
    username: socket.username,
    team: team,
    isAttacking: false,
    attackProgress: 0,
    lastAttackTime: 0,

    isDead: false,
    respawnTime: 0,

    hp: 680,
    maxHp: 680,
    shield: 0,
    attackDamage: 68,
    armor: 38,
    magicResist: 32,
    hpRegen: 8,

    wBonusStats: 0,

    qCooldown: 8000,
    lastQTime: 0,

    wCooldown: 23000,
    lastWTime: 0,

    eCooldown: 9000,
    lastETime: 0,
    isEActive: false,
    eStartTime: 0,
    eHitCount: {},
    eDamageLevel: 3.8,

    rCooldown: 140000,
    lastRTime: 0,
    isRMarked: false,
    rMarkStartTime: 0,
    rImpactTime: 0,
    rCasterId: null,
    rCasterUsername: null,

    isRecalling: false,
    recallStartTime: 0,

    isArmorDebuffed: false,
    armorDebuffEndTime: 0,

    hasQBuff: false,
    qBuffEndTime: 0,
    hasSpeedBuff: false,
    speedBuffEndTime: 0,

    hasShieldPhase: false,
    shieldPhaseEndTime: 0,
    hasDamageReducePhase: false,
    damageReducePhaseEndTime: 0,

    devSpeedBoost: false
  };

  const teamName = team === 'blue' ? '블루팀' : '레드팀';
  io.emit('chatMessage', {
    username: '시스템',
    text: `${socket.username}님이 ${teamName}으로 입장하셨습니다.`,
    isSystem: true,
    targetMode: 'all'
  });

  socket.on('keyMove', (dir) => {
    const p = players[socket.id];
    if (!p || p.isDead) return;

    if (p.isRecalling) {
      // 실제 이동 입력이 들어오면 귀환 취소, 그 외(키를 뗀 경우 등)는 무시하고 귀환 유지
      if (dir.x !== 0 || dir.y !== 0) {
        p.isRecalling = false;
        p.dirX = dir.x;
        p.dirY = dir.y;
        p.facingX = dir.x;
        p.facingY = dir.y;
      }
      return;
    }

    p.dirX = dir.x;
    p.dirY = dir.y;
    if (dir.x !== 0 || dir.y !== 0) {
      p.facingX = dir.x;
      p.facingY = dir.y;
    }
  });

  socket.on('useQ', () => {
    const p = players[socket.id];
    if (!p || p.isDead) return;

    const now = Date.now();
    if (now - p.lastQTime < p.qCooldown) return;

    p.lastQTime = now;
    p.hasQBuff = true;
    p.qBuffEndTime = now + 4500;

    const randomDuration = (1 + Math.random() * 2.6) * 1000;
    p.hasSpeedBuff = true;
    p.speedBuffEndTime = now + randomDuration;
  });

  socket.on('useW', () => {
    const p = players[socket.id];
    if (!p || p.isDead) return;

    const now = Date.now();
    if (now - p.lastWTime < p.wCooldown) return;

    p.lastWTime = now;

    p.shield = p.maxHp * 0.15;
    p.hasShieldPhase = true;
    p.shieldPhaseEndTime = now + 750;

    p.hasDamageReducePhase = false;
    p.damageReducePhaseEndTime = now + 4750;
  });

  socket.on('useE', () => {
    const p = players[socket.id];
    if (!p || p.isDead) return;

    const now = Date.now();
    if (now - p.lastETime < p.eCooldown) return;

    p.lastETime = now;
    p.isEActive = true;
    p.eStartTime = now;
    p.eHitCount = {};
  });

  socket.on('useR', () => {
    const caster = players[socket.id];
    if (!caster || caster.isDead) return;

    const now = Date.now();
    if (now - caster.lastRTime < caster.rCooldown) return;

    let fx = caster.facingX, fy = caster.facingY;
    const fLen = Math.sqrt(fx * fx + fy * fy) || 1;
    fx /= fLen; fy /= fLen;

    let candidates = [];
    for (let tid in players) {
      if (tid === socket.id) continue;
      const target = players[tid];
      if (target.team === caster.team || target.isDead) continue;

      const dx = target.x - caster.x;
      const dy = target.y - caster.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist === 0 || dist > R_RANGE) continue;

      const ndx = dx / dist, ndy = dy / dist;
      const dot = Math.max(-1, Math.min(1, fx * ndx + fy * ndy));
      const angle = Math.acos(dot);

      if (angle <= R_HALF_ANGLE) {
        candidates.push({ id: tid, target, dist });
      }
    }

    // 지정할 대상이 없으면 스킬이 나가지 않은 것으로 취급 (쿨타임 소모 없음)
    if (candidates.length === 0) return;

    candidates.sort((a, b) => a.dist - b.dist);
    const chosen = candidates[0].target;

    caster.lastRTime = now;

    chosen.isRMarked = true;
    chosen.rMarkStartTime = now;
    chosen.rImpactTime = now + R_IMPACT_DELAY;
    chosen.rCasterId = socket.id;
    chosen.rCasterUsername = caster.username;
  });

  socket.on('recall', () => {
    const p = players[socket.id];
    if (!p || p.isDead || p.isRecalling) return;

    p.isRecalling = true;
    p.recallStartTime = Date.now();
  });

  socket.on('devResetCooldowns', () => {
    const p = players[socket.id];
    if (!p || socket.username !== DEV_USERNAME) return;

    p.lastQTime = 0;
    p.lastWTime = 0;
    p.lastETime = 0;
    p.lastRTime = 0;
  });

  socket.on('devToggleSpeedBoost', () => {
    const p = players[socket.id];
    if (!p || socket.username !== DEV_USERNAME) return;

    p.devSpeedBoost = !p.devSpeedBoost;
  });

  socket.on('attack', () => {
    const p = players[socket.id];
    const now = Date.now();
    if (p && !p.isDead && !p.isAttacking && !p.isEActive && (now - p.lastAttackTime >= 1000)) {
      p.isAttacking = true;
      p.attackProgress = 0;
      p.lastAttackTime = now;

      let damage = p.attackDamage;
      if (p.hasQBuff) {
        damage *= 1.5;
        p.hasQBuff = false;
      }

      for (let targetId in players) {
        if (targetId === socket.id) continue;
        const target = players[targetId];
        if (target.team === p.team || target.isDead) continue;

        const dx = target.x - p.x;
        const dy = target.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= 35) {
          let totalArmor = target.armor + target.wBonusStats;
          if (target.isArmorDebuffed) totalArmor *= 0.75;

          let incomingDamage = Math.max(1, damage - totalArmor);

          if (target.hasDamageReducePhase) incomingDamage *= 0.7;

          if (target.shield > 0) {
            if (target.shield >= incomingDamage) {
              target.shield -= incomingDamage;
              incomingDamage = 0;
            } else {
              incomingDamage -= target.shield;
              target.shield = 0;
            }
          }

          if (incomingDamage > 0) {
            target.hp = Math.max(0, target.hp - incomingDamage);

            // 공격을 맞으면 귀환 취소
            if (target.isRecalling) {
              target.isRecalling = false;
            }
            
            if (target.hp === 0) {
              target.isDead = true;
              target.respawnTime = Date.now() + 10000;
              target.hasQBuff = false;
              target.hasSpeedBuff = false;
              target.hasShieldPhase = false;
              target.hasDamageReducePhase = false;
              target.isEActive = false;
              target.shield = 0;

              if (p.wBonusStats < 30) {
                p.wBonusStats = Math.min(30, p.wBonusStats + 0.2);
              }

              io.emit('chatMessage', {
                username: '시스템',
                text: `${p.username}님이 ${target.username}님을 처치했습니다!`,
                isSystem: true,
                targetMode: 'all'
              });
            }
          }
        }
      }
    }
  });

  socket.on('kickPlayer', (targetSocketId) => {
    if (socket.username === '박준우') {
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('kicked', '방장에 의해 강제 퇴장당했습니다.');
        targetSocket.disconnect(true);
      }
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
    const dc = players[socket.id];
    if (dc) {
      // 지정 대상이 접속을 끊으면 스킬을 못 쓴 것과 같으므로 시전자 쿨타임 환급
      if (dc.isRMarked) {
        refundRCooldown(dc.rCasterId);
      }

      io.emit('chatMessage', {
        username: '시스템',
        text: `${dc.username}님이 퇴장하셨습니다.`,
        isSystem: true,
        targetMode: 'all'
      });
      delete players[socket.id];
    }
  });
});

setInterval(() => {
  const now = Date.now();

  for (let id in players) {
    const p = players[id];

    if (p.isDead) {
      // 궁극기 판정 전에 다른 이유로 대상이 죽으면(스킬이 실패한 것으로 취급) 시전자 쿨타임 환급
      if (p.isRMarked) {
        refundRCooldown(p.rCasterId);
        p.isRMarked = false;
        p.rCasterId = null;
        p.rCasterUsername = null;
      }

      if (now >= p.respawnTime) {
        p.isDead = false;
        p.hp = p.maxHp;
        p.x = p.team === 'blue' ? 100 : 1900;
        p.y = p.team === 'blue' ? 1900 : 100;
        p.dirX = 0;
        p.dirY = 0;

        // 부활 시 모든 스킬 쿨타임 초기화
        p.lastQTime = 0;
        p.lastWTime = 0;
        p.lastETime = 0;
        p.lastRTime = 0;
      }
      continue;
    }

    if (p.isArmorDebuffed && now >= p.armorDebuffEndTime) {
      p.isArmorDebuffed = false;
    }

    if (p.isRecalling) {
      if (now - p.recallStartTime >= 8000) {
        p.isRecalling = false;
        p.x = p.team === 'blue' ? 100 : 1900;
        p.y = p.team === 'blue' ? 1900 : 100;
        p.dirX = 0;
        p.dirY = 0;
      }
    }

    if (p.isEActive) {
      if (now - p.eStartTime >= 3000) {
        p.isEActive = false;
      } else {
        let targetsInRange = [];
        for (let tId in players) {
          if (tId === id) continue;
          const target = players[tId];
          if (target.team === p.team || target.isDead) continue;

          const dx = target.x - p.x;
          const dy = target.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist <= 40) {
            targetsInRange.push({ id: tId, target, dist });
          }
        }

        if (targetsInRange.length > 0) {
          targetsInRange.sort((a, b) => a.dist - b.dist);
          const closestTargetId = targetsInRange[0].id;

          targetsInRange.forEach(({ id: tId, target }) => {
            let baseDamage = p.eDamageLevel;
            
            if (tId === closestTargetId) {
              baseDamage *= 1.25;
            }

            let totalArmor = target.armor + target.wBonusStats;
            if (target.isArmorDebuffed) totalArmor *= 0.75;

            let incomingDamage = Math.max(0.5, baseDamage - (totalArmor * 0.1));

            if (target.hasDamageReducePhase) incomingDamage *= 0.7;

            if (target.shield > 0) {
              if (target.shield >= incomingDamage) {
                target.shield -= incomingDamage;
                incomingDamage = 0;
              } else {
                incomingDamage -= target.shield;
                target.shield = 0;
              }
            }

            if (incomingDamage > 0) {
              target.hp = Math.max(0, target.hp - incomingDamage);

              // 공격을 맞으면 귀환 취소
              if (target.isRecalling) {
                target.isRecalling = false;
              }
              
              p.eHitCount[tId] = (p.eHitCount[tId] || 0) + 1;
              
              if (p.eHitCount[tId] >= 6) {
                target.isArmorDebuffed = true;
                target.armorDebuffEndTime = now + 6000;
              }

              if (target.hp === 0) {
                target.isDead = true;
                target.respawnTime = Date.now() + 10000;
                target.isEActive = false;

                if (p.wBonusStats < 30) {
                  p.wBonusStats = Math.min(30, p.wBonusStats + 0.2);
                }

                io.emit('chatMessage', {
                  username: '시스템',
                  text: `${p.username}님이 ${target.username}님을 처치했습니다!`,
                  isSystem: true,
                  targetMode: 'all'
                });
              }
            }
          });
        }
      }
    }

    // R스킬(궁극기) 판정 시각(rImpactTime) 도달 시 데미지 적용
    if (p.isRMarked && now >= p.rImpactTime) {
      p.isRMarked = false;

      const hpPercent = p.hp / p.maxHp;

      if (hpPercent <= 0.3) {
        p.hp = 0;
      } else {
        p.hp = Math.max(0, p.hp - p.maxHp * 0.15);
      }

      if (p.isRecalling) {
        p.isRecalling = false;
      }

      if (p.hp === 0) {
        p.isDead = true;
        p.respawnTime = now + 10000;
        p.hasQBuff = false;
        p.hasSpeedBuff = false;
        p.hasShieldPhase = false;
        p.hasDamageReducePhase = false;
        p.isEActive = false;
        p.shield = 0;

        const caster = players[p.rCasterId];
        if (caster && caster.wBonusStats < 30) {
          caster.wBonusStats = Math.min(30, caster.wBonusStats + 0.2);
        }

        io.emit('chatMessage', {
          username: '시스템',
          text: `${p.rCasterUsername || '알 수 없음'}님이 궁극기로 ${p.username}님을 처치했습니다!`,
          isSystem: true,
          targetMode: 'all'
        });

        p.rCasterId = null;
        p.rCasterUsername = null;
        continue; // 사망 처리 이후 이번 틱의 나머지 로직(회복, 이동 등) 건너뛰기
      }

      p.rCasterId = null;
      p.rCasterUsername = null;
    }

    if (p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, p.hp + (p.hpRegen / 60));
    }

    // 우물(스폰) 반경 내에 있으면 초당 최대체력의 20% 추가 회복
    const fountain = FOUNTAIN_POS[p.team];
    if (fountain) {
      const fdx = p.x - fountain.x;
      const fdy = p.y - fountain.y;
      const fdist = Math.sqrt(fdx * fdx + fdy * fdy);
      if (fdist <= FOUNTAIN_RADIUS && p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + (p.maxHp * FOUNTAIN_HEAL_PERCENT_PER_SEC) / 60);
      }
    }

    if (p.hasQBuff && now >= p.qBuffEndTime) p.hasQBuff = false;
    if (p.hasSpeedBuff && now >= p.speedBuffEndTime) p.hasSpeedBuff = false;

    if (p.hasShieldPhase) {
      if (now >= p.shieldPhaseEndTime) {
        p.hasShieldPhase = false;
        p.shield = 0;
        p.hasDamageReducePhase = true;
      }
    }
    
    if (p.hasDamageReducePhase && now >= p.damageReducePhaseEndTime) {
      p.hasDamageReducePhase = false;
    }

    if (p.isAttacking) {
      p.attackProgress += 0.05;
      if (p.attackProgress >= 1) {
        p.isAttacking = false;
        p.attackProgress = 0;
      }
    }

    if (!p.isRecalling) {
      let currentSpeed = 0.6133;
      if (p.hasSpeedBuff) currentSpeed *= 1.35;
      if (p.isEActive) currentSpeed *= 1.3;
      if (p.devSpeedBoost) currentSpeed *= 5;

      let moveX = p.dirX, moveY = p.dirY;
      if (moveX !== 0 && moveY !== 0) {
        moveX *= 0.7071; moveY *= 0.7071;
      }

      const nextX = p.x + moveX * currentSpeed;
      const nextY = p.y + moveY * currentSpeed;

      if (nextX >= 10 && nextX <= MAP_SIZE - 10 && !isColliding(nextX, p.y)) p.x = nextX;
      if (nextY >= 10 && nextY <= MAP_SIZE - 10 && !isColliding(p.x, nextY)) p.y = nextY;
    }
  }
  io.emit('gameState', { players });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`게임 서버 작동 중 (포트: ${PORT})`); });
