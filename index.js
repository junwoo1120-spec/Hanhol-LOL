const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const MAP_SIZE = 2000;
let players = {};

// 포탑 및 억제기 위치 설정
const structures = [
  // 블루팀 포탑
  { type: 'turret', team: 'blue', x: 220, y: 1350 }, // 탑 1차
  { type: 'turret', team: 'blue', x: 650, y: 1350 }, // 미드 1차
  { type: 'turret', team: 'blue', x: 1350, y: 1780 }, // 바텀 1차
  // 레드팀 포탑
  { type: 'turret', team: 'red', x: 1780, y: 650 },  // 바텀 1차
  { type: 'turret', team: 'red', x: 1350, y: 650 },  // 미드 1차
  { type: 'turret', team: 'red', x: 650, y: 220 },   // 탑 1차
  // 억제기
  { type: 'inh', team: 'blue', lane: 'Top', x: 180, y: 1620 },
  { type: 'inh', team: 'blue', lane: 'Mid', x: 380, y: 1620 },
  { type: 'inh', team: 'blue', lane: 'Bot', x: 380, y: 1820 },
  { type: 'inh', team: 'red', lane: 'Top', x: 1620, y: 180 },
  { type: 'inh', team: 'red', lane: 'Mid', x: 1620, y: 380 },
  { type: 'inh', team: 'red', lane: 'Bot', x: 1820, y: 380 }
];

