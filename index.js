const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// 맵 크기 (2000px)
const MAP_SIZE = 2000;
let players = {};

// 억제기 위치 (탑, 미드, 바텀)
const inhibitors = [
  { team: 'blue', lane: 'Top', x: 180, y: 1620 },
  { team: 'blue', lane: 'Mid', x: 380, y: 1620 },
  { team: 'blue', lane: 'Bot', x: 380, y: 1820 },
  { team: 'red', lane: 'Top', x: 1620, y: 180 },
  { team: 'red', lane: 'Mid', x: 1620, y: 380 },
  { team: 'red', lane: 'Bot', x: 1820, y: 380 }
];

// 검은색 맵 바깥 영역 충돌 검사 함수 (Point in Polygon)
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
      <title>Summoner's Rift Map</title>
      <style>
        body { margin: 0; background: #000; color: white; text-align: center; font-family: sans-serif; overflow: hidden; }
        canvas { display: block; margin: 0 auto; background: #000; }
      </style>
    </head>
    <body>
      <canvas id="game" width="960" height="540"></canvas>
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
          draw(data.inhibitors);
        });

        function draw(inhibitors) {
          const me = players[socket.id];
          
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          ctx.save();
          if (me) {
            ctx.translate(canvas.width / 2 - me.x, canvas.height / 2 - me.y);
          }

          // 1. 소환사의 협곡 지형 (초록색)
          ctx.fillStyle = '#1d3319';
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

          ctx.strokeStyle = '#050a04';
          ctx.lineWidth = 8;
          ctx.stroke();

          // 2. 강
          ctx.fillStyle = '#11354c';
          ctx.beginPath();
          ctx.moveTo(80, MAP_SIZE - 300);
          ctx.lineTo(300, MAP_SIZE - 80);
          ctx.lineTo(MAP_SIZE - 80, 300);
          ctx.lineTo(MAP_SIZE - 300, 80);
          ctx.closePath();
          ctx.fill();

          // 3. 라인 (탑, 미드, 바텀)
          ctx.strokeStyle = '#3d382b';
          ctx.lineWidth = 90;
          
          ctx.beginPath();
          ctx.moveTo(150, MAP_SIZE - 150);
          ctx.lineTo(150, 150);
          ctx.lineTo(MAP_SIZE - 150, 150);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(150, MAP_SIZE - 150);
          ctx.lineTo(MAP_SIZE - 150, 150);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(150, MAP_SIZE - 150);
          ctx.lineTo(MAP_SIZE - 150, MAP_SIZE - 150);
          ctx.lineTo(MAP_SIZE - 150, 150);
          ctx.stroke();

          // 4. 넥서스
          ctx.fillStyle = '#0055ff';
          ctx.beginPath(); ctx.arc(150, MAP_SIZE - 150, 50, 0, Math.PI*2); ctx.fill();
          ctx.fillStyle = '#ff2222';
          ctx.beginPath(); ctx.arc(MAP_SIZE - 150, 150, 50, 0, Math.PI*2); ctx.fill();

          // 5. 억제기 (통과 가능)
          inhibitors.forEach(inh => {
            ctx.fillStyle = inh.team === 'blue' ? '#3388ff' : '#ff5555';
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            
            ctx.beginPath();
            ctx.arc(inh.x, inh.y, 18, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(inh.lane, inh.x, inh.y + 4);
          });

          // 6. 플레이어
          for (let id in players) {
            const p = players[id];
            
            ctx.fillStyle = id === socket.id ? '#00ffff' : '#ffea00';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#000';
            ctx.stroke();

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(id === socket.id ? '나' : '적', p.x, p.y - 22);
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
    x: 250, 
    y: MAP_SIZE - 250, 
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

// 실제 롤 이동 속도 감각 적용 (SPEED = 3.8)
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

    if (isPointInMap(nextX, p.y)) {
      p.x = nextX;
    }
    if (isPointInMap(p.x, nextY)) {
      p.y = nextY;
    }
  }

  io.emit('gameState', { players, inhibitors });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`게임 서버 작동 중 (포트: ${PORT})`);
});
