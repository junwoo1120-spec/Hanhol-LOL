const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// 전역 변수 선언 (오류 방지)
const players = {};
const inhibitors = {};

// 기본 루트 확인용
app.get('/', (req, res) => {
  res.send('Hanhol-LOL Server is Running!');
});

// 소켓 연결 처리
io.on('connection', (socket) => {
  console.log('플레이어 접속:', socket.id);

  players[socket.id] = {
    x: 400,
    y: 300,
    color: '#' + Math.floor(Math.random()*16777215).toString(16)
  };

  socket.on('disconnect', () => {
    console.log('플레이어 퇴장:', socket.id);
    delete players[socket.id];
  });
});

// 루프 (초당 60회 전송)
setInterval(() => {
  io.emit('gameState', { players, inhibitors });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});