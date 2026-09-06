const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname)));

const MAP_SIZE = 2000;
let players = {};

// 규격화된 충돌 반경
const NEXUS_RADIUS = 35;
const INHIBITOR_RADIUS = 25;
const TURRET_RADIUS = 22;

// 롤 미니맵 표준 대칭 비율에 맞춘 1차 보정 좌표
const colliders = [
  // === 블루팀 (좌하단) ===
  { x: 280, y: 1720, radius: NEXUS_RADIUS },     // 블루 넥서스
  { x: 340, y: 1660, radius: TURRET_RADIUS },    // 블루 쌍둥이 1
  { x: 300, y: 1620, radius: TURRET_RADIUS },    // 블루 쌍둥이 2

  { x: 200, y: 1560, radius: INHIBITOR_RADIUS }, // 블루 탑 억제기
  { x: 380, y: 1560, radius: INHIBITOR_RADIUS }, // 블루 미드 억제기
  { x: 440, y: 1800, radius: INHIBITOR_RADIUS }, // 블루 바텀 억제기

  { x: 200, y: 1460, radius: TURRET_RADIUS },    // 블루 탑 3차
  { x: 450, y: 1490, radius: TURRET_RADIUS },    // 블루 미드 3차
  { x: 540, y: 1800, radius: TURRET_RADIUS },    // 블루 바텀 3차

  { x: 200, y: 1080, radius: TURRET_RADIUS },    // 블루 탑 2차
  { x: 720, y: 1280, radius: TURRET_RADIUS },    // 블루 미드 2차
  { x: 960, y: 1800, radius: TURRET_RADIUS },    // 블루 바텀 2차

  { x: 200, y: 620,  radius: TURRET_RADIUS },    // 블루 탑 1차
  { x: 940, y: 1060, radius: TURRET_RADIUS },    // 블루 미드 1차
  { x: 1380, y: 1800, radius: TURRET_RADIUS },   // 블루 바텀 1차

  // === 레드팀 (우상단) ===
  { x: 1720, y: 280, radius: NEXUS_RADIUS },     // 레드 넥서스
  { x: 1660, y: 340, radius: TURRET_RADIUS },    // 레드 쌍둥이 1
  { x: 1620, y: 300, radius: TURRET_RADIUS },    // 레드 쌍둥이 2

  { x: 1560, y: 200, radius: INHIBITOR_RADIUS }, // 레드 탑 억제기
  { x: 1560, y: 380, radius: INHIBITOR_RADIUS }, // 레드 미드 억제기
  { x: 1800, y: 440, radius: INHIBITOR_RADIUS }, // 레드 바텀 억제기

  { x: 1460, y: 200, radius: TURRET_RADIUS },    // 레드 탑 3차
  { x: 1490, y: 450, radius: TURRET_RADIUS },    // 레드 미드 3차
  { x: 1800, y: 540, radius: TURRET_RADIUS },    // 레드 바텀 3차

  { x: 1080, y: 200, radius: TURRET_RADIUS },    // 레드 탑 2차
  { x: 1280, y: 720, radius: TURRET_RADIUS },    // 레드 미드 2차
  { x: 1800, y: 960, radius: TURRET_RADIUS },    // 레드 바텀 2차

  { x: 620,  y: 200, radius: TURRET_RADIUS },    // 레드 탑 1차
  { x: 1060, y: 940, radius: TURRET_RADIUS },    // 레드 미드 1차
  { x: 1800, y: 1380, radius: TURRET_RADIUS }    // 레드 바텀 1차
];

