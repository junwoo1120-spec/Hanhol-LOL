const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const MAP_SIZE = 2000;
const players = {};

// 팀 밸런스 조정
function getBalancedTeam() {
  let blueCount = 0;
  let redCount = 0;
  for (let id in players) {
    if (players[id].team === 'blue') blueCount++;
    if (players[id].team === 'red') redCount++;
  }
  return blueCount <= redCount ? 'blue' : 'red';
}

// 장애물 충돌 검사
function isColliding(x, y) {
  return false;
}

// 우물 영역 체크 (팀별 우물 좌표 기준 반경 150 안)
function isInFountain(player) {
  const fountainX = player.team === 'blue' ? 100 : 1900;
  const fountainY = player.team === 'blue' ? 1900 : 100;
  const dx = player.x - fountainX;
  const dy = player.y - fountainY;
  return Math.sqrt(dx * dx + dy * dy) <= 150;
}

// 귀환 취소 공통 함수
function cancelRecall(player) {
  if (player.isRecalling) {
    player.isRecalling = false;
    player.recallStartTime = 0;
  }
}

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <title>Mini LoL - Garen Arena</title>
      <style>
        body { margin: 0; padding: 0; background: #000; overflow: hidden; font-family: sans-serif; user-select: none; }
        #game-container { position: relative; width: 100vw; height: 100vh; }
        canvas { display: block; width: 100%; height: 100%; }
        #hud { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; background: rgba(0,0,0,0.8); border: 2px solid #555; padding: 10px; border-radius: 8px; color: white; gap: 15px; }
        .skill-box { position: relative; width: 48px; height: 48px; border: 2px solid #aaa; border-radius: 6px; overflow: hidden; background: #222; }
        .skill-box canvas { width: 100%; height: 100%; }
        .cooldown-overlay { position: absolute; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.7); display: none; justify-content: center; align-items: center; font-weight: bold; font-size: 18px; color: #fff; }
        #minimap-container { position: absolute; bottom: 20px; right: 20px; width: 180px; height: 180px; border: 2px solid #555; background: #000; }
        #chat-box { position: absolute; bottom: 20px; left: 20px; width: 300px; height: 200px; background: rgba(0,0,0,0.6); border: 1px solid #444; border-radius: 6px; display: flex; flex-direction: column; }
        #chat-messages { flex: 1; overflow-y: auto; padding: 8px; font-size: 13px; color: #fff; word-break: break-all; }
        #chat-input { background: rgba(0,0,0,0.8); border: none; border-top: 1px solid #444; color: #fff; padding: 8px; outline: none; }
      </style>
      <script src="/socket.io/socket.io.js"></script>
    </head>
    <body>
      <div id="game-container">
        <canvas id="gameCanvas"></canvas>
        <div id="hud">
          <canvas id="portrait" width="48" height="48"></canvas>
          <div class="skill-box"><canvas id="icon-q"></canvas><div id="cd-q" class="cooldown-overlay"></div></div>
          <div class="skill-box"><canvas id="icon-w"></canvas><div id="cd-w" class="cooldown-overlay"></div></div>
          <div class="skill-box"><canvas id="icon-e"></canvas><div id="cd-e" class="cooldown-overlay"></div></div>
          <div class="skill-box"><canvas id="icon-r"></canvas><div id="cd-r" class="cooldown-overlay"></div></div>
        </div>
        <div id="minimap-container"><canvas id="minimap" width="180" height="180"></canvas></div>
        <div id="chat-box">
          <div id="chat-messages"></div>
          <input type="text" id="chat-input" placeholder="엔터키로 채팅 (Team: /t)" />
        </div>
      </div>

      <script>
        const username = prompt('닉네임을 입력하세요:', '플레이어' + Math.floor(Math.random() * 1000)) || '무명';
        const socket = io({ auth: { username } });

        const canvas = document.getElementById('gameCanvas');
        const ctx = canvas.getContext('2d');
        const portraitCtx = document.getElementById('portrait').getContext('2d');
        const miniCanvas = document.getElementById('minimap');
        const miniCtx = miniCanvas.getContext('2d');

        const MAP_SIZE = 2000;
        let dpr = window.devicePixelRatio || 1;
        let clientPlayers = {};
        let camX = 1000, camY = 1000;

        const mapImage = new Image();
        mapImage.src = 'https://via.placeholder.com/2000/102510/ffffff?text=LoL+Map';

        function resizeCanvas() {
          dpr = window.devicePixelRatio || 1;
          canvas.width = window.innerWidth * dpr;
          canvas.height = window.innerHeight * dpr;
        }
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();

        const keys = { KeyW: false, KeyA: false, KeyS: false, KeyD: false };
        function sendMove() {
          let x = 0, y = 0;
          if (keys.KeyW) y -= 1;
          if (keys.KeyS) y += 1;
          if (keys.KeyA) x -= 1;
          if (keys.KeyD) x += 1;
          socket.emit('keyMove', { x, y });
        }

        window.addEventListener('keydown', (e) => {
          if (document.activeElement === document.getElementById('chat-input')) return;
          if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
            keys[e.code] = true; sendMove();
          }
          if (e.code === 'KeyQ') socket.emit('useQ');
          if (e.code === 'KeyW' && !keys.KeyW) socket.emit('useW');
          if (e.code === 'KeyE') socket.emit('useE');
          if (e.code === 'KeyB') socket.emit('useB');
          if (e.code === 'Space') socket.emit('attack');
        });

        window.addEventListener('keyup', (e) => {
          if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
            keys[e.code] = false; sendMove();
          }
        });

        const chatInput = document.getElementById('chat-input');
        chatInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            let msg = chatInput.value.trim();
            if (msg) {
              let mode = 'all';
              if (msg.startsWith('/t ')) {
                mode = 'team';
                msg = msg.replace('/t ', '');
              }
              socket.emit('chatMessage', { text: msg, targetMode: mode });
              chatInput.value = '';
            }
          }
        });

        socket.on('chatMessage', (data) => {
          const messages = document.getElementById('chat-messages');
          const el = document.createElement('div');
          if (data.isSystem) el.style.color = '#eab308';
          else if (data.targetMode === 'team') el.style.color = '#38bdf8';
          else el.style.color = '#ffffff';
          el.innerText = '[' + data.username + ']: ' + data.text;
          messages.appendChild(el);
          messages.scrollTop = messages.scrollHeight;
        });

        socket.on('gameState', (data) => {
          clientPlayers = data.players;
          for (let id in clientPlayers) {
            const p = clientPlayers[id];
            p.renderX = p.x;
            p.renderY = p.y;
            p.renderAngle = Math.atan2(p.dirY, p.dirX) || 0;
          }
          drawGame();
          drawHUD();
          drawMinimap();
        });

        function drawGarenPortrait(c) {
          c.fillStyle = '#1e293b'; c.fillRect(0,0,48,48);
          c.fillStyle = '#3b82f6'; c.beginPath(); c.arc(24,20,12,0,Math.PI*2); c.fill();
        }

        function drawSimpleGaren(c, p) {
          c.fillStyle = p.team === 'blue' ? '#2563eb' : '#dc2626';
          c.beginPath(); c.arc(0, 0, 8, 0, Math.PI * 2); c.fill();
        }

        function drawHUD() {
          const me = clientPlayers[socket.id];
          if (!me) return;
          drawGarenPortrait(portraitCtx);
          const now = Date.now();

          const qCdBox = document.getElementById('cd-q');
          const qRemaining = Math.max(0, Math.ceil(((me.lastQTime + me.qCooldown) - now) / 1000));
          qCdBox.style.display = qRemaining > 0 ? 'flex' : 'none';
          if (qRemaining > 0) qCdBox.innerText = qRemaining;

          const wCdBox = document.getElementById('cd-w');
          const wRemaining = Math.max(0, Math.ceil(((me.lastWTime + me.wCooldown) - now) / 1000));
          wCdBox.style.display = wRemaining > 0 ? 'flex' : 'none';
          if (wRemaining > 0) wCdBox.innerText = wRemaining;

          const eCdBox = document.getElementById('cd-e');
          const eRemaining = Math.max(0, Math.ceil(((me.lastETime + me.eCooldown) - now) / 1000));
          eCdBox.style.display = eRemaining > 0 ? 'flex' : 'none';
          if (eRemaining > 0) eCdBox.innerText = eRemaining;
        }

        function drawGame() {
          const me = clientPlayers[socket.id];
          ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.save();
          
          if (me) {
            camX += (me.renderX - camX) * 0.2;
            camY += (me.renderY - camY) * 0.2;
            const cssWidth = canvas.width / dpr, cssHeight = canvas.height / dpr;
            ctx.scale(dpr, dpr); ctx.translate(cssWidth / 2, cssHeight / 2);
            ctx.scale(4.0, 4.0); ctx.translate(-camX, -camY);
          }

          if (mapImage.complete && mapImage.naturalWidth !== 0) {
            ctx.drawImage(mapImage, 0, 0, MAP_SIZE, MAP_SIZE);
          }

          for (let id in clientPlayers) {
            const p = clientPlayers[id];
            if (p.isDead) continue;

            ctx.save();
            ctx.translate(p.renderX, p.renderY);
            ctx.scale(1.3, 1.3);
            if (!p.isEActive) ctx.rotate(p.renderAngle);

            drawSimpleGaren(ctx, p);
            ctx.restore();

            const barWidth = 14;
            const barHeight = 2;
            const barX = p.renderX - barWidth / 2;
            const barY = p.renderY - 10;
            const hpRatio = Math.max(0, p.hp / p.maxHp);
            const shieldRatio = Math.min(1, p.shield / p.maxHp);

            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(barX - 0.5, barY - 0.5, barWidth + 1, barHeight + 1);

            ctx.fillStyle = (p.team === 'blue') ? '#22c55e' : '#ef4444';
            ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);

            if (p.shield > 0) {
              ctx.fillStyle = '#FFFFCC';
              const hpWidth = barWidth * hpRatio;
              ctx.fillRect(barX + hpWidth, barY, Math.min(barWidth - hpWidth, barWidth * shieldRatio), barHeight);
            }

            if (p.isArmorDebuffed) {
              ctx.fillStyle = '#A855F7';
              ctx.font = 'bold 3px sans-serif';
              ctx.fillText('🛡️-25%', p.renderX, p.renderY + 8);
            }

            if (p.isRecalling) {
              const recallLeft = Math.max(0, ((p.recallStartTime + 8000 - Date.now()) / 1000)).toFixed(1);
              ctx.fillStyle = '#38bdf8';
              ctx.font = 'bold 3.5px sans-serif';
              ctx.textAlign = 'center';
              ctx.fillText('귀환 중... (' + recallLeft + 's)', p.renderX, p.renderY - 18);
            }

            ctx.font = 'bold 4.5px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = (p.team === 'blue') ? '#38bdf8' : '#f87171';
            
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 0.8;
            ctx.strokeText(p.username, p.renderX, p.renderY - 13);
            ctx.fillText(p.username, p.renderX, p.renderY - 13);
          }
          ctx.restore();
        }

        function drawMinimap() {
          const scale = 180 / MAP_SIZE;
          miniCtx.fillStyle = '#111';
          miniCtx.fillRect(0, 0, 180, 180);

          if (mapImage.complete && mapImage.naturalWidth !== 0) {
            miniCtx.drawImage(mapImage, 0, 0, 180, 180);
          }

          const me = clientPlayers[socket.id];

          for (let id in clientPlayers) {
            const p = clientPlayers[id];
            if (p.isDead || (me && p.team !== me.team)) continue;

            const mx = p.renderX * scale;
            const my = p.renderY * scale;

            miniCtx.fillStyle = p.team === 'blue' ? '#00aaff' : '#ff4444';
            miniCtx.beginPath();
            miniCtx.arc(mx, my, 3.5, 0, Math.PI * 2);
            miniCtx.fill();
            miniCtx.strokeStyle = '#000000';
            miniCtx.lineWidth = 1;
            miniCtx.stroke();
          }

          if (me) {
            const cssWidth = canvas.width / dpr;
            const cssHeight = canvas.height / dpr;
            const viewW = (cssWidth / 4.0) * scale;
            const viewH = (cssHeight / 4.0) * scale;
            const viewX = (camX * scale) - (viewW / 2);
            const viewY = (camY * scale) - (viewH / 2);

            miniCtx.strokeStyle = '#ffffff';
            miniCtx.lineWidth = 1;
            miniCtx.strokeRect(viewX, viewY, viewW, viewH);
          }
        }
      </script>
    </body>
    </html>
  `);
});

io.use((socket, next) => {
  const username = socket.handshake.auth.username;
  if (!username) return next(new Error('닉네임이 올바르지 않습니다.'));
  socket.username = username;
  next();
});

io.on('connection', (socket) => {
  const team = getBalancedTeam();
  socket.join(team);

  const spawnX = team === 'blue' ? 100 : 1900;
  const spawnY = team === 'blue' ? 1900 : 100;

  players[socket.id] = { 
    x: spawnX, 
    y: spawnY, 
    dirX: 0, 
    dirY: 0,
    username: socket.username,
    team: team,
    isAttacking: false,
    attackProgress: 0,
    lastAttackTime: 0,

    isDead: false,
    respawnTime: 0,

    isRecalling: false,
    recallStartTime: 0,

    hp: 680,
    maxHp: 680,
    shield: 0,
    attackDamage: 68,
    armor: 38,
    magicResist: 32,
    hpRegen: 8,

    wBonusStats: 0,

    qCooldown: 8000,
    lastQTime: 0,

    wCooldown: 23000,
    lastWTime: 0,

    eCooldown: 9000,
    lastETime: 0,
    isEActive: false,
    eStartTime: 0,
    eHitCount: {},
    eDamageLevel: 4,

    isArmorDebuffed: false,
    armorDebuffEndTime: 0,

    hasQBuff: false,
    qBuffEndTime: 0,
    hasSpeedBuff: false,
    speedBuffEndTime: 0,

    hasShieldPhase: false,
    shieldPhaseEndTime: 0,
    hasDamageReducePhase: false,
    damageReducePhaseEndTime: 0
  };

  const teamName = team === 'blue' ? '블루팀' : '레드팀';
  io.emit('chatMessage', {
    username: '시스템',
    text: `${socket.username}님이 ${teamName}으로 입장하셨습니다.`,
    isSystem: true,
    targetMode: 'all'
  });

  socket.on('keyMove', (dir) => {
    const p = players[socket.id];
    if (p && !p.isDead) {
      if (dir.x !== 0 || dir.y !== 0) {
        cancelRecall(p);
      }
      p.dirX = dir.x;
      p.dirY = dir.y;
    }
  });

  socket.on('useB', () => {
    const p = players[socket.id];
    if (!p || p.isDead || p.isRecalling) return;
    p.isRecalling = true;
    p.recallStartTime = Date.now();
  });

  socket.on('useQ', () => {
    const p = players[socket.id];
    if (!p || p.isDead) return;
    cancelRecall(p);

    const now = Date.now();
    if (now - p.lastQTime < p.qCooldown) return;

    p.lastQTime = now;
    p.hasQBuff = true;
    p.qBuffEndTime = now + 4500;

    const randomDuration = (1 + Math.random() * 2.6) * 1000;
    p.hasSpeedBuff = true;
    p.speedBuffEndTime = now + randomDuration;
  });

  socket.on('useW', () => {
    const p = players[socket.id];
    if (!p || p.isDead) return;
    cancelRecall(p);

    const now = Date.now();
    if (now - p.lastWTime < p.wCooldown) return;

    p.lastWTime = now;

    p.shield = p.maxHp * 0.15;
    p.hasShieldPhase = true;
    p.shieldPhaseEndTime = now + 750;

    p.hasDamageReducePhase = false;
    p.damageReducePhaseEndTime = now + 4750;
  });

  socket.on('useE', () => {
    const p = players[socket.id];
    if (!p || p.isDead) return;
    cancelRecall(p);

    const now = Date.now();
    if (now - p.lastETime < p.eCooldown) return;

    p.lastETime = now;
    p.isEActive = true;
    p.eStartTime = now;
    p.eHitCount = {};
  });

  socket.on('attack', () => {
    const p = players[socket.id];
    const now = Date.now();
    if (p && !p.isDead && !p.isAttacking && !p.isEActive && (now - p.lastAttackTime >= 1000)) {
      cancelRecall(p);
      p.isAttacking = true;
      p.attackProgress = 0;
      p.lastAttackTime = now;

      let damage = p.attackDamage;
      if (p.hasQBuff) {
        damage *= 1.5;
        p.hasQBuff = false;
      }

      for (let targetId in players) {
        if (targetId === socket.id) continue;
        const target = players[targetId];
        if (target.team === p.team || target.isDead) continue;

        const dx = target.x - p.x;
        const dy = target.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= 35) {
          cancelRecall(target);
          let totalArmor = target.armor + target.wBonusStats;
          if (target.isArmorDebuffed) totalArmor *= 0.75;

          let incomingDamage = Math.max(1, damage - totalArmor);

          if (target.hasDamageReducePhase) incomingDamage *= 0.7;

          if (target.shield > 0) {
            if (target.shield >= incomingDamage) {
              target.shield -= incomingDamage;
              incomingDamage = 0;
            } else {
              incomingDamage -= target.shield;
              target.shield = 0;
            }
          }

          if (incomingDamage > 0) {
            target.hp = Math.max(0, target.hp - incomingDamage);
            
            if (target.hp === 0) {
              target.isDead = true;
              cancelRecall(target);
              target.respawnTime = Date.now() + 10000;
              target.hasQBuff = false;
              target.hasSpeedBuff = false;
              target.hasShieldPhase = false;
              target.hasDamageReducePhase = false;
              target.isEActive = false;
              target.shield = 0;

              if (p.wBonusStats < 30) {
                p.wBonusStats = Math.min(30, p.wBonusStats + 0.2);
              }

              io.emit('chatMessage', {
                username: '시스템',
                text: `${p.username}님이 ${target.username}님을 처치했습니다!`,
                isSystem: true,
                targetMode: 'all'
              });
            }
          }
        }
      }
    }
  });

  socket.on('kickPlayer', (targetSocketId) => {
    if (socket.username === '박준우') {
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('kicked', '방장에 의해 강제 퇴장당했습니다.');
        targetSocket.disconnect(true);
      }
    }
  });

  socket.on('chatMessage', (data) => {
    const senderPlayer = players[socket.id];
    if (!senderPlayer) return;

    let text = '';
    let targetMode = 'all';

    if (typeof data === 'string') {
      text = data;
    } else if (typeof data === 'object' && data.text) {
      text = data.text;
      targetMode = data.targetMode || 'all';
    }

    text = text.trim().substring(0, 100);
    if (!text) return;

    const payload = {
      username: socket.username,
      text: text,
      team: senderPlayer.team,
      isSystem: false,
      targetMode: targetMode
    };

    if (targetMode === 'team') {
      io.to(senderPlayer.team).emit('chatMessage', payload);
    } else {
      io.emit('chatMessage', payload);
    }
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
      io.emit('chatMessage', {
        username: '시스템',
        text: `${players[socket.id].username}님이 퇴장하셨습니다.`,
        isSystem: true,
        targetMode: 'all'
      });
      delete players[socket.id];
    }
  });
});

setInterval(() => {
  const now = Date.now();

  for (let id in players) {
    const p = players[id];

    if (p.isDead) {
      if (now >= p.respawnTime) {
        p.isDead = false;
        p.hp = p.maxHp;
        p.x = p.team === 'blue' ? 100 : 1900;
        p.y = p.team === 'blue' ? 1900 : 100;
        p.dirX = 0;
        p.dirY = 0;
      }
      continue;
    }

    if (p.isRecalling) {
      if (now - p.recallStartTime >= 8000) {
        p.x = p.team === 'blue' ? 100 : 1900;
        p.y = p.team === 'blue' ? 1900 : 100;
        p.dirX = 0;
        p.dirY = 0;
        p.isRecalling = false;
        p.recallStartTime = 0;
      }
    }

    if (isInFountain(p)) {
      if (p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + (p.maxHp * 0.20 / 60));
      }
    } else {
      if (p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + (p.hpRegen / 60));
      }
    }

    if (p.isArmorDebuffed && now >= p.armorDebuffEndTime) {
      p.isArmorDebuffed = false;
    }

    if (p.isEActive) {
      if (now - p.eStartTime >= 3000) {
        p.isEActive = false;
      } else {
        let targetsInRange = [];
        for (let tId in players) {
          if (tId === id) continue;
          const target = players[tId];
          if (target.team === p.team || target.isDead) continue;

          const dx = target.x - p.x;
          const dy = target.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist <= 40) {
            targetsInRange.push({ id: tId, target, dist });
          }
        }

        if (targetsInRange.length > 0) {
          targetsInRange.sort((a, b) => a.dist - b.dist);
          const closestTargetId = targetsInRange[0].id;

          targetsInRange.forEach(({ id: tId, target }) => {
            cancelRecall(target);
            let baseDamage = p.eDamageLevel;
            
            if (tId === closestTargetId) {
              baseDamage *= 1.25;
            }

            let totalArmor = target.armor + target.wBonusStats;
            if (target.isArmorDebuffed) totalArmor *= 0.75;

            let incomingDamage = Math.max(0.5, baseDamage - (totalArmor * 0.1));

            if (target.hasDamageReducePhase) incomingDamage *= 0.7;

            if (target.shield > 0) {
              if (target.shield >= incomingDamage) {
                target.shield -= incomingDamage;
                incomingDamage = 0;
              } else {
                incomingDamage -= target.shield;
                target.shield = 0;
              }
            }

            if (incomingDamage > 0) {
              target.hp = Math.max(0, target.hp - incomingDamage);
              
              p.eHitCount[tId] = (p.eHitCount[tId] || 0) + 1;
              
              if (p.eHitCount[tId] >= 6) {
                target.isArmorDebuffed = true;
                target.armorDebuffEndTime = now + 6000;
              }

              if (target.hp === 0) {
                target.isDead = true;
                cancelRecall(target);
                target.respawnTime = Date.now() + 10000;
                target.isEActive = false;

                if (p.wBonusStats < 30) {
                  p.wBonusStats = Math.min(30, p.wBonusStats + 0.2);
                }

                io.emit('chatMessage', {
                  username: '시스템',
                  text: `${p.username}님이 ${target.username}님을 처치했습니다!`,
                  isSystem: true,
                  targetMode: 'all'
                });
              }
            }
          });
        }
      }
    }

    if (p.hasQBuff && now >= p.qBuffEndTime) p.hasQBuff = false;
    if (p.hasSpeedBuff && now >= p.speedBuffEndTime) p.hasSpeedBuff = false;

    if (p.hasShieldPhase) {
      if (now >= p.shieldPhaseEndTime) {
        p.hasShieldPhase = false;
        p.shield = 0;
        p.hasDamageReducePhase = true;
      }
    }
    
    if (p.hasDamageReducePhase && now >= p.damageReducePhaseEndTime) {
      p.hasDamageReducePhase = false;
    }

    if (p.isAttacking) {
      p.attackProgress += 0.05;
      if (p.attackProgress >= 1) {
        p.isAttacking = false;
        p.attackProgress = 0;
      }
    }

    const currentSpeed = p.hasSpeedBuff ? 0.6133 * 1.35 : 0.6133;

    let moveX = p.dirX, moveY = p.dirY;
    if (moveX !== 0 && moveY !== 0) {
      moveX *= 0.7071; moveY *= 0.7071;
    }

    const nextX = p.x + moveX * currentSpeed;
    const nextY = p.y + moveY * currentSpeed;

    if (nextX >= 10 && nextX <= MAP_SIZE - 10 && !isColliding(nextX, p.y)) p.x = nextX;
    if (nextY >= 10 && nextY <= MAP_SIZE - 10 && !isColliding(p.x, nextY)) p.y = nextY;
  }
  io.emit('gameState', { players });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`게임 서버 작동 중 (포트: ${PORT})`); });
