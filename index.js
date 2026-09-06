const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// GitHub 저장소 내의 이미지/정적 파일들을 서버에서 불러올 수 있도록 설정
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
        /* 픽셀 랜더링 방식 지정으로 확대로 인한 뭉개짐 방지 */
        canvas { 
          display: block; 
          margin: 0 auto; 
          background: #000;
          image-rendering: -webkit-optimize-contrast;
          image-rendering: crisp-edges;
        }
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

        // GitHub 저장소에 올린 맵 이미지 파일 로드
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
이 코드는 **Express**와 **Socket.IO**를 활용하여 웹 브라우저에서 실행 가능한 간단한 **2D 다중 사용자(Multiplayer) 탑뷰 게임 서버 및 클라이언트** 구현체입니다.

작성하신 코드의 주요 특징과 동작 방식을 다음과 같이 정리해 드립니다.

---

### 주요 기능 및 특징

1. **서버 및 정적 파일 제공**
   * Express 서버를 실행하여 기본 `GET /` 경로로 HTML, CSS, JavaScript가 포함된 웹 페이지를 렌더링합니다.
   * `app.use(express.static(__dirname))` 설정을 통해 프로젝트 폴더 내에 있는 이미지(`map.png` 등)를 클라이언트가 불러올 수 있도록 정적 파일 서버로 동작하게 했습니다.

2. **실시간 양방향 통신 (Socket.IO)**
   * 클라이언트가 접속하면 소켓 ID(`socket.id`)를 키로 사용하여 `players` 객체에 새로운 플레이어를 추가합니다.
   * 초기 위치는 블루팀 진영 근처(`x: 220, y: MAP_SIZE - 220`)로 설정되어 있습니다.
   * 클라이언트는 키보드(방향키) 입력 상태가 변할 때마다 `keyMove` 이벤트를 통해 이동 방향(`dirX`, `dirY`)을 서버로 전송합니다.

3. **서버 측 이동 계산 (Server-side Movement Logic)**
   * `setInterval`을 사용해 초당 60회(60 FPS) 주기적인 게임 루프를 돌립니다.
   * 대각선 이동 시 이동 속도가 빨라지는 현상을 방지하기 위해 $1/\sqrt{2} \approx 0.7071$을 곱하여 속도를 정규화했습니다.
   * 플레이어가 `MAP_SIZE(2000px)` 경계 외곽으로 나가지 못하도록 맵 범위 제한(Boundaries) 처리가 되어 있습니다.
   * 계산된 모든 플레이어와 구조물 데이터를 주기적으로 모든 클라이언트에게 전송(`io.emit('gameState')`)합니다.

4. **HTML5 Canvas 클라이언트 렌더링**
   * **카메라 시점 이동:** 접속한 사용자(나)의 좌표를 중심으로 화면이 따라오도록 `ctx.translate(canvas.width / 2 - me.x, canvas.height / 2 - me.y)`를 적용하여 스크롤 효과를 연출했습니다.
   * **맵 이미지 및 대안 처리:** `/map.png` 이미지를 로드하여 배경에 그리고, 로딩 전이나 이미지 파일이 없을 경우 "맵 이미지 로딩 중..." 안내 문구를 표시하도록 구현되었습니다.
   * **구조물 및 캐릭터 렌더링:** 서버에서 받아온 포탑(`turret`), 억제기(`inh`), 플레이어 위치를 원/사각형 도형으로 매 프레임 그려줍니다.

---

### 개선 및 확장 아이디어 (추가 구현 시 참고)

* **이미지 로딩 최적화:** 클라이언트 측에서 `mapImage.src`를 설정한 후, 이미지가 준비 완료되면 렌더링하도록 렌der 루프를 독립시키는 방식도 좋습니다.
* **충돌 처리 (Collision Detection):** 포탑이나 억제기 위치에 플레이어가 겹치지 못하도록 맵 경계 체크 외에 구조물 영역 충돌 로직을 서버에 추가해볼 수 있습니다.
* **팀 구분:** 현재 접속자는 무조건 블루팀 시작 위치에서 시작하며 식별은 '나'와 '적'으로만 되어 있습니다. 접속 순서나 선택에 따라 블루팀/레드팀을 배정하고 팀 색상을 동적으로 부여할 수 있습니다.
