const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

const MAP_SIZE = 2000;
let players = {};

// 포탑 및 억제기 데이터
const structures = [
  // 블루팀 포탑
  { type: 'turret', team: 'blue', x: 220, y: 1350 },
  { type: 'turret', team: 'blue', x: 650, y: 1350 },
  { type: 'turret', team: 'blue', x: 1350, y: 1780 },
  // 레드팀 포탑
  { type: 'turret', team: 'red', x: 1780, y: 650 },
  { type: 'turret', team: 'red', x: 1350, y: 650 },
  { type: 'turret', team: 'red', x: 650, y: 220 },
  // 억제기
  { type: 'inh', team: 'blue', x: 180, y: 1620 },
  { type: 'inh', team: 'blue', x: 380, y: 1620 },
  { type: 'inh', team: 'blue', x: 380, y: 1820 },
  { type: 'inh', team: 'red', x: 1620, y: 180 },
  { type: 'inh', team: 'red', x: 1620, y: 380 },
  { type: 'inh', team: 'red', x: 1820, y: 380 }
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
        
        function resizeCanvas() {
          canvas.width = window.innerWidth;
          canvas.height = window.innerHeight;
        }
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();

        const MAP_SIZE = 2000;

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

          ctx.save();
          if (me) {
            ctx.translate(canvas.width / 2 - me.x, canvas.height / 2 - me.y);
          }

          // 맵 이미지 렌더링 (2000x2000)
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

          // 포탑 및 억제기
          structures.forEach(s => {
            if (s.type === 'turret') {
              ctx.fillStyle = s.team === 'blue' ? '#2b7fff' : '#ff4d4d';
              ctx.fillRect(s.x - 12, s.y - 12, 24, 24);
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 2;
              ctx.strokeRect(s.x - 12, s.y - 12, 24, 24);
            } else if (s.type === 'inh') {
              ctx.fillStyle = s.team === 'blue' ? '#00e5ff' : '#ff0055';
              ctx.beginPath(); ctx.arc(s.x, s.y, 14, 0, Math.PI * 2); ctx.fill();
              ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
            }
          });

          // 플레이어 캐릭터 렌더링
          for (let id in players) {
            const p = players[id];
            const isMe = id === socket.id;

            // 그림자
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.beginPath();
            ctx.arc(p.x + 2, p.y + 2, 15, 0, Math.PI * 2);
            ctx.fill();

            // 캐릭터
            ctx.fillStyle = isMe ? '#00ffff' : '#ffea00';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#000000';
            ctx.stroke();

            // 닉네임
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(isMe ? '나' : '적', p.x, p.y - 22);
          }

          ctx.restore();
        }
      </script>
    </body>
    </html>
  `);
});

io.on('connection', (socket) => {
  players[socket.id] = { 
    x: 220, 
    y: MAP_SIZE - 220, 
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
  // 원래 이동 속도 유지 (SPEED = 4)
  const SPEED = 4;

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

    if (nextX >= 50 && nextX <= MAP_SIZE - 50) p.x = nextX;
    if (nextY >= 50 && nextY <= MAP_SIZE - 50) p.y = nextY;
  }

  io.emit('gameState', { players, structures });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`게임 서버 작동 중 (포트: ${PORT})`);
});