function isPointInMap(x, y) {
  const polygon = [
    { x: 80, y: MAP_SIZE - 150 },
    { x: 80, y: 280 },
    { x: 280, y: 80 },
    { x: MAP_SIZE - 150, y: 80 },
    { x: MAP_SIZE - 80, y: 150 },
    { x: MAP_SIZE - 80, y: MAP_SIZE - 280 },
    { x: MAP_SIZE - 280, y: MAP_SIZE - 80 },
    { x: 150, y: MAP_SIZE - 80 }
  ];

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Summoner's Rift Classic</title>
      <style>
        body { margin: 0; background: #05080a; color: white; text-align: center; font-family: sans-serif; overflow: hidden; }
        canvas { display: block; margin: 0 auto; background: #000; }
      </style>
    </head>
    <body>
      <canvas id="game" width="1024" height="600"></canvas>
      <script src="/socket.io/socket.io.js"></script>
      <script>
        const socket = io();
        const canvas = document.getElementById('game');
        const ctx = canvas.getContext('2d');
        const MAP_SIZE = 2000;

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
          
          ctx.fillStyle = '#05070a';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          ctx.save();
          if (me) {
            ctx.translate(canvas.width / 2 - me.x, canvas.height / 2 - me.y);
          }

          // 1. 외곽 숲/암석 베이스
          ctx.fillStyle = '#0f1c13';
          ctx.beginPath();
          ctx.moveTo(80, MAP_SIZE - 150);
          ctx.lineTo(80, 280);
          ctx.lineTo(280, 80);
          ctx.lineTo(MAP_SIZE - 150, 80);
          ctx.lineTo(MAP_SIZE - 80, 150);
          ctx.lineTo(MAP_SIZE - 80, MAP_SIZE - 280);
          ctx.lineTo(MAP_SIZE - 280, MAP_SIZE - 80);
          ctx.lineTo(150, MAP_SIZE - 80);
          ctx.closePath();
          ctx.fill();

          // 2. 강 (River) 디테일
          ctx.fillStyle = '#0d2d42';
          ctx.beginPath();
          ctx.moveTo(60, MAP_SIZE - 320);
          ctx.lineTo(320, MAP_SIZE - 60);
          ctx.lineTo(MAP_SIZE - 60, 320);
          ctx.lineTo(MAP_SIZE - 320, 60);
          ctx.closePath();
          ctx.fill();

          // 3. 라인 (Lanes) - 땅 질감
          ctx.strokeStyle = '#2b2720';
          ctx.lineWidth = 100;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          // 탑 / 바텀 / 미드 라인
          ctx.beginPath();
          ctx.moveTo(150, MAP_SIZE - 150); ctx.lineTo(150, 150); ctx.lineTo(MAP_SIZE - 150, 150);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(150, MAP_SIZE - 150); ctx.lineTo(MAP_SIZE - 150, MAP_SIZE - 150); ctx.lineTo(MAP_SIZE - 150, 150);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(150, MAP_SIZE - 150); ctx.lineTo(MAP_SIZE - 150, 150);
          ctx.stroke();

          // 4. 정글 벽 & 지형 암석 표현 (Jungle Rocks)
          ctx.fillStyle = '#172118';
          ctx.strokeStyle = '#0e140f';
          ctx.lineWidth = 4;

          const jungleWalls = [
            // 블루 상단 정글
            [ {x: 400, y: 1200}, {x: 550, y: 1100}, {x: 500, y: 1300} ],
            [ {x: 700, y: 1400}, {x: 900, y: 1450}, {x: 800, y: 1600} ],
            // 레드 상단 정글 (바론 둥지 근처)
            [ {x: 650, y: 750}, {x: 800, y: 700}, {x: 750, y: 850} ],
            // 용 둥지 (Dragon Pit)
            [ {x: 1250, y: 1300}, {x: 1400, y: 1250}, {x: 1350, y: 1400} ],
            // 바론 둥지 (Baron Pit)
            [ {x: 600, y: 650}, {x: 750, y: 600}, {x: 650, y: 750} ]
          ];

          jungleWalls.forEach(wall => {
            ctx.beginPath();
            ctx.moveTo(wall[0].x, wall[0].y);
            ctx.lineTo(wall[1].x, wall[1].y);
            ctx.lineTo(wall[2].x, wall[2].y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          });

          // 5. 진영 기지 (Bases & Nexus)
          // 블루 기지
          ctx.fillStyle = '#102e4a';
          ctx.beginPath(); ctx.arc(200, MAP_SIZE - 200, 160, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#0066ff';
          ctx.beginPath(); ctx.arc(150, MAP_SIZE - 150, 45, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#66a3ff'; ctx.lineWidth = 5; ctx.stroke();

          // 레드 기지
          ctx.fillStyle = '#4a1010';
          ctx.beginPath(); ctx.arc(MAP_SIZE - 200, 200, 160, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ff2222';
          ctx.beginPath(); ctx.arc(MAP_SIZE - 150, 150, 45, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#ff8888'; ctx.lineWidth = 5; ctx.stroke();

          // 6. 포탑 및 억제기 오브젝트
          structures.forEach(s => {
            if (s.type === 'turret') {
              // 포탑
              ctx.fillStyle = s.team === 'blue' ? '#1a59a8' : '#a81a1a';
              ctx.fillRect(s.x - 15, s.y - 15, 30, 30);
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 2;
              ctx.strokeRect(s.x - 15, s.y - 15, 30, 30);
            } else if (s.type === 'inh') {
              // 억제기
              ctx.fillStyle = s.team === 'blue' ? '#3388ff' : '#ff5555';
              ctx.beginPath(); ctx.arc(s.x, s.y, 16, 0, Math.PI * 2); ctx.fill();
              ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
            }
          });

          // 7. 플레이어
          for (let id in players) {
            const p = players[id];
            const isMe = id === socket.id;

            // 플레이어 그림자
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.beginPath();
            ctx.arc(p.x + 3, p.y + 3, 16, 0, Math.PI * 2);
            ctx.fill();

            // 플레이어 원형 캐릭터
            ctx.fillStyle = isMe ? '#00ffff' : '#ffea00';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#000000';
            ctx.stroke();

            // 닉네임 표시
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(isMe ? '나' : '적', p.x, p.y - 24);
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
  const SPEED = 3.8;

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

    if (isPointInMap(nextX, p.y)) p.x = nextX;
    if (isPointInMap(p.x, nextY)) p.y = nextY;
  }

  io.emit('gameState', { players, structures });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`게임 서버 작동 중 (포트: ${PORT})`);
});
