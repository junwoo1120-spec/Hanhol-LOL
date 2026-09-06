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

// 맵 이미지 내 실제 구조물 위치 및 충돌 반경(Hitbox) 최적화
const colliders = [
  // 블루팀 넥서스 & 억제기 & 포탑
  { x: 220, y: 1780, radius: 40 }, // 블루 넥서스
  { x: 180, y: 1620, radius: 20 }, // 블루 억제기 (탑)
  { x: 340, y: 1660, radius: 18 }, // 블루 억제기 (미드 - 길목 막힘 방지를 위해 좌표 우하향 조정)
  { x: 380, y: 1820, radius: 20 }, // 블루 억제기 (바텀)
  { x: 220, y: 1350, radius: 25 }, // 블루 1차 타워 (탑)
  { x: 650, y: 1350, radius: 25 }, // 블루 1차 타워 (미드)
  { x: 1350, y: 1780, radius: 25 }, // 블루 1차 타워 (바텀)

  // 레드팀 넥서스 & 억제기 & 포탑
  { x: 1780, y: 220, radius: 40 }, // 레드 넥서스
  { x: 1620, y: 180, radius: 20 }, // 레드 억제기 (탑)
  { x: 1660, y: 340, radius: 18 }, // 레드 억제기 (미드 - 길목 막힘 방지를 위해 좌표 좌상향 조정)
  { x: 1820, y: 380, radius: 20 }, // 레드 억제기 (바텀)
  { x: 650, y: 220, radius: 25 },  // 레드 1차 타워 (탑)
  { x: 1350, y: 650, radius: 25 }, // 레드 1차 타워 (미드)
  { x: 1780, y: 650, radius: 25 }  // 레드 1차 타워 (바텀)
];

// 원형 충돌 검사 함수
function isColliding(x, y, playerRadius = 3.5) {
  for (let c of colliders) {
    const dx = x - c.x;
    const dy = y - c.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < c.radius + playerRadius) {
      return true; // 충돌 발생
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

          // 2. 플레이어 캐릭터 렌더링
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
  // 블루팀 우물 스폰
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
