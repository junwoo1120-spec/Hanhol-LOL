const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// 정적 파일 연결
app.use(express.static(path.join(__dirname)));

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
        * { box-sizing: border-box; }
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; color: white; font-family: sans-serif; }
        /* CSS를 통해 확대로 인한 뭉개짐(블러) 방지 처리 */
        canvas { 
          display: block; 
          width: 100vw; 
          height: 100vh; 
          background: #000; 
          image-rendering: pixelated; 
          image-rendering: crisp-edges;
        }
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

        // 전체 화면 대응 캔버스 리사이즈 함수
        function resizeCanvas() {
          canvas.width = window.innerWidth;
          canvas.height = window.innerHeight;
          
          // Canvas 내 이미지 보간(부드럽게 뭉개기) 끄기 설정
          ctx.imageSmoothingEnabled = false;
          ctx.webkitImageSmoothingEnabled = false;
          ctx.mozImageSmoothingEnabled = false;
        }
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();

        // 맵 이미지 로드
        const mapImage = new Image();
        mapImage.src = 'images.png';

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
          
          // 화면 리셋 시에도 픽셀 선명도 재설정
          ctx.imageSmoothingEnabled = false;

          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          ctx.save();
          if (me) {
            // 화면 중심 설정 및 정수화 위치 조정을 통한 번짐 방지
            ctx.translate(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2));
            
            // 시야 범위 4.5배 축소(줌인)
            ctx.scale(4.5, 4.5);
            
            // 내 캐릭터 중심으로 카메라 이동 (소수점 방지)
            ctx.translate(-Math.floor(me.x), -Math.floor(me.y));
          }

          // 1. 맵 이미지 렌더링
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

          // 2. 포탑 및 억제기 렌더링
          structures.forEach(s => {
            if (s.type === 'turret') {
              ctx.fillStyle = s.team === 'blue' ? '#2b7fff' : '#ff4d4d';
              ctx.fillRect(s.x - 5, s.y - 5, 10, 10);
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 1;
              ctx.strokeRect(s.x - 5, s.y - 5, 10, 10);
            } else if (s.type === 'inh') {
              ctx.fillStyle = s.team === 'blue' ? '#00e5ff' : '#ff0055';
              ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.fill();
              ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
            }
          });

          // 3. 플레이어 캐릭터 렌더링
          for (let id in players) {
            const p = players[id];
            const isMe = id === socket.id;

            // 그림자
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.beginPath();
            ctx.arc(p.x + 0.5, p.y + 0.5, 3.5, 0, Math.PI * 2);
            ctx.fill();

            // 캐릭터
            ctx.fillStyle = isMe ? '#00ffff' : '#ffea00';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = 0.8;
            ctx.strokeStyle = '#000000';
            ctx.stroke();

            // 닉네임
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 3.5px sans-serif';
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

    if (nextX >= 20 && nextX <= MAP_SIZE - 20) p.x = nextX;
    if (nextY >= 20 && nextY <= MAP_SIZE - 20) p.y = nextY;
  }

  io.emit('gameState', { players, structures });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`게임 서버 작동 중 (포트: ${PORT})`);
});
