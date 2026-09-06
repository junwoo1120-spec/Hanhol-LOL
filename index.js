const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

// 맵 실제 탐색 크기 (기존 2000 -> 8000으로 확장)
const MAP_SIZE = 8000;
let players = {};

// 포탑 및 억제기 위치 (맵 크기에 맞게 비례 조정)
const structures = [
  // 블루팀 포탑
  { type: 'turret', team: 'blue', x: 880, y: 5400 },
  { type: 'turret', team: 'blue', x: 2600, y: 5400 },
  { type: 'turret', team: 'blue', x: 5400, y: 7120 },
  // 레드팀 포탑
  { type: 'turret', team: 'red', x: 7120, y: 2600 },
  { type: 'turret', team: 'red', x: 5400, y: 2600 },
  { type: 'turret', team: 'red', x: 2600, y: 880 },
  // 억제기
  { type: 'inh', team: 'blue', x: 720, y: 6480 },
  { type: 'inh', team: 'blue', x: 1520, y: 6480 },
  { type: 'inh', team: 'blue', x: 1520, y: 7280 },
  { type: 'inh', team: 'red', x: 6480, y: 720 },
  { type: 'inh', team: 'red', x: 6480, y: 1520 },
  { type: 'inh', team: 'red', x: 7280, y: 1520 }
];

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Summoner's Rift Classic</title>
      <style>
        body { margin: 0; background: #000; color: white; text-align: center; font-family: sans-serif; overflow: hidden; }
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
        
        // 화면 크기에 맞게 해상도 자동 조절
        function resizeCanvas() {
          canvas.width = window.innerWidth;
          canvas.height = window.innerHeight;
        }
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();

        const MAP_SIZE = 8000;

        const mapImage = new Image();
        mapImage.src = '/image.png';

        let players = {};
        const keys = {};

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
          draw(data.structures);
        });

        function draw(structures) {
          const me = players[socket.id];
          
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // 이미지 화질 보정 옵션 (선명도 유지)
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          ctx.save();
          if (me) {
            ctx.translate(canvas.width / 2 - me.x, canvas.height / 2 - me.y);
          }

          // 1. 대형 맵 이미지 렌더링 (8000x8000)
          if (mapImage.complete && mapImage.naturalWidth !== 0) {
            ctx.drawImage(mapImage, 0, 0, MAP_SIZE, MAP_SIZE);
          } else {
            ctx.fillStyle = '#111111';
            ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
            ctx.fillStyle = '#ffffff';
            ctx.font = '24px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('고화질 맵 이미지 로딩 중...', MAP_SIZE / 2, MAP_SIZE / 2);
          }

          // 2. 포탑 및 억제기
          structures.forEach(s => {
            if (s.type === 'turret') {
              ctx.fillStyle = s.team === 'blue' ? '#2b7fff' : '#ff4d4d';
              ctx.fillRect(s.x - 30, s.y - 30, 60, 60);
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 4;
              ctx.strokeRect(s.x - 30, s.y - 30, 60, 60);
            } else if (s.type === 'inh') {
              ctx.fillStyle = s.team === 'blue' ? '#00e5ff' : '#ff0055';
              ctx.beginPath(); ctx.arc(s.x, s.y, 35, 0, Math.PI * 2); ctx.fill();
              ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.stroke();
            }
          });

          // 3. 플레이어 캐릭터
          for (let id in players) {
            const p = players[id];
            const isMe = id === socket.id;

            // 그림자
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.beginPath();
            ctx.arc(p.x + 4, p.y + 4, 30, 0, Math.PI * 2);
            ctx.fill();

            // 캐릭터
            ctx.fillStyle = isMe ? '#00ffff' : '#ffea00';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 30, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = 5;
            ctx.strokeStyle = '#000000';
            ctx.stroke();

            // 닉네임
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 18px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(isMe ? '나' : '적', p.x, p.y - 42);
          }

          ctx.restore();
        }
      </script>
    </body>
    </html>
  `);
});

io.on('connection', (socket) => {
  // 시작 위치 조정 (블루팀 샘)
  players[socket.id] = { 
    x: 800, 
    y: MAP_SIZE - 800, 
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
  // 맵이 넓어진 만큼 이동 속도 증가 (기존 4 -> 12)
  const SPEED = 12;

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

    if (nextX >= 100 && nextX <= MAP_SIZE - 100) p.x = nextX;
    if (nextY >= 100 && nextY <= MAP_SIZE - 100) p.y = nextY;
  }

  io.emit('gameState', { players, structures });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`게임 서버 작동 중 (포트: ${PORT})`);
});
