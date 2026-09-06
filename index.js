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

// 구조물 히트박스 반경 크기 정의
const NEXUS_RADIUS = 35;
const INHIBITOR_RADIUS = 25;
const TURRET_RADIUS = 22;

// 위치를 정확히 맞추기 위한 정밀 좌표 설정
const colliders = [
  // ================= 블루팀 (좌하단) =================
  // 1. 넥서스 & 쌍둥이 포탑
  { x: 230, y: 1770, radius: NEXUS_RADIUS },     // 블루 넥서스
  { x: 285, y: 1715, radius: TURRET_RADIUS },    // 블루 쌍둥이 포탑 (상/우)
  { x: 225, y: 1715, radius: TURRET_RADIUS },    // 블루 쌍둥이 포탑 (하/좌)

  // 2. 억제기 (3개)
  { x: 190, y: 1620, radius: INHIBITOR_RADIUS }, // 블루 탑 억제기
  { x: 370, y: 1630, radius: INHIBITOR_RADIUS }, // 블루 미드 억제기
  { x: 380, y: 1810, radius: INHIBITOR_RADIUS }, // 블루 바텀 억제기

  // 3. 3차 포탑 (억제기 포탑)
  { x: 190, y: 1510, radius: TURRET_RADIUS },    // 블루 탑 3차 포탑
  { x: 440, y: 1560, radius: TURRET_RADIUS },    // 블루 미드 3차 포탑
  { x: 490, y: 1810, radius: TURRET_RADIUS },    // 블루 바텀 3차 포탑

  // 4. 2차 포탑
  { x: 190, y: 1120, radius: TURRET_RADIUS },    // 블루 탑 2차 포탑
  { x: 670, y: 1330, radius: TURRET_RADIUS },    // 블루 미드 2차 포탑
  { x: 880, y: 1810, radius: TURRET_RADIUS },    // 블루 바텀 2차 포탑

  // 5. 1차 포탑
  { x: 200, y: 650,  radius: TURRET_RADIUS },    // 블루 탑 1차 포탑
  { x: 930, y: 1070, radius: TURRET_RADIUS },    // 블루 미드 1차 포탑
  { x: 1350, y: 1810, radius: TURRET_RADIUS },   // 블루 바텀 1차 포탑


  // ================= 레드팀 (우상단) =================
  // 1. 넥서스 & 쌍둥이 포탑
  { x: 1770, y: 230, radius: NEXUS_RADIUS },     // 레드 넥서스
  { x: 1715, y: 285, radius: TURRET_RADIUS },    // 레드 쌍둥이 포탑
  { x: 1715, y: 225, radius: TURRET_RADIUS },    // 레드 쌍둥이 포탑

  // 2. 억제기 (3개)
  { x: 1620, y: 190, radius: INHIBITOR_RADIUS }, // 레드 탑 억제기
  { x: 1630, y: 370, radius: INHIBITOR_RADIUS }, // 레드 미드 억제기
  { x: 1810, y: 380, radius: INHIBITOR_RADIUS }, // 레드 바텀 억제기

  // 3. 3차 포탑
  { x: 1510, y: 190, radius: TURRET_RADIUS },    // 레드 탑 3차 포탑
  { x: 1560, y: 440, radius: TURRET_RADIUS },    // 레드 미드 3차 포탑
  { x: 1810, y: 490, radius: TURRET_RADIUS },    // 레드 바텀 3차 포탑

  // 4. 2차 포탑
  { x: 1120, y: 190, radius: TURRET_RADIUS },    // 레드 탑 2차 포탑
  { x: 1330, y: 670, radius: TURRET_RADIUS },    // 레드 미드 2차 포탑
  { x: 1810, y: 880, radius: TURRET_RADIUS },    // 레드 바텀 2차 포탑

  // 5. 1차 포탑
  { x: 650,  y: 200, radius: TURRET_RADIUS },    // 레드 탑 1차 포탑
  { x: 1070, y: 930, radius: TURRET_RADIUS },    // 레드 미드 1차 포탑
  { x: 1810, y: 1350, radius: TURRET_RADIUS }    // 레드 바텀 1차 포탑
];

// 원형 충돌 검사
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

        // 디버그 설정 (히트박스 가시화)
        const SHOW_HITBOXES = true; // true로 두면 빨간 충돌 범위가 표시됩니다.

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

        let camX = 0;
        let camY = 0;

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
            if (camX === 0 && camY === 0) {
              camX = me.x;
              camY = me.y;
            } else {
              camX += (me.x - camX) * 0.15;
              camY += (me.y - camY) * 0.15;
            }

            const cssWidth = canvas.width / dpr;
            const cssHeight = canvas.height / dpr;

            ctx.scale(dpr, dpr);
            ctx.translate(cssWidth / 2, cssHeight / 2);
            
            const zoom = 4.0;
            ctx.scale(zoom, zoom);
            
            ctx.translate(-camX, -camY);
          }

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          // 1. 배경 맵 렌더링
          if (mapImage.complete && mapImage.naturalWidth !== 0) {
            ctx.drawImage(mapImage, 0, 0, MAP_SIZE, MAP_SIZE);
          } else {
            ctx.fillStyle = '#111111';
            ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
            ctx.fillStyle = '#ffffff';
            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('맵 이미지 로딩 중...', MAP_SIZE / 2, MAP_SIZE / 2);
          }

          // 2. 디버그 오버레이: 충돌 구역(히트박스) 빨간 원으로 렌더링
          if (SHOW_HITBOXES) {
            for (let c of colliders) {
              ctx.fillStyle = 'rgba(255, 0, 0, 0.35)';
              ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
              ctx.lineWidth = 0.8;
              ctx.beginPath();
              ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
          }

          // 3. 플레이어 캐릭터 렌더링
          for (let id in players) {
            const p = players[id];
            const isMe = id === socket.id;

            // 그림자
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.beginPath();
            ctx.arc(p.x + 0.5, p.y + 0.5, 3.5, 0, Math.PI * 2);
            ctx.fill();

            // 본체
            ctx.fillStyle = isMe ? '#00ffff' : '#ffea00';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = 0.8;
            ctx.strokeStyle = '#000000';
            ctx.stroke();

            // 이름 표기
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 4px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(isMe ? '나' : '적', p.x, p.y - 5);
          }

          ctx.restore();
        }
      </script>
    </body>
    </html>
  `);
});

io.on('connection', (socket) => {
  // 스폰 위치: 블루팀 우물
  players[socket.id] = { 
    x: 120, 
    y: 1880, 
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

    // X축 이동 및 충돌 체크
    if (nextX >= 20 && nextX <= MAP_SIZE - 20) {
      if (!isColliding(nextX, p.y)) {
        p.x = nextX;
      }
    }
    // Y축 이동 및 충돌 체크
    if (nextY >= 20 && nextY <= MAP_SIZE - 20) {
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