function isColliding(x, y, playerRadius = 3.5) {
  for (let c of colliders) {
    const dx = x - c.x;
    const dy = y - c.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < c.radius + playerRadius) {
      return true;
    }
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
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; color: white; font-family: sans-serif; }
        canvas { display: block; width: 100vw; height: 100vh; background: #000; cursor: crosshair; }
      </style>
    </head>
    <body>
      <canvas id="game"></canvas>
      <script src="/socket.io/socket.io.js"></script>
      <script>
        const socket = io();
        const canvas = document.getElementById('game');
        const ctx = canvas.getContext('2d');
        const MAP_SIZE = 2000;

        const colliders = ${JSON.stringify(colliders)};

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

        let camX = 1000;
        let camY = 1000;

        // 클릭한 위치를 모니터링하기 위한 변수
        let lastClickMapX = null;
        let lastClickMapY = null;

        canvas.addEventListener('click', (e) => {
          const rect = canvas.getBoundingClientRect();
          const clickCssX = e.clientX - rect.left;
          const clickCssY = e.clientY - rect.top;

          const cssWidth = canvas.width / dpr;
          const cssHeight = canvas.height / dpr;
          const zoom = 4.0;

          // 화면 클릭 좌표를 맵상의 (X, Y) 좌표로 역계산
          const worldX = (clickCssX - cssWidth / 2) / zoom + camX;
          const worldY = (clickCssY - cssHeight / 2) / zoom + camY;

          lastClickMapX = Math.round(worldX);
          lastClickMapY = Math.round(worldY);

          console.log(\`[클릭 좌표] X: \${lastClickMapX}, Y: \${lastClickMapY}\`);
        });

        window.addEventListener('keydown', (e) => {
          if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            keys[e.key] = true;
            sendMovement();
          }
        });

        window.addEventListener('keyup', (e) => {
          if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            keys[e.key] = false;
            sendMovement();
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
        });

        function renderLoop() {
          draw();
          requestAnimationFrame(renderLoop);
        }
        requestAnimationFrame(renderLoop);

        function draw() {
          const me = players[socket.id];
          
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          ctx.save();
          
          if (me) {
            camX += (me.x - camX) * 0.15;
            camY += (me.y - camY) * 0.15;

            const cssWidth = canvas.width / dpr;
            const cssHeight = canvas.height / dpr;

            ctx.scale(dpr, dpr);
            ctx.translate(cssWidth / 2, cssHeight / 2);
            
            const zoom = 4.0;
            ctx.scale(zoom, zoom);
            
            ctx.translate(-camX, -camY);
          }

          ctx.imageSmoothingEnabled = true;

          // 1. 배경 맵 렌더링
          if (mapImage.complete && mapImage.naturalWidth !== 0) {
            ctx.drawImage(mapImage, 0, 0, MAP_SIZE, MAP_SIZE);
          } else {
            ctx.fillStyle = '#111111';
            ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
          }

          // 2. 히트박스 시각화 (빨간 원)
          for (let c of colliders) {
            ctx.fillStyle = 'rgba(255, 0, 0, 0.4)';
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }

          // 3. 마지막 클릭 위치 표시 (초록색 십자가)
          if (lastClickMapX !== null && lastClickMapY !== null) {
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(lastClickMapX - 10, lastClickMapY);
            ctx.lineTo(lastClickMapX + 10, lastClickMapY);
            ctx.moveTo(lastClickMapX, lastClickMapY - 10);
            ctx.lineTo(lastClickMapX, lastClickMapY + 10);
            ctx.stroke();
          }

          // 4. 플레이어 렌더링
          for (let id in players) {
            const p = players[id];
            const isMe = id === socket.id;

            ctx.fillStyle = isMe ? '#00ffff' : '#ffea00';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.restore();
        }
      </script>
    </body>
    </html>
  `);
});

io.on('connection', (socket) => {
  // 안전한 스폰 위치 (우물)
  players[socket.id] = { 
    x: 150, 
    y: 1850, 
    dirX: 0, 
    dirY: 0 
  };

  socket.on('keyMove', (dir) => {
    if (players[socket.id]) {
      players[socket.id].dirX = dir.x;
      players[socket.id].dirY = dir.y;
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
  });
});

setInterval(() => {
  const SPEED = 0.75;

  for (let id in players) {
    const p = players[id];
    
    let moveX = p.dirX;
    let moveY = p.dirY;

    if (moveX !== 0 && moveY !== 0) {
      moveX *= 0.7071;
      moveY *= 0.7071;
    }

    const nextX = p.x + moveX * SPEED;
    const nextY = p.y + moveY * SPEED;

    if (nextX >= 10 && nextX <= MAP_SIZE - 10) {
      if (!isColliding(nextX, p.y)) {
        p.x = nextX;
      }
    }
    if (nextY >= 10 && nextY <= MAP_SIZE - 10) {
      if (!isColliding(p.x, nextY)) {
        p.y = nextY;
      }
    }
  }

  io.emit('gameState', { players });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`게임 서버 작동 중 (포트: ${PORT})`);
});
