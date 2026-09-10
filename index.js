const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>가렌 2D - LOL 스타일 맵</title>
    <style>
        body { margin: 0; padding: 0; background: #0b0e14; font-family: 'Malgun Gothic', sans-serif; overflow: hidden; user-select: none; }
        #join-screen { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(11, 14, 20, 0.95); display: flex; flex-direction: column; justify-content: center; align-items: center; z-index: 100; }
        .join-box { background: #121926; border: 2px solid #c8aa6e; padding: 40px; border-radius: 8px; text-align: center; box-shadow: 0 0 20px rgba(0,0,0,0.8); }
        .join-box h1 { color: #f0e6d2; margin-bottom: 30px; font-size: 28px; text-shadow: 0 0 10px #c8aa6e; }
        .join-box input { width: 80%; padding: 12px; border: 1px solid #463714; background: #091428; color: #f0e6d2; font-size: 16px; text-align: center; margin-bottom: 20px; outline: none; }
        .join-box input:focus { border-color: #c8aa6e; }
        .join-box button { width: 88%; padding: 12px; background: linear-gradient(to bottom, #1e2328, #111318); border: 1px solid #c8aa6e; color: #c8aa6e; font-size: 18px; font-weight: bold; cursor: pointer; transition: 0.2s; }
        .join-box button:hover { background: #c8aa6e; color: #111318; }
        
        #game-container { position: relative; width: 100vw; height: 100vh; display: none; }
        canvas { display: block; width: 100%; height: 100%; }
        
        /* UI 및 HUD 설정 */
        #hud { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); display: flex; gap: 15px; background: rgba(1, 10, 19, 0.85); border: 2px solid #785a28; padding: 10px; border-radius: 10px; box-shadow: 0 0 15px rgba(0,0,0,0.8); }
        .skill-icon { position: relative; width: 60px; height: 60px; background: #091428; border: 2px solid #463714; border-radius: 5px; display: flex; justify-content: center; align-items: center; color: #f0e6d2; font-weight: bold; font-size: 20px; }
        .skill-icon .key { position: absolute; top: 2px; left: 5px; font-size: 12px; color: #c8aa6e; }
        .cooldown-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.7); display: flex; justify-content: center; align-items: center; color: #ff4e50; font-size: 18px; font-weight: bold; border-radius: 3px; display: none; }
        
        /* 관리자 테스트 UI */
        #admin-test-panel { position: absolute; bottom: 100px; left: 50%; transform: translateX(-50%); display: none; gap: 10px; background: rgba(0,0,0,0.8); padding: 8px 15px; border: 1px solid #f39c12; border-radius: 5px; z-index: 50; }
        .admin-btn { background: #d35400; border: 1px solid #f39c12; color: #fff; padding: 6px 12px; font-weight: bold; cursor: pointer; border-radius: 4px; }
        .admin-btn:hover { background: #e67e22; }

        /* 소환사 정보 HUD */
        #champ-portrait { width: 60px; height: 60px; border: 2px solid #c8aa6e; border-radius: 5px; background: #000; overflow: hidden; }
        #champ-portrait img { width: 100%; height: 100%; object-fit: cover; }
        
        /* 채팅 UI */
        #chat-box { position: absolute; bottom: 20px; left: 20px; width: 320px; height: 220px; background: rgba(1, 10, 19, 0.7); border: 1px solid #463714; border-radius: 5px; display: flex; flex-direction: column; }
        #chat-messages { flex: 1; padding: 10px; overflow-y: auto; color: #f0e6d2; font-size: 13px; display: flex; flex-direction: column; gap: 4px; }
        #chat-input-container { display: flex; border-top: 1px solid #463714; }
        #chat-input { flex: 1; background: transparent; border: none; padding: 8px; color: #fff; outline: none; font-size: 12px; }
        #chat-type { background: #091428; color: #c8aa6e; border: none; padding: 0 5px; font-size: 11px; cursor: pointer; border-right: 1px solid #463714; }

        /* 스코어보드 및 탭 */
        #scoreboard { position: absolute; top: 10px; right: 10px; background: rgba(1, 10, 19, 0.8); border: 1px solid #785a28; padding: 8px 15px; border-radius: 5px; color: #f0e6d2; font-size: 14px; font-weight: bold; }
        
        /* 유저 리스트 (강퇴버튼 전용) */
        #user-list { position: absolute; top: 50px; right: 10px; background: rgba(1, 10, 19, 0.8); border: 1px solid #785a28; padding: 10px; border-radius: 5px; color: #fff; font-size: 12px; max-height: 200px; overflow-y: auto; display: none; }
        .user-item { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 5px; }
        .kick-btn { background: #e74c3c; border: none; color: white; padding: 2px 6px; border-radius: 3px; cursor: pointer; font-size: 10px; }
    </style>
</head>
<body>

    <div id="join-screen">
        <div class="join-box">
            <h1>소환사의 골짜기 입장</h1>
            <input type="text" id="nickname" placeholder="소환사 이름 (최대 8자)" maxlength="8">
            <button onclick="joinGame()">전장 참여</button>
        </div>
    </div>

    <div id="game-container">
        <canvas id="gameCanvas"></canvas>
        
        <div id="scoreboard">
            <span style="color: #2b6cb0;">블루 <span id="blue-score">0</span></span> vs 
            <span style="color: #c53030;">레드 <span id="red-score">0</span></span>
        </div>

        <div id="user-list"></div>

        <!-- 개발자 전용 테스트 버튼 -->
        <div id="admin-test-panel">
            <button class="admin-btn" onclick="triggerAdminCooldownReset()">쿨타임 초기화</button>
            <button class="admin-btn" onclick="triggerAdminSpeedBoost()">이속 5배 Toggle</button>
        </div>

        <div id="hud">
            <div id="champ-portrait">
                <img src="/web.webp" alt="가렌">
            </div>
            <div class="skill-icon" id="icon-q"><span class="key">Q</span>Q<div class="cooldown-overlay" id="cd-q"></div></div>
            <div class="skill-icon" id="icon-w"><span class="key">W</span>W<div class="cooldown-overlay" id="cd-w"></div></div>
            <div class="skill-icon" id="icon-e"><span class="key">E</span>E<div class="cooldown-overlay" id="cd-e"></div></div>
            <div class="skill-icon" id="icon-r"><span class="key">R</span>R<div class="cooldown-overlay" id="cd-r"></div></div>
            <div class="skill-icon" id="icon-b"><span class="key">B</span>귀환<div class="cooldown-overlay" id="cd-b"></div></div>
        </div>

        <div id="chat-box">
            <div id="chat-messages"></div>
            <div id="chat-input-container">
                <button id="chat-type" onclick="toggleChatType()"> 전체 </button>
                <input type="text" id="chat-input" placeholder="메시지 입력... (Enter)" maxlength="50">
            </div>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let myId = null;
        let players = {};
        let mapData = null;
        let isChatTypeTeam = false;

        const canvas = document.getElementById('gameCanvas');
        const ctx = canvas.getContext('2d');

        function resizeCanvas() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();

        function joinGame() {
            const name = document.getElementById('nickname').value.trim();
            if(!name) return alert("닉네임을 입력하세요!");
            
            socket.emit('join', { name });
            document.getElementById('join-screen').style.display = 'none';
            document.getElementById('game-container').style.display = 'block';

            if (name === '박준우') {
                document.getElementById('user-list').style.display = 'block';
                document.getElementById('admin-test-panel').style.display = 'flex';
            }
        }

        // 채팅 타입 토글 (전체 / 팀)
        function toggleChatType() {
            isChatTypeTeam = !isChatTypeTeam;
            const btn = document.getElementById('chat-type');
            btn.innerText = isChatTypeTeam ? " 팀 " : " 전체 ";
            btn.style.color = isChatTypeTeam ? "#3182ce" : "#c8aa6e";
        }

        // 입력 처리
        const keys = { w: false, a: false, s: false, d: false };
        window.addEventListener('keydown', (e) => {
            if(document.activeElement === document.getElementById('chat-input')) {
                if(e.key === 'Enter') sendChatMessage();
                return;
            }

            const k = e.key.toLowerCase();
            if(k === 'w' || k === 'a' || k === 's' || k === 'd' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                if(k === 'w' || e.key === 'ArrowUp') keys.w = true;
                if(k === 'a' || e.key === 'ArrowLeft') keys.a = true;
                if(k === 's' || e.key === 'ArrowDown') keys.s = true;
                if(k === 'd' || e.key === 'ArrowRight') keys.d = true;
                sendMove();
            }

            if(k === 'q') socket.emit('useSkill', { skill: 'Q' });
            if(k === 'w' && !keys.w) socket.emit('useSkill', { skill: 'W' });
            if(k === 'e') socket.emit('useSkill', { skill: 'E' });
            if(k === 'r') socket.emit('useSkill', { skill: 'R' });
            if(k === 'b') socket.emit('useSkill', { skill: 'B' });
            if(e.key === 'Enter') document.getElementById('chat-input').focus();
        });

        window.addEventListener('keyup', (e) => {
            const k = e.key.toLowerCase();
            if(k === 'w' || k === 'a' || k === 's' || k === 'd' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                if(k === 'w' || e.key === 'ArrowUp') keys.w = false;
                if(k === 'a' || e.key === 'ArrowLeft') keys.a = false;
                if(k === 's' || e.key === 'ArrowDown') keys.s = false;
                if(k === 'd' || e.key === 'ArrowRight') keys.d = false;
                sendMove();
            }
        });

        // 마우스 클릭 시 일반 공격
        window.addEventListener('mousedown', (e) => {
            if(e.target !== canvas) return;
            
            // 화면 중심 기준 마우스 좌표로 공격 방향 전달
            const me = players[myId];
            if(!me) return;
            
            const mouseX = e.clientX - canvas.width / 2;
            const mouseY = e.clientY - canvas.height / 2;
            const angle = Math.atan2(mouseY, mouseX);

            socket.emit('attack', { angle });
        });

        function sendMove() {
            let dx = 0; let dy = 0;
            if(keys.w) dy -= 1;
            if(keys.s) dy += 1;
            if(keys.a) dx -= 1;
            if(keys.d) dx += 1;
            socket.emit('move', { dx, dy });
        }

        function sendChatMessage() {
            const input = document.getElementById('chat-input');
            const msg = input.value.trim();
            if(msg) {
                socket.emit('chat', { text: msg, isTeam: isChatTypeTeam });
                input.value = '';
            }
            input.blur();
        }

        // 개발자 명령 처리 함수
        function triggerAdminCooldownReset() {
            socket.emit('adminAction', { type: 'resetCooldown' });
        }
        function triggerAdminSpeedBoost() {
            socket.emit('adminAction', { type: 'toggleSpeedBoost' });
        }

        // 소켓 이벤트 리스너
        socket.on('init', (data) => {
            myId = data.id;
            mapData = data.mapData;
        });

        socket.on('updateState', (data) => {
            players = data.players;
            updateHUD();
            updateUserList();
            render();
        });

        socket.on('chatMessage', (data) => {
            const box = document.getElementById('chat-messages');
            const el = document.createElement('div');
            el.style.color = data.isTeam ? '#63b3ed' : '#f0e6d2';
            el.innerHTML = `<strong>[${data.team === 'blue' ? '블루' : '레드'}] ${data.sender}:</strong> ${data.text}`;
            box.appendChild(el);
            box.scrollTop = box.scrollHeight;
        });

        function updateUserList() {
            const me = players[myId];
            if(!me || me.name !== '박준우') return;
            
            const listEl = document.getElementById('user-list');
            listEl.innerHTML = '<strong>소환사 목록 (강퇴)</strong>';
            
            Object.values(players).forEach(p => {
                if(p.id === myId) return;
                const item = document.createElement('div');
                item.className = 'user-item';
                item.innerHTML = `
                    <span>${p.name} (${p.team})</span>
                    <button class="kick-btn" onclick="kickUser('${p.id}')">강퇴</button>
                `;
                listEl.appendChild(item);
            });
        }

        function kickUser(targetId) {
            socket.emit('kickUser', { targetId });
        }

        function updateHUD() {
            const me = players[myId];
            if(!me) return;

            const skills = ['q', 'w', 'e', 'r', 'b'];
            skills.forEach(s => {
                const overlay = document.getElementById(\`cd-\${s}\`);
                const cd = me.cooldowns[s];
                if(cd > 0) {
                    overlay.style.display = 'flex';
                    overlay.innerText = (cd / 1000).toFixed(1);
                } else {
                    overlay.style.display = 'none';
                }
            });
        }

        // 렌더링 루프
        function render() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const me = players[myId];
            if(!me || !mapData) return;

            // 카메라 중심 맞추기
            const camX = me.x - canvas.width / 2;
            const camY = me.y - canvas.height / 2;

            ctx.save();
            ctx.translate(-camX, -camY);

            // 1. 맵 지형 렌더링 (소환사의 골짜기 컨셉)
            // 전체 배경 (풀숲/땅)
            ctx.fillStyle = "#2d4a1d";
            ctx.fillRect(0, 0, mapData.size, mapData.size);

            // 라인 (도로)
            ctx.strokeStyle = "#5a4d3b";
            ctx.lineWidth = 120;
            ctx.lineCap = "round";
            
            // 탑 라인
            ctx.beginPath();
            ctx.moveTo(150, mapData.size - 150);
            ctx.lineTo(150, 150);
            ctx.lineTo(mapData.size - 150, 150);
            ctx.stroke();

            // 미드 라인
            ctx.beginPath();
            ctx.moveTo(150, mapData.size - 150);
            ctx.lineTo(mapData.size - 150, 150);
            ctx.stroke();

            // 봇 라인
            ctx.beginPath();
            ctx.moveTo(150, mapData.size - 150);
            ctx.lineTo(mapData.size - 150, mapData.size - 150);
            ctx.lineTo(mapData.size - 150, 150);
            ctx.stroke();

            // 강 (River)
            ctx.strokeStyle = "#1a365d";
            ctx.lineWidth = 150;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(mapData.size, mapData.size);
            ctx.stroke();

            // 우물 (본진)
            // 블루팀 우물
            ctx.fillStyle = "rgba(43, 108, 176, 0.4)";
            ctx.beginPath(); ctx.arc(0, mapData.size, mapData.fountainRadius, 0, Math.PI*2); ctx.fill();
            // 레드팀 우물
            ctx.fillStyle = "rgba(197, 48, 48, 0.4)";
            ctx.beginPath(); ctx.arc(mapData.size, 0, mapData.fountainRadius, 0, Math.PI*2); ctx.fill();

            // 충돌 장애물 (포탑, 넥서스 등)
            mapData.colliders.forEach(c => {
                ctx.fillStyle = c.team === 'blue' ? '#3182ce' : (c.team === 'red' ? '#e53e3e' : '#718096');
                ctx.beginPath();
                ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = "#1a202c";
                ctx.lineWidth = 4;
                ctx.stroke();
            });

            // 2. 플레이어 및 스킬 이펙트 렌더링
            Object.values(players).forEach(p => {
                if(p.isDead) return; // 사망한 유저는 그리지 않음

                // E스킬 회전 이펙트 (심판)
                if(p.eActive) {
                    ctx.save();
                    ctx.translate(p.x, p.y);
                    ctx.beginPath();
                    ctx.arc(0, 0, p.eRadius, 0, Math.PI * 2);
                    ctx.fillStyle = "rgba(236, 201, 75, 0.25)";
                    ctx.fill();
                    ctx.strokeStyle = "#d69e2e";
                    ctx.lineWidth = 5;
                    ctx.setLineDash([15, 15]);
                    ctx.stroke();
                    ctx.restore();
                }

                // 플레이어 본체 (가렌 원형)
                ctx.save();
                ctx.translate(p.x, p.y);

                // 팀별 테두리 및 색상
                ctx.beginPath();
                ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
                ctx.fillStyle = p.team === 'blue' ? '#2b6cb0' : '#c53030';
                ctx.fill();
                ctx.lineWidth = 3;
                ctx.strokeStyle = p.qBuff ? '#ecc94b' : '#edf2f7'; // Q 버프 활성화시 황금색 테두리
                ctx.stroke();

                // 시선 방향 표시
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(Math.cos(p.angle) * p.radius, Math.sin(p.angle) * p.radius);
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 3;
                ctx.stroke();

                // W스킬 보호막 이펙트
                if(p.shield > 0) {
                    ctx.beginPath();
                    ctx.arc(0, 0, p.radius + 6, 0, Math.PI * 2);
                    ctx.strokeStyle = "rgba(66, 153, 225, 0.8)";
                    ctx.lineWidth = 4;
                    ctx.stroke();
                }

                // 귀환(B) 채널링 이펙트
                if(p.isRecalling) {
                    ctx.beginPath();
                    ctx.arc(0, 0, p.radius + 12, 0, Math.PI * 2);
                    ctx.strokeStyle = "#4299e1";
                    ctx.lineWidth = 2;
                    ctx.setLineDash([5, 5]);
                    ctx.stroke();
                }

                ctx.restore();

                // 체력바 및 닉네임
                // 체력바 배경
                ctx.fillStyle = 'rgba(0,0,0,0.6)';
                ctx.fillRect(p.x - 30, p.y - p.radius - 22, 60, 8);
                // 현재 체력
                const hpPercent = Math.max(0, p.hp / p.maxHp);
                ctx.fillStyle = p.team === me.team ? '#48bb78' : '#f56565';
                ctx.fillRect(p.x - 30, p.y - p.radius - 22, 60 * hpPercent, 8);
                // 체력바 테두리
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 1;
                ctx.strokeRect(p.x - 30, p.y - p.radius - 22, 60, 8);

                // 보호막 표시
                if(p.shield > 0) {
                    const shieldPercent = Math.min(1, p.shield / p.maxHp);
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                    ctx.fillRect(p.x - 30 + (60 * hpPercent), p.y - p.radius - 22, 60 * shieldPercent, 8);
                }

                // 닉네임 및 방어력 약화 디버프 표시
                ctx.fillStyle = '#fff';
                ctx.font = '12px Malgun Gothic';
                ctx.textAlign = 'center';
                let displayName = p.name;
                if(p.armorShredStacks > 0) displayName += \` (방깎 \${p.armorShredStacks})\`;
                ctx.fillText(displayName, p.x, p.y - p.radius - 28);
            });

            // 3. 궁극기(R) 이펙트 렌더링 - 머리 위에서 떨어지는 빛나는 100% 황금색 검
            Object.values(players).forEach(p => {
                if(p.rVisualEffect) {
                    const eff = p.rVisualEffect;
                    ctx.save();
                    ctx.translate(eff.x, eff.y);

                    // 타겟의 머리 위에서 떨어지도록 Y축 Offset 적용 (상대 몸과 닿지 않음)
                    const hoverOffset = -70;
                    const dropOffset = (1 - eff.progress) * -160; 
                    const currentY = hoverOffset + dropOffset;

                    // 100% 순수 황금색 그라데이션 (다른 색상 없음)
                    ctx.shadowColor = "#FFD700";
                    ctx.shadowBlur = 30;

                    const swordGrad = ctx.createLinearGradient(0, currentY - 60, 0, currentY + 30);
                    swordGrad.addColorStop(0, "#FFFFE0"); // 밝은 황금빛 백색
                    swordGrad.addColorStop(0.5, "#FFD700"); // 순수 골드
                    swordGrad.addColorStop(1, "#B8860B"); // 진한 황금색

                    ctx.fillStyle = swordGrad;
                    ctx.strokeStyle = "#FFE87C";
                    ctx.lineWidth = 3;

                    // 대검 형상 그리기
                    ctx.beginPath();
                    // 검끝 (아래쪽)
                    ctx.moveTo(0, currentY + 30);
                    ctx.lineTo(-10, currentY + 10);
                    ctx.lineTo(-12, currentY - 50);
                    ctx.lineTo(0, currentY - 70); // 칼날 끝
                    ctx.lineTo(12, currentY - 50);
                    ctx.lineTo(10, currentY + 10);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();

                    // 황금색 검 자루 (Guard)
                    ctx.fillStyle = "#FFD700";
                    ctx.fillRect(-22, currentY + 10, 44, 8);

                    // 황금색 충격파 잔상
                    ctx.beginPath();
                    ctx.arc(0, hoverOffset, 40 * eff.progress, 0, Math.PI * 2);
                    ctx.strokeStyle = `rgba(255, 215, 0, ${1 - eff.progress})`;
                    ctx.lineWidth = 6;
                    ctx.stroke();

                    ctx.restore();
                }
            });

            ctx.restore(); // 카메라 변환 복구

            // 4. 미니맵 렌더링 (우측 하단)
            const miniSize = 150;
            const miniX = canvas.width - miniSize - 20;
            const miniY = canvas.height - miniSize - 20;

            ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
            ctx.fillRect(miniX, miniY, miniSize, miniSize);
            ctx.strokeStyle = "#785a28";
            ctx.lineWidth = 2;
            ctx.strokeRect(miniX, miniY, miniSize, miniSize);

            // 미니맵 유저 표시
            Object.values(players).forEach(p => {
                if(p.isDead) return;
                const mx = miniX + (p.x / mapData.size) * miniSize;
                const my = miniY + (p.y / mapData.size) * miniSize;

                ctx.fillStyle = p.team === 'blue' ? '#3182ce' : '#e53e3e';
                ctx.beginPath();
                ctx.arc(mx, my, p.id === myId ? 4 : 2.5, 0, Math.PI * 2);
                ctx.fill();
            });
        }
    </script>
</body>
</html>
    `);
});

// 백엔드 게임 로직
const MAP_SIZE = 2000;
const FOUNTAIN_RADIUS = 250;

// 지형 장애물 (소환사의 골짜기 타워/넥서스 위치 컨셉)
const colliders = [
    // 블루팀 포탑/건물
    { x: 300, y: MAP_SIZE - 300, radius: 40, team: 'blue' },
    { x: 300, y: MAP_SIZE - 800, radius: 35, team: 'blue' },
    { x: 800, y: MAP_SIZE - 300, radius: 35, team: 'blue' },
    { x: 700, y: MAP_SIZE - 700, radius: 35, team: 'blue' },
    
    // 레드팀 포탑/건물
    { x: MAP_SIZE - 300, y: 300, radius: 40, team: 'red' },
    { x: MAP_SIZE - 300, y: 800, radius: 35, team: 'red' },
    { x: MAP_SIZE - 800, y: 300, radius: 35, team: 'red' },
    { x: MAP_SIZE - 700, y: 700, radius: 35, team: 'red' },
    
    // 중앙 바위 장애물
    { x: MAP_SIZE/2 - 200, y: MAP_SIZE/2 - 100, radius: 50, team: 'neutral' },
    { x: MAP_SIZE/2 + 200, y: MAP_SIZE/2 + 100, radius: 50, team: 'neutral' }
];

const players = {};
let scores = { blue: 0, red: 0 };

// 팀 우물 위치
const FOUNTAIN_POS = {
    blue: { x: 100, y: MAP_SIZE - 100 },
    red: { x: MAP_SIZE - 100, y: 100 }
};

io.on('connection', (socket) => {
    socket.on('join', (data) => {
        // 팀 자동 균형 배정
        const blueCount = Object.values(players).filter(p => p.team === 'blue').length;
        const redCount = Object.values(players).filter(p => p.team === 'red').length;
        const team = blueCount <= redCount ? 'blue' : 'red';

        const startPos = FOUNTAIN_POS[team];

        players[socket.id] = {
            id: socket.id,
            name: data.name || '가렌',
            team: team,
            x: startPos.x,
            y: startPos.y,
            radius: 24,
            speed: 4,
            adminSpeedBoost: false,
            hp: 620,
            maxHp: 620,
            baseArmor: 38,
            bonusArmor: 0,
            baseMR: 32,
            bonusMR: 0,
            angle: 0,
            isDead: false,
            respawnTimer: 0,
            
            // 입력 상태
            dx: 0,
            dy: 0,

            // 스킬 상태 및 쿨타임 (ms)
            cooldowns: { q: 0, w: 0, e: 0, r: 0, b: 0 },
            
            // 버프/디버프 상태
            qBuff: false,
            qTimer: 0,
            wActive: false,
            wShieldTimer: 0,
            wDRTimer: 0,
            shield: 0,
            eActive: false,
            eTimer: 0,
            eTicks: 0,
            eRadius: 120,
            armorShredStacks: 0,
            armorShredTimer: 0,
            
            // 귀환 상태
            isRecalling: false,
            recallTimer: 0,

            // 시각 효과
            rVisualEffect: null
        };

        socket.emit('init', {
            id: socket.id,
            mapData: { size: MAP_SIZE, fountainRadius: FOUNTAIN_RADIUS, colliders }
        });
    });

    socket.on('move', (data) => {
        const p = players[socket.id];
        if(!p || p.isDead) return;

        p.dx = data.dx;
        p.dy = data.dy;

        // 이동 시 귀환 취소
        if((p.dx !== 0 || p.dy !== 0) && p.isRecalling) {
            p.isRecalling = false;
            p.recallTimer = 0;
        }

        if(p.dx !== 0 || p.dy !== 0) {
            p.angle = Math.atan2(p.dy, p.dx);
        }
    });

    socket.on('attack', (data) => {
        const p = players[socket.id];
        if(!p || p.isDead) return;

        p.angle = data.angle;

        // 귀환 취소
        if(p.isRecalling) {
            p.isRecalling = false;
            p.recallTimer = 0;
        }

        // 기본 공격 사거리 및 타겟 판정
        const range = p.qBuff ? 80 : 50;
        const attackDamage = p.qBuff ? 90 + Math.random()*20 : 45;

        Object.values(players).forEach(target => {
            if(target.id === p.id || target.team === p.team || target.isDead) return;

            const dist = Math.hypot(target.x - p.x, target.y - p.y);
            if(dist <= p.radius + target.radius + range) {
                // 공격 성공
                applyDamage(p, target, attackDamage, 'physical');
                
                // Q스킬 강화 평타 적용시 초기화
                if(p.qBuff) {
                    p.qBuff = false;
                    p.qTimer = 0;
                }
            }
        });
    });

    socket.on('useSkill', (data) => {
        const p = players[socket.id];
        if(!p || p.isDead) return;

        const skill = data.skill.toLowerCase();

        // Q 스킬: 결의의 일격 (이속증가 랜덤 지속시간, 다음평타 강화)
        if(skill === 'q' && p.cooldowns.q <= 0) {
            p.qBuff = true;
            // 이동속도 증가 지속시간 랜덤 (1.5초 ~ 3.5초)
            const randomDuration = 1500 + Math.random() * 2000;
            p.qTimer = randomDuration;
            p.cooldowns.q = 8000; // 쿨타임 8초
            if(p.isRecalling) { p.isRecalling = false; p.recallTimer = 0; }
        }

        // W 스킬: 용기 (보호막 후 데미지 감소)
        if(skill === 'w' && p.cooldowns.w <= 0) {
            p.wActive = true;
            p.shield = 100 + (p.maxHp * 0.1);
            p.wShieldTimer = 2000; // 2초간 보호막
            p.wDRTimer = 4000; // 4초간 피해 감소
            p.cooldowns.w = 15000;
            if(p.isRecalling) { p.isRecalling = false; p.recallTimer = 0; }
        }

        // E 스킬: 심판 (회전 지속 딜링 및 방어력 감소)
        if(skill === 'e' && p.cooldowns.e <= 0) {
            p.eActive = true;
            p.eTimer = 3000; // 3초간 지속
            p.eTicks = 0;
            p.cooldowns.e = 9000;
            if(p.isRecalling) { p.isRecalling = false; p.recallTimer = 0; }
        }

        // R 스킬: 데마시아의 정의 (궁극기 - 체력 30% 이하 즉사, 머리 위 황금검 낙하)
        if(skill === 'r' && p.cooldowns.r <= 0) {
            // 바라보는 방향 사거리 내 가장 가까운 적 타겟팅
            let closestTarget = null;
            let minDist = 300; // R 사거리

            Object.values(players).forEach(target => {
                if(target.id === p.id || target.team === p.team || target.isDead) return;
                
                const dist = Math.hypot(target.x - p.x, target.y - p.y);
                if(dist <= minDist) {
                    minDist = dist;
                    closestTarget = target;
                }
            });

            if(closestTarget) {
                p.cooldowns.r = 80000; // 80초 쿨타임
                if(p.isRecalling) { p.isRecalling = false; p.recallTimer = 0; }

                // 연출용 시각효과 생성
                const targetRef = closestTarget;
                p.rVisualEffect = {
                    x: targetRef.x,
                    y: targetRef.y,
                    progress: 0
                };

                // 궁극기 데미지 판정 (0.5초 후 낙하 완료 시점)
                setTimeout(() => {
                    if(targetRef && !targetRef.isDead) {
                        const targetHpRatio = targetRef.hp / targetRef.maxHp;
                        
                        if(targetHpRatio <= 0.30) {
                            // 체력 30% 이하 조건 즉사
                            applyDamage(p, targetRef, 99999, 'true');
                        } else {
                            // 기본 고정 데미지 + 잃은 체력 비례 데미지
                            const missingHp = targetRef.maxHp - targetRef.hp;
                            const rDamage = 150 + (missingHp * 0.25);
                            applyDamage(p, targetRef, rDamage, 'true');
                        }
                    }
                }, 500);
            }
        }

        // B 스킬: 귀환 (8초)
        if(skill === 'b' && p.cooldowns.b <= 0) {
            p.isRecalling = true;
            p.recallTimer = 8000;
        }
    });

    // 개발자 테스트 기능 처리 ('박준우' 전용)
    socket.on('adminAction', (data) => {
        const p = players[socket.id];
        if(!p || p.name !== '박준우') return;

        if(data.type === 'resetCooldown') {
            p.cooldowns = { q: 0, w: 0, e: 0, r: 0, b: 0 };
        } else if(data.type === 'toggleSpeedBoost') {
            p.adminSpeedBoost = !p.adminSpeedBoost;
        }
    });

    socket.on('chat', (data) => {
        const p = players[socket.id];
        if(!p) return;

        if(data.isTeam) {
            // 팀 채팅
            Object.values(io.sockets.sockets).forEach(s => {
                const targetP = players[s.id];
                if(targetP && targetP.team === p.team) {
                    s.emit('chatMessage', { sender: p.name, text: data.text, team: p.team, isTeam: true });
                }
            });
        } else {
            // 전체 채팅
            io.emit('chatMessage', { sender: p.name, text: data.text, team: p.team, isTeam: false });
        }
    });

    socket.on('kickUser', (data) => {
        const p = players[socket.id];
        if(p && p.name === '박준우' && data.targetId) {
            const targetSocket = io.sockets.sockets.get(data.targetId);
            if(targetSocket) {
                targetSocket.disconnect();
            }
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
    });
});

// 데미지 계산 및 적용 함수
function applyDamage(attacker, defender, damage, type) {
    if(defender.isDead) return;

    // 귀환 중 피격시 귀환 취소
    if(defender.isRecalling) {
        defender.isRecalling = false;
        defender.recallTimer = 0;
    }

    let finalDamage = damage;

    // 방어력/마법저항력 및 디버프 계산
    if(type === 'physical') {
        const totalArmor = Math.max(0, (defender.baseArmor + defender.bonusArmor) * (1 - (defender.armorShredStacks * 0.04)));
        finalDamage = damage * (100 / (100 + totalArmor));
    } else if(type === 'magic') {
        const totalMR = defender.baseMR + defender.bonusMR;
        finalDamage = damage * (100 / (100 + totalMR));
    }

    // W 스킬 데미지 감쇄 (30% 감소)
    if(defender.wDRTimer > 0) {
        finalDamage *= 0.7;
    }

    // 보호막 차감 처리
    if(defender.shield > 0) {
        if(defender.shield >= finalDamage) {
            defender.shield -= finalDamage;
            finalDamage = 0;
        } else {
            finalDamage -= defender.shield;
            defender.shield = 0;
        }
    }

    defender.hp -= finalDamage;

    // 처치 판정
    if(defender.hp <= 0) {
        defender.hp = 0;
        defender.isDead = true;
        defender.respawnTimer = 7000; // 7초 후 부활

        // W 패시브: 적 처치 시 영구 방어력/마저 중첩 증가
        attacker.bonusArmor += 0.25;
        attacker.bonusMR += 0.25;

        // 스코어 증가
        if(attacker.team === 'blue') scores.blue++;
        else scores.red++;
    }
}

// 메인 게임 루프 (60 FPS)
setInterval(() => {
    const dt = 1000 / 60;

    Object.values(players).forEach(p => {
        // 부활 타이머 처리 및 부활 시 쿨타임 초기화
        if(p.isDead) {
            p.respawnTimer -= dt;
            if(p.respawnTimer <= 0) {
                p.isDead = false;
                p.hp = p.maxHp;
                
                // 위치 복구
                const spawn = FOUNTAIN_POS[p.team];
                p.x = spawn.x;
                p.y = spawn.y;

                // [요청사항 반영] 부활 시 모든 스킬 쿨타임 초기화
                p.cooldowns = { q: 0, w: 0, e: 0, r: 0, b: 0 };
            }
            return;
        }

        // 쿨타임 감소
        Object.keys(p.cooldowns).forEach(k => {
            if(p.cooldowns[k] > 0) p.cooldowns[k] -= dt;
        });

        // 이동속도 계산 (개발자 5배 이속 적용)
        let currentSpeed = p.speed;
        if(p.adminSpeedBoost) currentSpeed *= 5; // 박준우 전용 5배 이속
        if(p.qTimer > 0) currentSpeed *= 1.35; // Q스킬 이동속도 35% 증가

        // 위치 이동 및 충돌 처리
        if(p.dx !== 0 || p.dy !== 0) {
            const moveLen = Math.hypot(p.dx, p.dy);
            const nx = p.x + (p.dx / moveLen) * currentSpeed;
            const ny = p.y + (p.dy / moveLen) * currentSpeed;

            // 맵 경계 충돌 체크
            if(nx >= p.radius && nx <= MAP_SIZE - p.radius) p.x = nx;
            if(ny >= p.radius && ny <= MAP_SIZE - p.radius) p.y = ny;

            // 지형 장애물 충돌 체크
            colliders.forEach(c => {
                const dist = Math.hypot(p.x - c.x, p.y - c.y);
                if(dist < p.radius + c.radius) {
                    const overlap = (p.radius + c.radius) - dist;
                    const angle = Math.atan2(p.y - c.y, p.x - c.x);
                    p.x += Math.cos(angle) * overlap;
                    p.y += Math.sin(angle) * overlap;
                }
            });
        }

        // 우물 내 체력 회복 (초당 20%)
        const fountain = FOUNTAIN_POS[p.team];
        if(Math.hypot(p.x - fountain.x, p.y - fountain.y) <= FOUNTAIN_RADIUS) {
            p.hp = Math.min(p.maxHp, p.hp + (p.maxHp * 0.2 * (dt / 1000)));
        }

        // 타이머 및 타이머 관련 버프 관리
        if(p.qTimer > 0) {
            p.qTimer -= dt;
            if(p.qTimer <= 0) p.qBuff = false;
        }

        if(p.wShieldTimer > 0) {
            p.wShieldTimer -= dt;
            if(p.wShieldTimer <= 0) p.shield = 0;
        }
        if(p.wDRTimer > 0) p.wDRTimer -= dt;

        // E 스킬 지속 데미지 및 방깎 중첩 로직
        if(p.eActive) {
            p.eTimer -= dt;
            p.eTicks += dt;

            // 0.2초마다 주위 적 공격
            if(p.eTicks >= 200) {
                p.eTicks = 0;
                Object.values(players).forEach(target => {
                    if(target.id === p.id || target.team === p.team || target.isDead) return;

                    if(Math.hypot(target.x - p.x, target.y - p.y) <= p.eRadius) {
                        applyDamage(p, target, 15, 'physical');
                        
                        // 방어력 감소 디버프 적용 (최대 6중첩)
                        if(target.armorShredStacks < 6) {
                            target.armorShredStacks++;
                        }
                        target.armorShredTimer = 6000; // 6초간 지속
                    }
                });
            }

            if(p.eTimer <= 0) p.eActive = false;
        }

        // 방깎 타이머
        if(p.armorShredTimer > 0) {
            p.armorShredTimer -= dt;
            if(p.armorShredTimer <= 0) p.armorShredStacks = 0;
        }

        // 귀환(B) 채널링 완료 처리
        if(p.isRecalling) {
            p.recallTimer -= dt;
            if(p.recallTimer <= 0) {
                p.isRecalling = false;
                const fountain = FOUNTAIN_POS[p.team];
                p.x = fountain.x;
                p.y = fountain.y;
            }
        }

        // R 시각효과 애니메이션 진행
        if(p.rVisualEffect) {
            p.rVisualEffect.progress += dt / 500;
            if(p.rVisualEffect.progress >= 1) {
                p.rVisualEffect = null;
            }
        }
    });

    // 클라이언트에 동기화
    io.emit('updateState', { players, scores });
}, 1000 / 60);

server.listen(3000, () => {
    console.log('가렌 게임 서버가 3000번 포트에서 실행 중입니다.');
});
