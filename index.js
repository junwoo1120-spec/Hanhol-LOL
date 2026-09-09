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

let nexuses = {
  blue: { x: 225, y: 1766, radius: 35, hp: 4000, maxHp: 4000 },
  red: { x: 1786, y: 223, radius: 35, hp: 4000, maxHp: 4000 }
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
      <title>Summoner's Rift Classic - Custom Garen</title>
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
          font-size: 24px; font-weight: bold; color: #00ccff; text-shadow: 2px 2px 4px #000;
          display: none; z-index: 10; pointer-events: none; text-align: center;
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
      </style>
    </head>
    <body>
      <div id="respawn-overlay">부활 대기 중... <span id="respawn-timer">10</span>초</div>
      <div id="recall-overlay">귀환 중... <span id="recall-timer">8.0</span>초</div>

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
          if (confirm("'" + targetName + "' 님을 강퇴하시겠습니까?")) {
            socket.emit('kickPlayer', targetId);
          }
        }

        function updatePlayerListUI(playersData) {
          const countSpan = document.getElementById('player-count');
          const contentDiv = document.getElementById('player-list-content');

          const entries = Object.entries(playersData);
          countSpan.innerText = entries.length;

          contentDiv.innerHTML = '';
          entries.forEach(([id, p]) => {
            const item = document.createElement('div');
            item.className = 'player-item ' + p.team;
            
            let nameSpan = document.createElement('span');
            nameSpan.innerText = p.username + ' (' + (p.team === 'blue' ? '블루' : '레드') + ')';
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
            msgDiv.innerHTML = '<span class="system">' + text + '</span>';
          } else {
            const teamClass = team === 'blue' ? 'blue' : (team === 'red' ? 'red' : '');
            const typeLabel = targetMode === 'team' ? '<span class="type team">팀</span>' : '<span class="type all">전체</span>';
            msgDiv.innerHTML = typeLabel + '<span class="sender ' + teamClass + '">' + sender + ':</span> ' + text;
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
          let clientNexuses = { blue: { hp: 4000, maxHp: 4000 }, red: { hp: 4000, maxHp: 4000 } };
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
            if (e.key === 'b' || e.key === 'B' || e.key === 'ㅠ') {
              e.preventDefault();
              socket.emit('startRecall');
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
            if (data.nexuses) clientNexuses = data.nexuses;
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

                clientPlayers[id].hasQBuff = sp.hasQBuff;
                clientPlayers[id].hasSpeedBuff = sp.hasSpeedBuff;
                clientPlayers[id].hasShieldPhase = sp.hasShieldPhase;
                clientPlayers[id].hasDamageReducePhase = sp.hasDamageReducePhase;
                
                clientPlayers[id].isEActive = sp.isEActive;
                clientPlayers[id].eStartTime = sp.eStartTime;
                clientPlayers[id].isArmorDebuffed = sp.isArmorDebuffed;

                clientPlayers[id].isRecalling = sp.isRecalling;
                clientPlayers[id].recallEndTime = sp.recallEndTime;
              }
            }

            for (let id in clientPlayers) {
              if (!serverPlayers[id]) delete clientPlayers[id];
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
              
              // === 이동 속도 원래대로 복구 (기본: 180, 버프: 245) ===
              const baseSpeed = cp.hasSpeedBuff ? 245 : 180; 

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
              const remaining = Math.max(0, ((me.recallEndTime - Date.now()) / 1000)).toFixed(1);
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

          function drawSimpleGaren(ctx, p) {
            if (p.isDead) return;

            if (p.isRecalling) {
              ctx.save();
              ctx.strokeStyle = '#00e5ff';
              ctx.lineWidth = 2;
              ctx.shadowColor = '#00e5ff';
              ctx.shadowBlur = 12;
              ctx.beginPath();
              ctx.arc(0, 0, 16, 0, Math.PI * 2);
              ctx.stroke();
              ctx.restore();
            }

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
              const elapsed = Date.now() - p.eStartTime;
              const spins = (elapsed / 3000) * (7 * Math.PI * 2);
              
              ctx.save();
              ctx.rotate(spins);

              ctx.fillStyle = 'rgba(255, 226, 104, 0.35)';
              ctx.shadowColor = '#FFE200';
              ctx.shadowBlur = 12;
              ctx.beginPath();
              ctx.arc(0, 0, 22, 0, Math.PI * 2);
              ctx.fill();

              ctx.save();
              ctx.translate(0, 0);
              renderSword(ctx, true);
              ctx.restore();

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
            if (qRemaining > 0) {
              qCdBox.style.display = 'flex';
              qCdBox.innerText = qRemaining;
            } else {
              qCdBox.style.display = 'none';
            }

            const wCdBox = document.getElementById('cd-w');
            const wRemaining = Math.max(0, Math.ceil(((me.lastWTime + me.wCooldown) - now) / 1000));
            if (wRemaining > 0) {
              wCdBox.style.display = 'flex';
              wCdBox.innerText = wRemaining;
            } else {
              wCdBox.style.display = 'none';
            }

            const eCdBox = document.getElementById('cd-e');
            const eRemaining = Math.max(0, Math.ceil(((me.lastETime + me.eCooldown) - now) / 1000));
            if (eRemaining > 0) {
              eCdBox.style.display = 'flex';
              eCdBox.innerText = eRemaining;
            } else {
              eCdBox.style.display = 'none';
            }
          }

          function drawGame() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const me = clientPlayers[socket.id];
            if (me) {
              camX = me.renderX;
              camY = me.renderY;
            }

            // === 시야 범위(줌 레벨) 원래대로 복구 (기본: 1.0) ===
            const scale = (canvas.height / 500) * 1.0;

            ctx.save();
            ctx.scale(scale, scale);
            ctx.translate((canvas.width / scale) / 2 - camX, (canvas.height / scale) / 2 - camY);

            if (mapImage.complete) {
              ctx.drawImage(mapImage, 0, 0, MAP_SIZE, MAP_SIZE);
            }

            const nexusPositions = [
              { team: 'blue', x: 225, y: 1766 },
              { team: 'red', x: 1786, y: 223 }
            ];

            nexusPositions.forEach(n => {
              const nexusData = clientNexuses[n.team];
              if (nexusData) {
                const barWidth = 40;
                const barHeight = 5;
                const barY = n.y - 45;

                ctx.fillStyle = '#000';
                ctx.fillRect(n.x - barWidth / 2 - 1, barY - 1, barWidth + 2, barHeight + 2);

                const hpPercent = Math.max(0, nexusData.hp / nexusData.maxHp);
                ctx.fillStyle = n.team === 'blue' ? '#00aaff' : '#ff4444';
                ctx.fillRect(n.x - barWidth / 2, barY, barWidth * hpPercent, barHeight);

                ctx.font = 'bold 4px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillStyle = '#ffffff';
                ctx.fillText(nexusData.hp + ' / ' + nexusData.maxHp, n.x, barY - 2);
              }
            });

            for (let id in clientPlayers) {
              const p = clientPlayers[id];

              ctx.save();
              ctx.translate(p.renderX, p.renderY);

              ctx.save();
              ctx.rotate(p.renderAngle);
              drawSimpleGaren(ctx, p);
              ctx.restore();

              if (!p.isDead) {
                const barWidth = 24;
                const barHeight = 3;
                const barY = -12;

                ctx.fillStyle = '#000';
                ctx.fillRect(-barWidth / 2 - 1, barY - 1, barWidth + 2, barHeight + 2);

                const hpPercent = Math.max(0, p.hp / p.maxHp);
                ctx.fillStyle = p.team === 'blue' ? '#00aaff' : '#ff4444';
                ctx.fillRect(-barWidth / 2, barY, barWidth * hpPercent, barHeight);

                if (p.shield > 0) {
                  const shieldPercent = Math.min(1, p.shield / p.maxHp);
                  ctx.fillStyle = '#ffffff';
                  ctx.fillRect(-barWidth / 2 + (barWidth * hpPercent), barY, barWidth * shieldPercent, barHeight);
                }

                ctx.font = 'bold 3px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillStyle = '#ffffff';
                ctx.shadowColor = '#000000';
                ctx.shadowBlur = 2;
                ctx.fillText(p.username, 0, barY - 3);
              }

              ctx.restore();
            }

            ctx.restore();
          }

          function drawMinimap() {
            miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);

            if (mapImage.complete) {
              miniCtx.drawImage(mapImage, 0, 0, miniCanvas.width, miniCanvas.height);
            }

            const scale = miniCanvas.width / MAP_SIZE;

            for (let id in clientPlayers) {
              const p = clientPlayers[id];
              if (p.isDead) continue;

              const mx = p.renderX * scale;
              const my = p.renderY * scale;

              miniCtx.fillStyle = p.team === 'blue' ? '#00aaff' : '#ff4444';
              miniCtx.beginPath();
              miniCtx.arc(mx, my, 3, 0, Math.PI * 2);
              miniCtx.fill();

              if (id === socket.id) {
                miniCtx.strokeStyle = '#ffffff';
                miniCtx.lineWidth = 1;
                miniCtx.stroke();
              }
            }
          }
        }
      </script>
    </body>
    </html>
  `);
});

// === Socket.IO 게임 로직 및 커스텀 가렌 스킬 처리 ===
io.on('connection', (socket) => {
  const username = socket.handshake.auth.username || 'Summoner';
  const team = getBalancedTeam();
  const spawnX = team === 'blue' ? 200 : 1800;
  const spawnY = team === 'blue' ? 1800 : 200;

  players[socket.id] = {
    id: socket.id,
    username: username,
    team: team,
    x: spawnX,
    y: spawnY,
    dirX: 0,
    dirY: 0,
    hp: 620,
    maxHp: 620,
    shield: 0,
    isDead: false,
    respawnTime: 0,

    isAttacking: false,
    attackProgress: 0,
    lastAttackTime: 0,

    // Q 스킬
    lastQTime: 0,
    qCooldown: 8000,
    hasQBuff: false,
    qBuffEndTime: 0,
    hasSpeedBuff: false,
    speedBuffEndTime: 0,

    // W 스킬
    lastWTime: 0,
    wCooldown: 12000,
    hasShieldPhase: false,
    shieldPhaseEndTime: 0,
    hasDamageReducePhase: false,
    damageReduceEndTime: 0,

    // E 스킬
    lastETime: 0,
    eCooldown: 9000,
    isEActive: false,
    eStartTime: 0,
    eTicksDone: 0,
    isArmorDebuffed: false,

    // B 키 귀환
    isRecalling: false,
    recallEndTime: 0
  };

  io.emit('chatMessage', {
    username: '시스템',
    text: `${username} 님이 입장하셨습니다. (${team === 'blue' ? '블루' : '레드'}팀)`,
    isSystem: true
  });

  socket.on('keyMove', (dir) => {
    const player = players[socket.id];
    if (!player || player.isDead) return;

    if (dir.x !== 0 || dir.y !== 0) {
      player.isRecalling = false;
    }

    player.dirX = dir.x;
    player.dirY = dir.y;
  });

  socket.on('attack', () => {
    const player = players[socket.id];
    if (!player || player.isDead || player.isAttacking || player.isEActive) return;

    player.isRecalling = false;
    player.isAttacking = true;
    player.attackProgress = 0;
    player.lastAttackTime = Date.now();
  });

  socket.on('useQ', () => {
    const player = players[socket.id];
    if (!player || player.isDead) return;
    const now = Date.now();

    if (now - player.lastQTime >= player.qCooldown) {
      player.isRecalling = false;
      player.lastQTime = now;
      player.hasQBuff = true;
      player.qBuffEndTime = now + 4500;
      player.hasSpeedBuff = true;
      player.speedBuffEndTime = now + 3500;
    }
  });

  socket.on('useW', () => {
    const player = players[socket.id];
    if (!player || player.isDead) return;
    const now = Date.now();

    if (now - player.lastWTime >= player.wCooldown) {
      player.isRecalling = false;
      player.lastWTime = now;
      player.hasShieldPhase = true;
      player.shieldPhaseEndTime = now + 2000;
      player.hasDamageReducePhase = true;
      player.damageReduceEndTime = now + 4000;

      const shieldValue = 65 + (player.maxHp * 0.18);
      player.shield = shieldValue;
    }
  });

  socket.on('useE', () => {
    const player = players[socket.id];
    if (!player || player.isDead || player.isEActive) return;
    const now = Date.now();

    if (now - player.lastETime >= player.eCooldown) {
      player.isRecalling = false;
      player.lastETime = now;
      player.isEActive = true;
      player.eStartTime = now;
      player.eTicksDone = 0;
    }
  });

  socket.on('startRecall', () => {
    const player = players[socket.id];
    if (!player || player.isDead || player.isRecalling) return;

    const now = Date.now();
    player.isRecalling = true;
    player.recallEndTime = now + 8000;
  });

  socket.on('chatMessage', (data) => {
    const player = players[socket.id];
    if (!player) return;

    const targetMode = data.targetMode || 'all';

    if (targetMode === 'team') {
      for (let id in players) {
        if (players[id].team === player.team) {
          io.to(id).emit('chatMessage', {
            username: player.username,
            text: data.text,
            team: player.team,
            targetMode: 'team'
          });
        }
      }
    } else {
      io.emit('chatMessage', {
        username: player.username,
        text: data.text,
        team: player.team,
        targetMode: 'all'
      });
    }
  });

  socket.on('kickPlayer', (targetId) => {
    const sender = players[socket.id];
    if (sender && sender.username === '박준우') {
      const target = players[targetId];
      if (target) {
        io.to(targetId).emit('kicked', '방장에 의해 강제 퇴장되었습니다.');
        delete players[targetId];
      }
    }
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
      io.emit('chatMessage', {
        username: '시스템',
        text: `${players[socket.id].username} 님이 퇴장하셨습니다.`,
        isSystem: true
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
      p.isRecalling = false;
      if (now >= p.respawnTime) {
        p.isDead = false;
        p.hp = p.maxHp;
        p.shield = 0;
        p.x = p.team === 'blue' ? 200 : 1800;
        p.y = p.team === 'blue' ? 1800 : 200;
      }
      continue;
    }

    if (p.isRecalling && now >= p.recallEndTime) {
      p.isRecalling = false;
      p.x = p.team === 'blue' ? 200 : 1800;
      p.y = p.team === 'blue' ? 1800 : 200;
      p.hp = p.maxHp;
    }

    if (p.hasQBuff && now > p.qBuffEndTime) p.hasQBuff = false;
    if (p.hasSpeedBuff && now > p.speedBuffEndTime) p.hasSpeedBuff = false;

    if (p.hasShieldPhase && now > p.shieldPhaseEndTime) {
      p.hasShieldPhase = false;
      p.shield = 0;
    }
    if (p.hasDamageReducePhase && now > p.damageReduceEndTime) {
      p.hasDamageReducePhase = false;
    }

    // === 서버 이동 처리 속도 복구 (기본: 3.0, 버프: 4.1) ===
    const baseSpeed = p.hasSpeedBuff ? 4.1 : 3.0;
    if (p.dirX !== 0 || p.dirY !== 0) {
      let mx = p.dirX, my = p.dirY;
      if (mx !== 0 && my !== 0) { mx *= 0.7071; my *= 0.7071; }

      const nextX = p.x + mx * baseSpeed;
      const nextY = p.y + my * baseSpeed;

      if (!isColliding(nextX, p.y)) p.x = Math.max(10, Math.min(MAP_SIZE - 10, nextX));
      if (!isColliding(p.x, nextY)) p.y = Math.max(10, Math.min(MAP_SIZE - 10, nextY));
    }

    if (p.isAttacking) {
      p.attackProgress += 0.12;
      if (p.attackProgress >= 0.5 && p.attackProgress - 0.12 < 0.5) {
        for (let otherId in players) {
          const target = players[otherId];
          if (otherId !== id && target.team !== p.team && !target.isDead) {
            const dx = target.x - p.x;
            const dy = target.y - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist <= 45) {
              target.isRecalling = false;
              let damage = p.hasQBuff ? 85 : 45;
              
              if (target.hasDamageReducePhase) damage *= 0.7;

              if (target.shield > 0) {
                if (target.shield >= damage) {
                  target.shield -= damage;
                  damage = 0;
                } else {
                  damage -= target.shield;
                  target.shield = 0;
                }
              }

              target.hp -= damage;
              if (p.hasQBuff) p.hasQBuff = false;

              if (target.hp <= 0) {
                target.isDead = true;
                target.respawnTime = now + 10000;
                io.emit('chatMessage', {
                  username: '시스템',
                  text: `${p.username} 님이 ${target.username} 님을 처치했습니다!`,
                  isSystem: true
                });
              }
            }
          }
        }
      }

      if (p.attackProgress >= 1.0) {
        p.isAttacking = false;
        p.attackProgress = 0;
      }
    }

    if (p.isEActive) {
      const elapsed = now - p.eStartTime;
      const currentTick = Math.floor(elapsed / (3000 / 7));

      if (currentTick > p.eTicksDone && currentTick <= 7) {
        p.eTicksDone = currentTick;

        for (let otherId in players) {
          const target = players[otherId];
          if (otherId !== id && target.team !== p.team && !target.isDead) {
            const dx = target.x - p.x;
            const dy = target.y - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist <= 55) {
              target.isRecalling = false;
              let damage = 22;
              if (target.hasDamageReducePhase) damage *= 0.7;

              if (target.shield > 0) {
                if (target.shield >= damage) {
                  target.shield -= damage;
                  damage = 0;
                } else {
                  damage -= target.shield;
                  target.shield = 0;
                }
              }

              target.hp -= damage;
              if (target.hp <= 0) {
                target.isDead = true;
                target.respawnTime = now + 10000;
                io.emit('chatMessage', {
                  username: '시스템',
                  text: `${p.username} 님이 ${target.username} 님을 처치했습니다!`,
                  isSystem: true
                });
              }
            }
          }
        }
      }

      if (elapsed >= 3000) {
        p.isEActive = false;
      }
    }
  }

  io.emit('gameState', { players, nexuses });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
