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

// 구조물 크기 규격화
const NEXUS_RADIUS = 35;
const INHIBITOR_RADIUS = 25;
const TURRET_RADIUS = 22;

// 정제된 구조물 충돌체 좌표 (잘못 클릭한 {1421, 786} 제거)
const colliders = [
  // === 블루팀 (좌하단) ===
  { x: 225, y: 1766, radius: NEXUS_RADIUS },     // 블루 넥서스
  { x: 309, y: 1748, radius: TURRET_RADIUS },    // 블루 쌍둥이 1
  { x: 251, y: 1687, radius: TURRET_RADIUS },    // 블루 쌍둥이 2

  { x: 175, y: 1513, radius: INHIBITOR_RADIUS }, // 블루 탑 억제기
  { x: 446, y: 1561, radius: INHIBITOR_RADIUS }, // 블루 미드 억제기
  { x: 478, y: 1824, radius: INHIBITOR_RADIUS }, // 블루 바텀 억제기

  { x: 175, y: 1417, radius: TURRET_RADIUS },    // 블루 탑 3차
  { x: 506, y: 1495, radius: TURRET_RADIUS },    // 블루 미드 3차
  { x: 589, y: 1821, radius: TURRET_RADIUS },    // 블루 바텀 3차

  { x: 222, y: 1096, radius: TURRET_RADIUS },    // 블루 탑 2차
  { x: 692, y: 1347, radius: TURRET_RADIUS },    // 블루 미드 2차
  { x: 941, y: 1791, radius: TURRET_RADIUS },    // 블루 바텀 2차

  { x: 149, y: 597,  radius: TURRET_RADIUS },    // 블루 탑 1차
  { x: 798, y: 1136, radius: TURRET_RADIUS },    // 블루 미드 1차
  { x: 1418, y: 1852, radius: TURRET_RADIUS },   // 블루 바텀 1차

  // === 레드팀 (우상단) ===
  { x: 1786, y: 223, radius: NEXUS_RADIUS },     // 레드 넥서스
  { x: 1759, y: 307, radius: TURRET_RADIUS },    // 레드 쌍둥이 1
  { x: 1702, y: 242, radius: TURRET_RADIUS },    // 레드 쌍둥이 2

  { x: 1519, y: 163, radius: INHIBITOR_RADIUS }, // 레드 탑 억제기
  { x: 1564, y: 434, radius: INHIBITOR_RADIUS }, // 레드 미드 억제기
  { x: 1832, y: 479, radius: INHIBITOR_RADIUS }, // 레드 바텀 억제기

  { x: 1416, y: 168, radius: TURRET_RADIUS },    // 레드 탑 3차
  { x: 1501, y: 495, radius: TURRET_RADIUS },    // 레드 미드 3차
  { x: 1835, y: 579, radius: TURRET_RADIUS },    // 레드 바텀 3차

  { x: 1077, y: 199, radius: TURRET_RADIUS },    // 레드 탑 2차
  { x: 1319, y: 640, radius: TURRET_RADIUS },    // 레드 미드 2차
  { x: 1796, y: 893, radius: TURRET_RADIUS },    // 레드 바텀 2차

  { x: 595,  y: 138, radius: TURRET_RADIUS },    // 레드 탑 1차
  { x: 1211, y: 854, radius: TURRET_RADIUS },    // 레드 미드 1차
  { x: 1867, y: 1388, radius: TURRET_RADIUS }    // 레드 바텀 1차
];

// 원형 충돌 검사 (플레이어 반지름 4.2 반영)
function isColliding(x, y, playerRadius = 4.2) {
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
        canvas { display: block; width: 100vw; height: 100vh; background: #000; }
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

          // 2. 플레이어 캐릭터 렌더링 (크기 1.2배: 반지름 4.2)
          for (let id in players) {
            const p = players[id];
            const isMe = id === socket.id;

            // 그림자
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.beginPath();
            ctx.arc(p.x + 0.5, p.y + 0.5, 4.2, 0, Math.PI * 2);
            ctx.fill();

            // 본체
            ctx.fillStyle = isMe ? '#00ffff' : '#ffea00';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = 0.8;
            ctx.strokeStyle = '#000000';
            ctx.stroke();

            // 이름 표기
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 4.5px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(isMe ? '나' : '적', p.x, p.y - 6);
          }

          ctx.restore();
        }
      </script>
    </body>
    </html>
  `);
});

io.on('connection', (socket) => {
  // 블루팀 우물 스폰
  players[socket.id] = { 
    x: 100, 
    y: 1900, 
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
  // 캐릭터 이동 속도 원상 복구 (0.75)
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
