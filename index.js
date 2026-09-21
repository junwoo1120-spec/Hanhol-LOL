const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const MAP_SIZE = 2000;
let players = {};
let projectiles = {};
let projectileIdCounter = 0;

function getBalancedTeam() {
  let blueCount = 0;
  let redCount = 0;

  for (let id in players) {
    if (players[id].team === 'blue') blueCount++;
    else if (players[id].team === 'red') redCount++;
  }

  return blueCount <= redCount ? 'blue' : 'red';
}

const NEXUS_RADIUS = 35;
const INHIBITOR_RADIUS = 25;
const TURRET_RADIUS = 22;

const FOUNTAIN_RADIUS = 130;
const FOUNTAIN_HEAL_PERCENT_PER_SEC = 0.2;
const FOUNTAIN_POS = {
  blue: { x: 100, y: 1900 },
  red: { x: 1900, y: 100 }
};

const R_RANGE = 190; // 화면(4배 줌 기준)에 보이는 정도의 사거리
const R_HALF_ANGLE = Math.PI / 3; // 바라보는 방향 기준 좌우 60도(총 120도)
const R_IMPACT_DELAY = 900; // ms, 시전 후 실제 데미지가 들어가기까지 시간

const PASSIVE_COMBAT_TIMEOUT = 15000; // 전투 이탈 판정 시간
const PASSIVE_TICK_INTERVAL = 5000; // 패시브 회복 주기
const PASSIVE_HEAL_PERCENT = 0.015; // 1틱당 회복량(최대체력 비율)

const DEV_USERNAME = '박준우';

// === 챔피언별 기본 스탯 ===
// 체력/공격력/방어력/마법저항력/재생 계열은 실제 수치를 그대로 사용.
// 사거리·이동속도는 게임 내 좌표 스케일이 달라서, 가렌의 "실제 스탯 → 게임 내 적용값" 비율을 그대로 다른 챔피언에도 적용해서 환산함.
//   사거리 비율: 35(가렌 게임 내 사거리) / 175(가렌 실제 사거리) = 0.2
//   이동속도 비율: 36.8(가렌 초당 이동거리) / 340(가렌 실제 이동속도) ≈ 0.10824
// 공격속도(평타 쿨타임) 비율: 럭스의 실제 기본 공속 0.625를 게임 내 기존 고정값 1000ms(=공속 1.0)에 대응시켜서 환산 계수 산출
//   환산 계수 = 1.0 / 0.625 = 1.6
//   attackCooldown(ms) = 1000 / (실제 기본 공속 * 1.6)
const CHAMPION_BASE_STATS = {
  garen: {
    hp: 680,
    hpRegen: 8,
    mana: 0,
    manaRegen: 0,
    attackDamage: 68,
    armor: 38,
    magicResist: 32,
    attackRange: 35,           // 실제 175 (그대로 유지된 값)
    baseMoveSpeed: 0.6133,     // 실제 340 → 초당 36.8유닛(0.6133 * 60)
    attackCooldown: 1000       // 기존 고정값 유지 (실제 기본 공속 0.625 기준)
  },
  lux: {
    hp: 630,                   // 기존 580 + 50
    hpRegen: 5.5,
    mana: 440,
    manaRegen: 9,
    attackDamage: 54,
    armor: 21,
    magicResist: 30,
    attackRange: 110,          // 실제 550 * 0.2
    baseMoveSpeed: 0.5953,     // 실제 330 * 0.10824 / 60
    attackCooldown: 1000       // 실제 기본 공속 0.625 → 기준값 그대로
  },
  ashe: {
    hp: 660,                   // 기존 610 + 50
    hpRegen: 3.5,
    mana: 280,
    manaRegen: 6.97,
    attackDamage: 59,
    armor: 26,
    magicResist: 33,
    attackRange: 120,          // 실제 600 * 0.2
    baseMoveSpeed: 0.5863,     // 실제 325 * 0.10824 / 60
    attackCooldown: 1000       // 기존 동작 유지 (애쉬 공속 변경은 별도 요청 시 반영)
  },
  aatrox: {
    hp: 650,
    hpRegen: 3,
    mana: 0,
    manaRegen: 0,
    attackDamage: 60,
    armor: 38,
    magicResist: 32,
    attackRange: 35,           // 실제 175 * 0.2
    baseMoveSpeed: 0.62235,    // 실제 345 * 0.10824 / 60
    attackCooldown: 960        // 실제 기본 공속 0.651 * 1.6 ≈ 1.0416 → 1000/1.0416 ≈ 960
  }
};

const LUX_PROJECTILE_SPEED = 240; // 유닛/초 (평타)
const LUX_PROJECTILE_HIT_RADIUS = 6;

// 럭스 Q(빛의 속박) - 사거리는 실제 1175 * 0.2 환산, 쿨타임은 스펙 미지정이라 임의로 10초 설정
const LUX_Q_MANA_COST = 50;
const LUX_Q_DAMAGE = 80;
const LUX_Q_RANGE = 235;
const LUX_Q_PROJECTILE_SPEED = 260;
const LUX_Q_HIT_RADIUS = 8;
const LUX_Q_COOLDOWN = 10000;
const LUX_Q_ROOT_DURATION = 2000;
const LUX_Q_MAX_TARGETS = 2;

// 럭스 W(프리즘 보호막) - 사거리는 실제 1075 * 0.2 환산, 마나는 스펙 미지정이라 임의로 설정
const LUX_W_MANA_COST = 50;
const LUX_W_RANGE = 215;
const LUX_W_PROJECTILE_SPEED = 300;
const LUX_W_HIT_RADIUS = 10;
const LUX_W_COOLDOWN = 14000;
const LUX_W_SHIELD_AMOUNT = 40;
const LUX_W_SHIELD_DURATION = 2500;
const LUX_W_MAX_HITS_PER_TARGET = 2;

// 럭스 E(빛의 특이점) - 사거리 1000 * 0.2, 범위 310 * 0.2 환산
const LUX_E_MANA_COST = 70;
const LUX_E_DAMAGE = 65;
const LUX_E_RANGE = 200;
const LUX_E_RADIUS = 62;
const LUX_E_PROJECTILE_SPEED = 260;
const LUX_E_COOLDOWN = 10000;
const LUX_E_FUSE_DURATION = 5000; // 착지 후 자동 폭발까지 시간
const LUX_E_EXPLOSION_SLOW_DURATION = 1000;
const LUX_SLOW_MULTIPLIER = 0.6; // 40% 둔화 (수치 미지정이라 임의 설정)

// 럭스 R(궁극의 섬광) - 사거리 3400 * 0.2, 범위(빔 폭) 200 * 0.2 환산
const LUX_R_MANA_COST = 100;
const LUX_R_DAMAGE = 300;
const LUX_R_RANGE = 680;
const LUX_R_WIDTH = 40;
const LUX_R_CAST_DELAY = 0; // 선딜 제거(즉시 발동)
const LUX_R_COOLDOWN = 60000;
const LUX_R_BEAM_VISUAL_DURATION = 300;

// 럭스 패시브(광채) - 레벨 시스템이 없어 레벨 비례 대신 고정 추가피해로 대체
const LUX_PASSIVE_MARK_DURATION = 6000;
const LUX_PASSIVE_BONUS_DAMAGE = 20;

// 애쉬 패시브(냉기 사격) - 평타/스킬 적중 시 둔화. W는 2배 지속시간.
const ASHE_PASSIVE_SLOW_DURATION = 2000;

// 애쉬 평타
const ASHE_ATTACK_PROJECTILE_SPEED = 320;

// 애쉬 Q(포커스) - 쿨타임/마나 없이 평타 4회 적중 시 자동 발동
const ASHE_Q_STACK_WINDOW = 4000;
const ASHE_Q_MAX_STACKS = 4;
const ASHE_Q_SLOW_DURATION = 10000; // 5발 다 맞을 가능성 고려해 합산 개념으로 10초 고정
const ASHE_Q_ATTACK_SPEED_BOOST_DURATION = 6000;
const ASHE_Q_ATTACK_COOLDOWN_BOOSTED = 667; // 공속 증가 중 평타 쿨타임 (1000 / 1.5)
const ASHE_Q_DAMAGE_MULTIPLIERS = [1.1, 1.15, 1.2, 1.25, 1.3];
const ASHE_Q_SPREAD_DEG = 40;
const ASHE_Q_ARROW_DURATION = 0.5; // 초, 곡선 비행 시간
const ASHE_Q_HIT_RADIUS = 8;

// 애쉬 W(일제사격) - 사거리 1200 * 0.2 환산
const ASHE_W_MANA_COST = 75;
const ASHE_W_RANGE = 240;
const ASHE_W_ARROW_SPEED = 320;
const ASHE_W_COOLDOWN = 18000;
const ASHE_W_ARROW_COUNT = 6;
const ASHE_W_SPREAD_DEG = 30;
const ASHE_W_HIT_RADIUS = 6;

// 애쉬 E(매의 눈) - 데미지/마나 없이 시야(카메라 줌)만 6초간 확장
const ASHE_E_COOLDOWN = 90000;
const ASHE_E_VISION_DURATION = 6000;
const ASHE_E_HAWK_DURATION = 1500;

// 애쉬 R(마법의 수정 화살) - 맵 끝까지 날아감, 판정범위는 250 * 0.2 환산
const ASHE_R_MANA_COST = 100;
const ASHE_R_DAMAGE = 300;
const ASHE_R_SPEED = 1200; // 기존 1500 * 0.8
const ASHE_R_COOLDOWN = 100000;
const ASHE_R_HIT_RADIUS = 50;
const ASHE_R_MIN_STUN = 1000;
const ASHE_R_MAX_STUN = 3500;

function refundRCooldown(casterId) {
  const caster = players[casterId];
  if (caster) {
    caster.lastRTime = 0; // 쿨타임 즉시 초기화 (재사용 가능)
  }
}

function resetOnDeathBuffs(target) {
  target.hasQBuff = false;
  target.hasSpeedBuff = false;
  target.hasShieldPhase = false;
  target.hasDamageReducePhase = false;
  target.isEActive = false;
  target.shield = 0;
  target.isRooted = false;
  target.isStunned = false;
}

function explodeLuxE(proj, now) {
  const owner = players[proj.ownerId];

  for (let tid in players) {
    const target = players[tid];
    if (target.team === proj.team || target.isDead) continue;

    const tdx = target.x - proj.x;
    const tdy = target.y - proj.y;
    const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
    if (tdist > LUX_E_RADIUS) continue;

    if (owner) owner.lastCombatTime = now;
    target.lastCombatTime = now;

    let incomingDamage = Math.max(1, LUX_E_DAMAGE - target.magicResist);
    if (target.hasDamageReducePhase) incomingDamage *= 0.7;

    if (target.isLuxMarked && target.luxMarkedBy === proj.ownerId) {
      incomingDamage += LUX_PASSIVE_BONUS_DAMAGE;
      target.isLuxMarked = false;
    }

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
      if (target.isRecalling) target.isRecalling = false;

      if (target.hp === 0) {
        target.isDead = true;
        target.respawnTime = now + 10000;
        resetOnDeathBuffs(target);

        if (owner) {
          if (owner.wBonusStats < 30) {
            owner.wBonusStats = Math.min(30, owner.wBonusStats + 0.2);
          }
          io.emit('chatMessage', {
            username: '시스템',
            text: `${owner.username}님이 ${target.username}님을 처치했습니다!`,
            isSystem: true,
            targetMode: 'all'
          });
        }
      }
    }

    if (!target.isDead) {
      target.isLuxMarked = true;
      target.luxMarkedBy = proj.ownerId;
      target.luxMarkEndTime = now + LUX_PASSIVE_MARK_DURATION;

      target.isSlowed = true;
      target.slowEndTime = now + LUX_E_EXPLOSION_SLOW_DURATION;
    }
  }
}

function fireLuxR(caster, casterId, now) {
  const dx = caster.rCastDirX, dy = caster.rCastDirY;
  const startX = caster.x, startY = caster.y;
  const endX = startX + dx * LUX_R_RANGE;
  const endY = startY + dy * LUX_R_RANGE;

  caster.rBeamStartX = startX;
  caster.rBeamStartY = startY;
  caster.rBeamEndX = endX;
  caster.rBeamEndY = endY;
  caster.rBeamShownUntil = now + LUX_R_BEAM_VISUAL_DURATION;

  const segDX = endX - startX, segDY = endY - startY;
  const segLenSq = (segDX * segDX + segDY * segDY) || 1;

  for (let tid in players) {
    const target = players[tid];
    if (target.team === caster.team || target.isDead) continue;

    let t = ((target.x - startX) * segDX + (target.y - startY) * segDY) / segLenSq;
    t = Math.max(0, Math.min(1, t));
    const closestX = startX + t * segDX;
    const closestY = startY + t * segDY;
    const ddx = target.x - closestX, ddy = target.y - closestY;
    const dist = Math.sqrt(ddx * ddx + ddy * ddy);

    if (dist > LUX_R_WIDTH) continue;

    caster.lastCombatTime = now;
    target.lastCombatTime = now;

    let incomingDamage = Math.max(1, LUX_R_DAMAGE - target.magicResist);
    if (target.hasDamageReducePhase) incomingDamage *= 0.7;

    if (target.isLuxMarked && target.luxMarkedBy === casterId) {
      incomingDamage += LUX_PASSIVE_BONUS_DAMAGE;
      target.isLuxMarked = false;
    }

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
      if (target.isRecalling) target.isRecalling = false;

      if (target.hp === 0) {
        target.isDead = true;
        target.respawnTime = now + 10000;
        resetOnDeathBuffs(target);

        if (caster.wBonusStats < 30) {
          caster.wBonusStats = Math.min(30, caster.wBonusStats + 0.2);
        }
        io.emit('chatMessage', {
          username: '시스템',
          text: `${caster.username}님이 궁극기로 ${target.username}님을 처치했습니다!`,
          isSystem: true,
          targetMode: 'all'
        });
      }
    }

    if (!target.isDead) {
      target.isLuxMarked = true;
      target.luxMarkedBy = casterId;
      target.luxMarkEndTime = now + LUX_PASSIVE_MARK_DURATION;
    }
  }
}

function applyAsheFocusStack(owner, now) {
  if (now > owner.asheFocusStackEndTime) {
    owner.asheFocusStacks = 1;
  } else {
    owner.asheFocusStacks = Math.min(ASHE_Q_MAX_STACKS, owner.asheFocusStacks + 1);
  }
  owner.asheFocusStackEndTime = now + ASHE_Q_STACK_WINDOW;

  if (owner.asheFocusStacks >= ASHE_Q_MAX_STACKS) {
    owner.asheFocusStacks = 0;
    owner.attackSpeedBoostEndTime = now + ASHE_Q_ATTACK_SPEED_BOOST_DURATION;
    fireAsheEmpoweredVolley(owner);
  }
}

function fireAsheEmpoweredVolley(caster) {
  let dx = caster.facingX, dy = caster.facingY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  dx /= len; dy /= len;
  const baseAngle = Math.atan2(dy, dx);

  const multipliers = ASHE_Q_DAMAGE_MULTIPLIERS;
  const count = multipliers.length;
  const startDeg = -ASHE_Q_SPREAD_DEG / 2;
  const stepDeg = ASHE_Q_SPREAD_DEG / (count - 1);
  const range = caster.attackRange;

  for (let i = 0; i < count; i++) {
    const angle = baseAngle + (startDeg + stepDeg * i) * Math.PI / 180;
    const endX = caster.x + Math.cos(angle) * range;
    const endY = caster.y + Math.sin(angle) * range;

    const perpAngle = angle + Math.PI / 2;
    const bulge = (i - (count - 1) / 2) * 14;
    const midX = caster.x + Math.cos(angle) * range * 0.5 + Math.cos(perpAngle) * bulge;
    const midY = caster.y + Math.sin(angle) * range * 0.5 + Math.sin(perpAngle) * bulge;

    const projId = 'proj_' + (projectileIdCounter++);
    projectiles[projId] = {
      id: projId,
      type: 'asheQArrow',
      ownerId: caster.socketId,
      team: caster.team,
      startX: caster.x, startY: caster.y,
      ctrlX: midX, ctrlY: midY,
      endX: endX, endY: endY,
      x: caster.x, y: caster.y,
      dirX: dx, dirY: dy,
      duration: ASHE_Q_ARROW_DURATION,
      elapsed: 0,
      damage: caster.attackDamage * multipliers[i]
    };
  }
}

const colliders = [
  // === 블루팀 ===
  { x: 225, y: 1766, radius: NEXUS_RADIUS },
  { x: 309, y: 1748, radius: TURRET_RADIUS },
  { x: 251, y: 1687, radius: TURRET_RADIUS },
  { x: 175, y: 1513, radius: INHIBITOR_RADIUS },
  { x: 446, y: 1561, radius: INHIBITOR_RADIUS },
  { x: 478, y: 1824, radius: INHIBITOR_RADIUS },
  { x: 175, y: 1417, radius: TURRET_RADIUS },
  { x: 506, y: 1495, radius: TURRET_RADIUS },
  { x: 589, y: 1821, radius: TURRET_RADIUS },
  { x: 222, y: 1096, radius: TURRET_RADIUS },
  { x: 692, y: 1347, radius: TURRET_RADIUS },
  { x: 941, y: 1791, radius: TURRET_RADIUS },
  { x: 149, y: 597,  radius: TURRET_RADIUS },
  { x: 798, y: 1136, radius: TURRET_RADIUS },
  { x: 1418, y: 1852, radius: TURRET_RADIUS },

  // === 레드팀 ===
  { x: 1786, y: 223, radius: NEXUS_RADIUS },
  { x: 1759, y: 307, radius: TURRET_RADIUS },
  { x: 1702, y: 242, radius: TURRET_RADIUS },
  { x: 1519, y: 163, radius: INHIBITOR_RADIUS },
  { x: 1564, y: 434, radius: INHIBITOR_RADIUS },
  { x: 1832, y: 479, radius: INHIBITOR_RADIUS },
  { x: 1416, y: 168, radius: TURRET_RADIUS },
  { x: 1501, y: 495, radius: TURRET_RADIUS },
  { x: 1835, y: 579, radius: TURRET_RADIUS },
  { x: 1077, y: 199, radius: TURRET_RADIUS },
  { x: 1319, y: 640, radius: TURRET_RADIUS },
  { x: 1796, y: 893, radius: TURRET_RADIUS },
  { x: 595,  y: 138, radius: TURRET_RADIUS },
  { x: 1211, y: 854, radius: TURRET_RADIUS },
  { x: 1867, y: 1388, radius: TURRET_RADIUS }
];

function isColliding(x, y, playerRadius = 4.2) {
  for (let c of colliders) {
    const dx = x - c.x;
    const dy = y - c.y;
    if (Math.sqrt(dx * dx + dy * dy) < c.radius + playerRadius) return true;
  }
  return false;
}

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Summoner's Rift Classic - Custom</title>
      <style>
        * { box-sizing: border-box; }
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #111; color: white; font-family: sans-serif; user-select: none; }
        canvas { display: block; width: 100vw; height: 100vh; background: #000; }
        
        .dead-screen {
          filter: grayscale(100%);
        }

        #respawn-overlay {
          position: absolute; top: 30%; left: 50%; transform: translate(-50%, -50%);
          font-size: 28px; font-weight: bold; color: #ff3333; text-shadow: 2px 2px 4px #000;
          display: none; z-index: 10; pointer-events: none;
        }

        #recall-overlay {
          position: absolute; top: 30%; left: 50%; transform: translate(-50%, -50%);
          font-size: 24px; font-weight: bold; color: #33ccff; text-shadow: 2px 2px 4px #000;
          display: none; z-index: 10; pointer-events: none;
        }

        #auth-screen {
          position: absolute; top: 0; left: 0; width: 100%; height: 100%;
          background: rgba(0, 0, 0, 0.85); display: flex; justify-content: center; align-items: center; z-index: 10;
        }
        .auth-box {
          background: #222; padding: 30px; border-radius: 12px; width: 340px; text-align: center;
          border: 1px solid #444; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        }
        .auth-box h2 { margin-top: 0; }
        .auth-box input {
          width: 100%; padding: 10px; margin: 8px 0; border-radius: 6px; border: 1px solid #555; background: #333; color: #fff;
        }
        .auth-box button {
          width: 100%; padding: 10px; margin-top: 12px; border-radius: 6px; border: none; background: #0088ff; color: #fff; font-weight: bold; cursor: pointer;
        }
        .auth-box button:hover { background: #0066cc; }
        .warning-text { color: #ffaa00; font-size: 12px; margin-bottom: 12px; line-height: 1.4; word-break: keep-all; }

        .champion-select-title { font-size: 12px; color: #aaa; margin-top: 10px; margin-bottom: 4px; text-align: left; }
        .champion-select-row { display: flex; gap: 5px; flex-wrap: wrap; }
        .champ-btn {
          flex: 1 1 45%; padding: 9px 4px; border-radius: 6px; border: 2px solid #555;
          background: #333; color: #fff; cursor: pointer; font-weight: bold; font-size: 12px;
        }
        .champ-btn.selected { background: #0088ff; border-color: #66c2ff; }

        #player-list-container {
          position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.75); border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 8px; z-index: 5; display: none; flex-direction: column;
          box-shadow: 0 4px 15px rgba(0,0,0,0.5); backdrop-filter: blur(4px);
          min-width: 220px; text-align: center; overflow: hidden;
        }
        #player-list-header {
          padding: 8px 14px; font-size: 13px; font-weight: bold; cursor: pointer;
          user-select: none; background: rgba(255, 255, 255, 0.05); display: flex;
          justify-content: space-between; align-items: center; gap: 10px;
        }
        #player-list-header:hover { background: rgba(255, 255, 255, 0.15); }
        #player-list-content {
          display: none; padding: 10px; max-height: 180px; overflow-y: auto;
          border-top: 1px solid rgba(255, 255, 255, 0.1); font-size: 13px;
        }
        .player-item {
          padding: 5px 0; font-weight: bold; display: flex;
          justify-content: space-between; align-items: center; gap: 8px;
        }
        .player-item.blue { color: #00aaff; }
        .player-item.red { color: #ff4444; }
        .kick-btn {
          background: #ff2222; color: #fff; border: none; padding: 2px 6px;
          border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: bold;
        }
        .kick-btn:hover { background: #cc0000; }

        #chat-container {
          position: absolute; left: 24px; bottom: 24px; width: 320px;
          background: rgba(0, 0, 0, 0.85); border: 1px solid #444;
          border-radius: 8px; z-index: 5; display: none; flex-direction: column;
          box-shadow: 0 5px 18px rgba(0,0,0,0.6); backdrop-filter: blur(4px); overflow: hidden;
        }
        #chat-header {
          padding: 7px 12px; font-size: 12px; font-weight: bold; cursor: pointer;
          background: rgba(255, 255, 255, 0.08); display: flex;
          justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        #chat-header:hover { background: rgba(255, 255, 255, 0.18); }
        #chat-body { display: flex; flex-direction: column; }
        #chat-messages {
          height: 160px; padding: 10px; overflow-y: auto; font-size: 13px;
          display: flex; flex-direction: column; gap: 6px; word-break: break-all;
        }
        #chat-messages::-webkit-scrollbar { width: 4px; }
        #chat-messages::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.3); border-radius: 2px; }
        .chat-msg { color: #eee; line-height: 1.3; }
        .chat-msg .type { font-size: 10px; font-weight: bold; margin-right: 4px; padding: 1px 3px; border-radius: 3px; }
        .chat-msg .type.all { background: #555; color: #fff; }
        .chat-msg .type.team { background: #15803d; color: #fff; }
        .chat-msg .sender { font-weight: bold; }
        .chat-msg .sender.blue { color: #0088ff; }
        .chat-msg .sender.red { color: #ff3333; }
        .chat-msg .system { color: #ffea00; font-style: italic; }
        
        #chat-mode-bar {
          display: flex; border-top: 1px solid rgba(255, 255, 255, 0.1); background: rgba(0, 0, 0, 0.4);
        }
        .mode-btn {
          flex: 1; background: transparent; border: none; color: #888; padding: 5px 0; font-size: 11px; font-weight: bold; cursor: pointer;
        }
        .mode-btn.active { color: #fff; background: rgba(255, 255, 255, 0.15); }
        
        #chat-input-container { display: flex; border-top: 1px solid rgba(255, 255, 255, 0.1); }
        #chat-input {
          flex: 1; background: transparent; border: none; padding: 8px 10px;
          color: #fff; font-size: 13px; outline: none;
        }
        #chat-send-btn {
          background: #0088ff; border: none; color: #fff; padding: 0 12px;
          font-size: 12px; font-weight: bold; cursor: pointer;
        }
        #chat-send-btn:hover { background: #0066cc; }

        #minimap-container {
          position: absolute; right: 15px; bottom: 15px; width: 180px; height: 180px;
          background: rgba(0, 0, 0, 0.85); border: 2px solid rgba(255, 255, 255, 0.4);
          border-radius: 6px; z-index: 5; display: none; overflow: hidden;
          box-shadow: 0 4px 15px rgba(0,0,0,0.6);
        }
        #minimap { width: 100%; height: 100%; display: block; }

        #hud-container {
          position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%);
          display: none; align-items: flex-start; gap: 10px; z-index: 6;
          background: rgba(10, 15, 20, 0.85); border: 2px solid #5b4622;
          padding: 8px 16px; border-radius: 12px; box-shadow: 0 0 15px rgba(0,0,0,0.8);
        }
        .portrait-box {
          position: relative; width: 64px; height: 64px; border-radius: 50%;
          border: 3px solid #c8aa6e; overflow: hidden; background: #000;
          display: flex; justify-content: center; align-items: center;
        }
        .portrait-box canvas { width: 100%; height: 100%; }

        .skills-container { display: flex; gap: 8px; align-items: flex-start; }
        .skill-slot-wrap {
          display: flex; flex-direction: column; align-items: center; gap: 3px;
        }
        .skill-slot {
          position: relative; width: 48px; height: 48px; background: #1e2328;
          border: 2px solid #4a8fc2; border-radius: 6px; display: flex;
          justify-content: center; align-items: center; font-weight: bold; overflow: hidden;
        }
        .skill-label {
          font-size: 11px; font-weight: bold; color: #ff9d2f; text-shadow: 1px 1px 2px #000;
        }
        .skill-icon-canvas { width: 100%; height: 100%; display: block; }
        .cooldown-overlay {
          position: absolute; top: 0; left: 0; width: 100%; height: 100%;
          background: rgba(0, 0, 0, 0.75); display: flex; justify-content: center;
          align-items: center; color: #fff; font-size: 18px; font-weight: bold; z-index: 3;
        }

        #dev-panel {
          position: absolute; top: 12px; right: 15px; z-index: 6;
          background: rgba(0, 0, 0, 0.8); border: 1px solid #ff2222; border-radius: 8px;
          padding: 10px; display: none; flex-direction: column; gap: 6px;
          box-shadow: 0 4px 15px rgba(0,0,0,0.6);
        }
        #dev-panel .dev-title {
          font-size: 11px; color: #ff6666; font-weight: bold; text-align: center; margin-bottom: 2px;
        }
        #dev-panel button {
          background: #333; color: #fff; border: 1px solid #666; border-radius: 5px;
          padding: 6px 10px; font-size: 12px; font-weight: bold; cursor: pointer; white-space: nowrap;
        }
        #dev-panel button:hover { background: #444; }
        #dev-panel button.active { background: #cc2222; border-color: #ff4444; }
      </style>
    </head>
    <body>
      <div id="respawn-overlay">부활 대기 중... <span id="respawn-timer">10</span>초</div>
      <div id="recall-overlay">귀환 중... <span id="recall-timer">8</span>초</div>

      <div id="auth-screen">
        <div class="auth-box">
          <h2>게스트 입장</h2>
          <div class="warning-text">※ 플레이에 사용할 닉네임을 입력해 주세요. (1회성)</div>
          <input type="text" id="username" placeholder="닉네임 입력 (한글 가능)" maxlength="12" />

          <div class="champion-select-title">챔피언 선택</div>
          <div class="champion-select-row">
            <button type="button" class="champ-btn selected" id="champ-btn-garen" onclick="selectChampion('garen')">가렌</button>
            <button type="button" class="champ-btn" id="champ-btn-lux" onclick="selectChampion('lux')">럭스</button>
            <button type="button" class="champ-btn" id="champ-btn-ashe" onclick="selectChampion('ashe')">애쉬</button>
            <button type="button" class="champ-btn" id="champ-btn-aatrox" onclick="selectChampion('aatrox')">아트록스</button>
          </div>

          <button id="auth-btn" onclick="handleGuestLogin()">게임 시작</button>
        </div>
      </div>

      <div id="player-list-container">
        <div id="player-list-header" onclick="togglePlayerList()">
          <span>👥 접속자 (<span id="player-count">0</span>명)</span>
          <span id="player-list-icon">∨</span>
        </div>
        <div id="player-list-content"></div>
      </div>

      <div id="chat-container">
        <div id="chat-header" onclick="toggleChat()">
          <span>💬 채팅</span>
          <span id="chat-toggle-icon">∨</span>
        </div>
        <div id="chat-body">
          <div id="chat-messages"></div>
          <div id="chat-mode-bar">
            <button class="mode-btn active" id="btn-mode-all" onclick="setChatMode('all')">전체 (Shift+Enter)</button>
            <button class="mode-btn" id="btn-mode-team" onclick="setChatMode('team')">팀 (Shift+Enter)</button>
          </div>
          <div id="chat-input-container">
            <input type="text" id="chat-input" placeholder="전체 메시지 입력..." maxlength="100" />
            <button id="chat-send-btn" onclick="sendChatMessage()">전송</button>
          </div>
        </div>
      </div>

      <div id="minimap-container">
        <canvas id="minimap" width="180" height="180"></canvas>
      </div>

      <div id="dev-panel">
        <div class="dev-title">🛠 개발자 테스트</div>
        <button id="dev-reset-cd-btn" onclick="devResetCooldowns()">쿨타임 초기화</button>
        <button id="dev-speed-btn" onclick="devToggleSpeedBoost()">이속 5배 (OFF)</button>
      </div>

      <div id="hud-container">
        <div class="portrait-box">
          <canvas id="portrait-canvas" width="64" height="64"></canvas>
        </div>
        <div class="skills-container">
          <div class="skill-slot-wrap">
            <div class="skill-slot" id="slot-passive">
              <canvas class="skill-icon-canvas" id="icon-passive" width="48" height="48"></canvas>
            </div>
            <div class="skill-label">패시브</div>
          </div>
          <div class="skill-slot-wrap">
            <div class="skill-slot" id="slot-q">
              <canvas class="skill-icon-canvas" id="icon-q" width="48" height="48"></canvas>
              <div class="cooldown-overlay" id="cd-q" style="display:none;">0</div>
            </div>
            <div class="skill-label">Q</div>
          </div>
          <div class="skill-slot-wrap">
            <div class="skill-slot" id="slot-w">
              <canvas class="skill-icon-canvas" id="icon-w" width="48" height="48"></canvas>
              <div class="cooldown-overlay" id="cd-w" style="display:none;">0</div>
            </div>
            <div class="skill-label">W</div>
          </div>
          <div class="skill-slot-wrap">
            <div class="skill-slot" id="slot-e">
              <canvas class="skill-icon-canvas" id="icon-e" width="48" height="48"></canvas>
              <div class="cooldown-overlay" id="cd-e" style="display:none;">0</div>
            </div>
            <div class="skill-label">E</div>
          </div>
          <div class="skill-slot-wrap">
            <div class="skill-slot" id="slot-r">
              <canvas class="skill-icon-canvas" id="icon-r" width="48" height="48"></canvas>
              <div class="cooldown-overlay" id="cd-r" style="display:none;">0</div>
            </div>
            <div class="skill-label">R</div>
          </div>
        </div>
      </div>

      <canvas id="game"></canvas>
      <script src="/socket.io/socket.io.js"></script>
      <script>
        let myUsername = '';
        let selectedChampion = 'garen';
        let socket = null;
        let chatTargetMode = 'all';
        let isPlayerListExpanded = false;
        let isChatExpanded = true;
        let devSpeedBoostLocal = false;

        function selectChampion(champ) {
          selectedChampion = champ;
          document.getElementById('champ-btn-garen').classList.toggle('selected', champ === 'garen');
          document.getElementById('champ-btn-lux').classList.toggle('selected', champ === 'lux');
          document.getElementById('champ-btn-ashe').classList.toggle('selected', champ === 'ashe');
          document.getElementById('champ-btn-aatrox').classList.toggle('selected', champ === 'aatrox');
        }

        function togglePlayerList() {
          isPlayerListExpanded = !isPlayerListExpanded;
          const content = document.getElementById('player-list-content');
          const icon = document.getElementById('player-list-icon');
          content.style.display = isPlayerListExpanded ? 'block' : 'none';
          icon.innerText = isPlayerListExpanded ? '∧' : '∨';
        }

        function toggleChat() {
          isChatExpanded = !isChatExpanded;
          const body = document.getElementById('chat-body');
          const icon = document.getElementById('chat-toggle-icon');
          body.style.display = isChatExpanded ? 'flex' : 'none';
          icon.innerText = isChatExpanded ? '∨' : '∧';
        }

        function kickPlayer(targetId, targetName) {
          if (confirm(\`'\${targetName}' 님을 강퇴하시겠습니까?\`)) {
            socket.emit('kickPlayer', targetId);
          }
        }

        function devResetCooldowns() {
          socket.emit('devResetCooldowns');
        }

        function devToggleSpeedBoost() {
          socket.emit('devToggleSpeedBoost');
        }

        function updatePlayerListUI(playersData) {
          const countSpan = document.getElementById('player-count');
          const contentDiv = document.getElementById('player-list-content');

          const entries = Object.entries(playersData);
          countSpan.innerText = entries.length;

          const champLabels = { lux: '럭스', ashe: '애쉬', aatrox: '아트록스', garen: '가렌' };

          contentDiv.innerHTML = '';
          entries.forEach(([id, p]) => {
            const item = document.createElement('div');
            item.className = \`player-item \${p.team}\`;
            
            let nameSpan = document.createElement('span');
            const champLabel = champLabels[p.champion] || '가렌';
            nameSpan.innerText = \`\${p.username} [\${champLabel}] (\${p.team === 'blue' ? '블루' : '레드'})\`;
            item.appendChild(nameSpan);

            if (myUsername === '박준우' && id !== socket.id) {
              let kickBtn = document.createElement('button');
              kickBtn.className = 'kick-btn';
              kickBtn.innerText = '강퇴';
              kickBtn.onclick = () => kickPlayer(id, p.username);
              item.appendChild(kickBtn);
            }

            contentDiv.appendChild(item);
          });
        }

        function handleGuestLogin() {
          const usernameInput = document.getElementById('username');
          const username = usernameInput.value.trim();

          if (!username) return alert('사용할 닉네임을 입력해주세요.');

          myUsername = username;
          document.getElementById('auth-screen').style.display = 'none';
          document.getElementById('player-list-container').style.display = 'flex';
          document.getElementById('chat-container').style.display = 'flex';
          document.getElementById('minimap-container').style.display = 'block';
          document.getElementById('hud-container').style.display = 'flex';

          if (myUsername === '박준우') {
            document.getElementById('dev-panel').style.display = 'flex';
          }
          
          initGame(myUsername, selectedChampion);
        }

        document.getElementById('username').addEventListener('keydown', (e) => {
          if (e.key === 'Enter') handleGuestLogin();
        });

        function setChatMode(mode) {
          chatTargetMode = mode;
          const btnAll = document.getElementById('btn-mode-all');
          const btnTeam = document.getElementById('btn-mode-team');
          const chatInput = document.getElementById('chat-input');

          if (mode === 'all') {
            btnAll.classList.add('active');
            btnTeam.classList.remove('active');
            chatInput.placeholder = '전체 메시지 입력...';
          } else {
            btnTeam.classList.add('active');
            btnAll.classList.remove('active');
            chatInput.placeholder = '팀 메시지 입력...';
          }
        }

        function sendChatMessage() {
          const chatInput = document.getElementById('chat-input');
          const text = chatInput.value.trim();
          if (text && socket) {
            socket.emit('chatMessage', { text, targetMode: chatTargetMode });
            chatInput.value = '';
          }
        }

        function appendChatMessage(sender, text, team = '', isSystem = false, targetMode = 'all') {
          const msgContainer = document.getElementById('chat-messages');
          const msgDiv = document.createElement('div');
          msgDiv.className = 'chat-msg';

          if (isSystem) {
            msgDiv.innerHTML = \`<span class="system">\${text}</span>\`;
          } else {
            const teamClass = team === 'blue' ? 'blue' : (team === 'red' ? 'red' : '');
            const typeLabel = targetMode === 'team' ? '<span class="type team">팀</span>' : '<span class="type all">전체</span>';
            msgDiv.innerHTML = \`\${typeLabel}<span class="sender \${teamClass}">\${sender}:</span> \${text}\`;
          }

          msgContainer.appendChild(msgDiv);
          msgContainer.scrollTop = msgContainer.scrollHeight;
        }

        function initGame(username, champion) {
          socket = io({ auth: { username, champion } });
          const canvas = document.getElementById('game');
          const ctx = canvas.getContext('2d');

          const miniCanvas = document.getElementById('minimap');
          const miniCtx = miniCanvas.getContext('2d');

          const portraitCanvas = document.getElementById('portrait-canvas');
          const portraitCtx = portraitCanvas.getContext('2d');

          const respawnOverlay = document.getElementById('respawn-overlay');
          const respawnTimer = document.getElementById('respawn-timer');

          const recallOverlay = document.getElementById('recall-overlay');
          const recallTimer = document.getElementById('recall-timer');

          const MAP_SIZE = 2000;
          const LUX_E_RADIUS_CLIENT = 62;

          const FOUNTAIN_RADIUS_CLIENT = 130;
          const FOUNTAIN_POS_CLIENT = {
            blue: { x: 100, y: 1900 },
            red: { x: 1900, y: 100 }
          };

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

          const atroxImage = new Image();
          let atroxImageClean = null;

          // 이미지 가장자리(테두리)부터 시작해서 밝은 색(흰색/회색 체크무늬 등)이
          // 서로 이어져 있는 영역을 전부 투명하게 지운다. 캐릭터는 보통 검은
          // 테두리 선으로 둘러싸여 있어서 그 선이 "벽" 역할을 해 안쪽 색은 보존됨.
          function removeBackgroundFloodFill(img, colorTolerance = 40) {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            const width = canvas.width, height = canvas.height;
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;

            // 1) 가장자리(테두리) 픽셀들의 색을 샘플링해서, 자주 나오는 배경색 몇 가지를 뽑아둠
            //    (체크무늬 배경처럼 색이 2~3가지로 번갈아 나와도 대응 가능)
            const colorCounts = {};
            function sampleBorderPixel(x, y) {
              const i = (y * width + x) * 4;
              if (data[i + 3] === 0) return;
              const key = (data[i] >> 4) + ',' + (data[i + 1] >> 4) + ',' + (data[i + 2] >> 4);
              colorCounts[key] = (colorCounts[key] || 0) + 1;
            }
            for (let x = 0; x < width; x++) {
              sampleBorderPixel(x, 0);
              sampleBorderPixel(x, height - 1);
            }
            for (let y = 0; y < height; y++) {
              sampleBorderPixel(0, y);
              sampleBorderPixel(width - 1, y);
            }
            const bgPalette = Object.keys(colorCounts)
              .sort((a, b) => colorCounts[b] - colorCounts[a])
              .slice(0, 4)
              .map(k => k.split(',').map(v => parseInt(v, 10) * 16 + 8));

            function isBackgroundColor(r, g, b) {
              for (let p = 0; p < bgPalette.length; p++) {
                const dr = r - bgPalette[p][0];
                const dg = g - bgPalette[p][1];
                const db = b - bgPalette[p][2];
                if (Math.sqrt(dr * dr + dg * dg + db * db) <= colorTolerance) return true;
              }
              return false;
            }

            // 2) 가장자리에서 시작해서, 배경색 팔레트와 색이 비슷한 픽셀만 지움
            //    (얼굴처럼 밝지만 배경과는 다른 색인 부분은 보존됨)
            const visited = new Uint8Array(width * height);
            const stackX = [];
            const stackY = [];

            for (let x = 0; x < width; x++) {
              stackX.push(x); stackY.push(0);
              stackX.push(x); stackY.push(height - 1);
            }
            for (let y = 0; y < height; y++) {
              stackX.push(0); stackY.push(y);
              stackX.push(width - 1); stackY.push(y);
            }

            while (stackX.length) {
              const x = stackX.pop();
              const y = stackY.pop();
              if (x < 0 || y < 0 || x >= width || y >= height) continue;

              const vIdx = y * width + x;
              if (visited[vIdx]) continue;
              visited[vIdx] = 1;

              const i = vIdx * 4;
              if (data[i + 3] === 0) continue;

              if (!isBackgroundColor(data[i], data[i + 1], data[i + 2])) continue; // 배경색과 다르면 여기서 멈춤(캐릭터 보존)

              data[i + 3] = 0; // 투명 처리

              stackX.push(x + 1); stackY.push(y);
              stackX.push(x - 1); stackY.push(y);
              stackX.push(x); stackY.push(y + 1);
              stackX.push(x); stackY.push(y - 1);
            }

            ctx.putImageData(imageData, 0, 0);
            return canvas;
          }

          atroxImage.onload = () => {
            atroxImageClean = removeBackgroundFloodFill(atroxImage);
          };
          atroxImage.src = 'assets/atrox.png';

          const atroxSwordImage = new Image();
          let atroxSwordImageClean = null;
          atroxSwordImage.onload = () => {
            atroxSwordImageClean = removeBackgroundFloodFill(atroxSwordImage);
          };
          atroxSwordImage.src = 'assets/atrox_sword.png';

          let serverPlayers = {};
          let clientPlayers = {};
          let serverProjectiles = {};
          const keys = {};
          let camX = 1000, camY = 1000;
          let devSwordOnBack = false; // [테스트용] Ctrl+5로 토글 — 아트록스 칼을 등 뒤 포즈로
          let hawkAnimStart = 0;

          drawSkillIcons(champion);

          const chatInput = document.getElementById('chat-input');
          chatInput.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              if (e.shiftKey) {
                setChatMode(chatTargetMode === 'all' ? 'team' : 'all');
              } else {
                sendChatMessage();
              }
            }
          });

          window.addEventListener('keydown', (e) => {
            if (document.activeElement === chatInput) return;
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
              e.preventDefault(); keys[e.key] = true; sendMovement();
            }
            if (e.code === 'Space') {
              e.preventDefault();
              socket.emit('attack');
            }
            if (e.key === 'q' || e.key === 'Q' || e.key === 'ㅂ') {
              e.preventDefault();
              socket.emit('useQ');
            }
            if (e.key === 'w' || e.key === 'W' || e.key === 'ㅈ') {
              e.preventDefault();
              socket.emit('useW');
            }
            if (e.key === 'e' || e.key === 'E' || e.key === 'ㄷ') {
              e.preventDefault();
              socket.emit('useE');
              if (champion === 'ashe') {
                hawkAnimStart = performance.now();
              }
            }
            if (e.key === 'r' || e.key === 'R' || e.key === 'ㄱ') {
              e.preventDefault();
              socket.emit('useR');
            }
            if (e.key === 'b' || e.key === 'B' || e.key === 'ㅠ') {
              e.preventDefault();
              socket.emit('recall');
            }
            if (e.ctrlKey && e.key === '5') {
              e.preventDefault();
              devSwordOnBack = !devSwordOnBack; // [테스트용] 아트록스 칼 등 뒤 포즈 토글
            }
          });

          window.addEventListener('keyup', (e) => {
            if (document.activeElement === chatInput) return;
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
              keys[e.key] = false; sendMovement();
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
            serverPlayers = data.players; 
            serverProjectiles = data.projectiles || {};
            updatePlayerListUI(serverPlayers);

            for (let id in serverPlayers) {
              const sp = serverPlayers[id];
              if (!clientPlayers[id]) {
                clientPlayers[id] = { ...sp, renderX: sp.x, renderY: sp.y, renderAngle: -40 * (Math.PI / 180) };
              } else {
                clientPlayers[id].x = sp.x;
                clientPlayers[id].y = sp.y;
                clientPlayers[id].dirX = sp.dirX;
                clientPlayers[id].dirY = sp.dirY;
                clientPlayers[id].champion = sp.champion;
                clientPlayers[id].isAttacking = sp.isAttacking;
                clientPlayers[id].attackProgress = sp.attackProgress;
                clientPlayers[id].username = sp.username;
                clientPlayers[id].team = sp.team;
                clientPlayers[id].hp = sp.hp;
                clientPlayers[id].maxHp = sp.maxHp;
                clientPlayers[id].shield = sp.shield;
                clientPlayers[id].isDead = sp.isDead;
                clientPlayers[id].respawnTime = sp.respawnTime;
                
                clientPlayers[id].lastQTime = sp.lastQTime;
                clientPlayers[id].qCooldown = sp.qCooldown;
                clientPlayers[id].lastWTime = sp.lastWTime;
                clientPlayers[id].wCooldown = sp.wCooldown;
                clientPlayers[id].lastETime = sp.lastETime;
                clientPlayers[id].eCooldown = sp.eCooldown;
                clientPlayers[id].lastRTime = sp.lastRTime;
                clientPlayers[id].rCooldown = sp.rCooldown;

                clientPlayers[id].hasQBuff = sp.hasQBuff;
                clientPlayers[id].hasSpeedBuff = sp.hasSpeedBuff;
                clientPlayers[id].hasShieldPhase = sp.hasShieldPhase;
                clientPlayers[id].hasDamageReducePhase = sp.hasDamageReducePhase;
                
                clientPlayers[id].isEActive = sp.isEActive;
                clientPlayers[id].eStartTime = sp.eStartTime;
                clientPlayers[id].isArmorDebuffed = sp.isArmorDebuffed;

                clientPlayers[id].isRecalling = sp.isRecalling;
                clientPlayers[id].recallStartTime = sp.recallStartTime;

                clientPlayers[id].isRMarked = sp.isRMarked;
                clientPlayers[id].rMarkStartTime = sp.rMarkStartTime;
                clientPlayers[id].rImpactTime = sp.rImpactTime;

                clientPlayers[id].isLuxMarked = sp.isLuxMarked;
                clientPlayers[id].isRooted = sp.isRooted;
                clientPlayers[id].isSlowed = sp.isSlowed;
                clientPlayers[id].isStunned = sp.isStunned;
                clientPlayers[id].luxShieldEndTime = sp.luxShieldEndTime;

                clientPlayers[id].isCastingR = sp.isCastingR;
                clientPlayers[id].rBeamStartX = sp.rBeamStartX;
                clientPlayers[id].rBeamStartY = sp.rBeamStartY;
                clientPlayers[id].rBeamEndX = sp.rBeamEndX;
                clientPlayers[id].rBeamEndY = sp.rBeamEndY;
                clientPlayers[id].rBeamShownUntil = sp.rBeamShownUntil;

                clientPlayers[id].visionBoostEndTime = sp.visionBoostEndTime;

                clientPlayers[id].devSpeedBoost = sp.devSpeedBoost;
              }
            }

            for (let id in clientPlayers) {
              if (!serverPlayers[id]) delete clientPlayers[id];
            }

            const me = serverPlayers[socket.id];
            if (me) {
              devSpeedBoostLocal = !!me.devSpeedBoost;
              const speedBtn = document.getElementById('dev-speed-btn');
              if (speedBtn) {
                speedBtn.innerText = devSpeedBoostLocal ? '이속 5배 (ON)' : '이속 5배 (OFF)';
                speedBtn.classList.toggle('active', devSpeedBoostLocal);
              }
            }
          });

          socket.on('chatMessage', (data) => {
            appendChatMessage(data.username, data.text, data.team, data.isSystem, data.targetMode);
          });

          socket.on('kicked', (reason) => {
            alert(reason || '방장에 의해 강제 퇴장되었습니다.');
            window.location.reload();
          });

          let lastTime = performance.now();

          function renderLoop(currentTime) {
            const dt = (currentTime - lastTime) / 1000;
            lastTime = currentTime;

            for (let id in clientPlayers) {
              const cp = clientPlayers[id];
              
              let baseSpeed = 36.8;
              if (cp.champion === 'lux') baseSpeed = 35.7;
              else if (cp.champion === 'ashe') baseSpeed = 35.2;
              else if (cp.champion === 'aatrox') baseSpeed = 37.3;

              if (cp.hasSpeedBuff) baseSpeed *= 1.35;
              if (cp.isEActive) baseSpeed *= 1.3;
              if (cp.devSpeedBoost) baseSpeed *= 5;
              if (cp.isSlowed) baseSpeed *= 0.6;
              if (cp.isRooted || cp.isStunned) baseSpeed = 0;

              // 8방향(상하좌우 + 대각선)을 정확한 각도로 표시
              if (!cp.isEActive && (cp.dirX !== 0 || cp.dirY !== 0)) {
                cp.renderAngle = Math.atan2(cp.dirY, cp.dirX);
              }

              if ((cp.dirX !== 0 || cp.dirY !== 0) && baseSpeed > 0) {
                let mx = cp.dirX, my = cp.dirY;
                if (mx !== 0 && my !== 0) { mx *= 0.7071; my *= 0.7071; }
                cp.renderX += mx * baseSpeed * dt;
                cp.renderY += my * baseSpeed * dt;
              }

              cp.renderX += (cp.x - cp.renderX) * 0.2;
              cp.renderY += (cp.y - cp.renderY) * 0.2;
            }

            const me = clientPlayers[socket.id];
            if (me && me.isDead) {
              document.body.classList.add('dead-screen');
              respawnOverlay.style.display = 'block';
              const remaining = Math.max(0, Math.ceil((me.respawnTime - Date.now()) / 1000));
              respawnTimer.innerText = remaining;
            } else {
              document.body.classList.remove('dead-screen');
              respawnOverlay.style.display = 'none';
            }

            if (me && me.isRecalling && !me.isDead) {
              recallOverlay.style.display = 'block';
              const remaining = Math.max(0, Math.ceil((8000 - (Date.now() - me.recallStartTime)) / 1000));
              recallTimer.innerText = remaining;
            } else {
              recallOverlay.style.display = 'none';
            }

            drawGame();
            drawMinimap();
            drawHUD();
            drawHawkFlyover();
            requestAnimationFrame(renderLoop);
          }
          requestAnimationFrame(renderLoop);

          function renderSword(ctx, isQBuff = false) {
            if (isQBuff) {
              ctx.shadowColor = '#FFE200';
              ctx.shadowBlur = 10;
            }

            ctx.fillStyle = '#653311';
            ctx.fillRect(3, -0.6, 2.5, 1.2);

            ctx.fillStyle = isQBuff ? '#FFF000' : '#D1AC38';
            ctx.beginPath();
            ctx.arc(6, 0, 1.8, 0, Math.PI * 2);
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(6, -2.5); ctx.lineTo(7, 0); ctx.lineTo(6, 2.5); ctx.lineTo(5, 0);
            ctx.fill();

            ctx.fillStyle = '#1A1A1A';
            ctx.fillRect(7.2, -1, 7, 2);

            ctx.fillStyle = isQBuff ? '#FFFF88' : '#A0A0A0';
            ctx.beginPath();
            ctx.moveTo(7.2, -1.3);
            ctx.lineTo(13.5, -1.3);
            ctx.lineTo(16, 0);
            ctx.lineTo(13.5, 1.3);
            ctx.lineTo(7.2, 1.3);
            ctx.fill();

            ctx.fillStyle = '#1A1A1A';
            ctx.fillRect(8, -0.7, 5.5, 1.4);

            ctx.fillStyle = '#D1AC38';
            ctx.beginPath();
            ctx.arc(8.5, 0, 0.5, 0, Math.PI * 2);
            ctx.fill();
          }

          // R스킬 전용: 오직 황금색 계열로만 이루어진 검 (다른 색 없음)
          function renderGoldenSword(ctx) {
            ctx.shadowColor = '#FFE200';
            ctx.shadowBlur = 10;

            ctx.fillStyle = '#B8860B';
            ctx.fillRect(3, -0.6, 2.5, 1.2);

            ctx.fillStyle = '#FFD700';
            ctx.beginPath();
            ctx.arc(6, 0, 1.8, 0, Math.PI * 2);
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(6, -2.5); ctx.lineTo(7, 0); ctx.lineTo(6, 2.5); ctx.lineTo(5, 0);
            ctx.fill();

            ctx.fillStyle = '#FFC107';
            ctx.fillRect(7.2, -1, 7, 2);

            ctx.fillStyle = '#FFF176';
            ctx.beginPath();
            ctx.moveTo(7.2, -1.3);
            ctx.lineTo(13.5, -1.3);
            ctx.lineTo(16, 0);
            ctx.lineTo(13.5, 1.3);
            ctx.lineTo(7.2, 1.3);
            ctx.fill();

            ctx.fillStyle = '#FFFDE7';
            ctx.fillRect(8, -0.7, 5.5, 1.4);

            ctx.fillStyle = '#FFD700';
            ctx.beginPath();
            ctx.arc(8.5, 0, 0.5, 0, Math.PI * 2);
            ctx.fill();
          }

          // 럭스 전용: 지팡이 (갈색 손잡이 + 금색 포크 머리 + 청록 보석)
          function renderWand(ctx) {
            ctx.shadowColor = '#7fe8e8';
            ctx.shadowBlur = 4;

            ctx.fillStyle = '#8B5A2B';
            ctx.fillRect(3, -1, 9, 2);

            ctx.strokeStyle = '#6b4423';
            ctx.lineWidth = 0.6;
            for (let i = 0; i < 4; i++) {
              ctx.beginPath();
              ctx.moveTo(4.5 + i * 1.8, -1);
              ctx.lineTo(5.5 + i * 1.8, 1);
              ctx.stroke();
            }

            ctx.shadowColor = '#FFD700';
            ctx.shadowBlur = 6;
            ctx.fillStyle = '#E8C044';
            ctx.beginPath();
            ctx.moveTo(12.5, -3);
            ctx.lineTo(16, -4.5);
            ctx.lineTo(17, -2);
            ctx.lineTo(14, -0.6);
            ctx.closePath();
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(12.5, 3);
            ctx.lineTo(16, 4.5);
            ctx.lineTo(17, 2);
            ctx.lineTo(14, 0.6);
            ctx.closePath();
            ctx.fill();

            ctx.strokeStyle = '#E8C044';
            ctx.lineWidth = 1;
            ctx.shadowBlur = 0;
            ctx.beginPath();
            ctx.arc(14, 0, 2, 0, Math.PI * 2);
            ctx.stroke();

            ctx.shadowColor = '#7fe8e8';
            ctx.shadowBlur = 8;
            ctx.fillStyle = '#5EEAEA';
            ctx.beginPath();
            ctx.arc(14, 0, 1.3, 0, Math.PI * 2);
            ctx.fill();
          }

          // 애쉬 전용: 활 (하늘색 곡선 + 시위)
          function renderBow(ctx) {
            ctx.shadowColor = '#63e0e8';
            ctx.shadowBlur = 5;
            ctx.strokeStyle = '#63e0e8';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(2, -9);
            ctx.quadraticCurveTo(13, 0, 2, 9);
            ctx.stroke();

            ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(200, 245, 250, 0.85)';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(2, -9);
            ctx.lineTo(2, 9);
            ctx.stroke();
          }

          // 화살촉 + 화살깃 (파란 그라데이션)
          function renderArrowShape(ctx, length) {
            const len = length || 10;
            ctx.shadowColor = '#4fa8f5';
            ctx.shadowBlur = 5;

            ctx.strokeStyle = '#2b7fd1';
            ctx.lineWidth = len * 0.09;
            ctx.beginPath();
            ctx.moveTo(-len * 0.3, 0);
            ctx.lineTo(len * 0.55, 0);
            ctx.stroke();

            ctx.fillStyle = '#4fa8f5';
            ctx.beginPath();
            ctx.moveTo(len * 0.75, 0);
            ctx.lineTo(len * 0.45, -len * 0.14);
            ctx.lineTo(len * 0.45, len * 0.14);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#1f6bc4';
            ctx.beginPath();
            ctx.moveTo(-len * 0.3, 0);
            ctx.lineTo(-len * 0.5, -len * 0.16);
            ctx.lineTo(-len * 0.38, 0);
            ctx.lineTo(-len * 0.5, len * 0.16);
            ctx.closePath();
            ctx.fill();
          }

          // R스킬 전용: 얼음빛 대형 화살
          function renderCrystalArrowShape(ctx, length) {
            const len = length || 50;
            ctx.shadowColor = '#bfefff';
            ctx.shadowBlur = 14;

            ctx.strokeStyle = '#7fd8ff';
            ctx.lineWidth = len * 0.07;
            ctx.beginPath();
            ctx.moveTo(-len * 0.3, 0);
            ctx.lineTo(len * 0.55, 0);
            ctx.stroke();

            ctx.fillStyle = '#eafcff';
            ctx.beginPath();
            ctx.moveTo(len * 0.78, 0);
            ctx.lineTo(len * 0.42, -len * 0.16);
            ctx.lineTo(len * 0.42, len * 0.16);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#9fe6ff';
            ctx.beginPath();
            ctx.moveTo(-len * 0.3, 0);
            ctx.lineTo(-len * 0.52, -len * 0.18);
            ctx.lineTo(-len * 0.38, 0);
            ctx.lineTo(-len * 0.52, len * 0.18);
            ctx.closePath();
            ctx.fill();
          }

          // 매의 눈(E) 새 실루엣
          function renderHawkSilhouette(ctx, wingPhase) {
            const flap = Math.sin(wingPhase) * 0.35;
            ctx.fillStyle = '#2f6fd8';

            ctx.save();
            ctx.rotate(flap);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(-14, -4, -26, -2);
            ctx.quadraticCurveTo(-16, 2, -4, 3);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            ctx.save();
            ctx.rotate(-flap);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(14, -4, 26, -2);
            ctx.quadraticCurveTo(16, 2, 4, 3);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            ctx.beginPath();
            ctx.ellipse(0, 0, 6, 3.2, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(-6, -0.5);
            ctx.lineTo(-10, 0);
            ctx.lineTo(-6, 1.2);
            ctx.closePath();
            ctx.fill();
          }

          // 아트록스 전용: 빨강/검정 대검
          function renderAatroxBlade(ctx) {
            ctx.shadowColor = '#ff2222';
            ctx.shadowBlur = 6;

            ctx.fillStyle = '#2b2b2b';
            ctx.fillRect(3, -0.8, 3, 1.6);

            ctx.fillStyle = '#661111';
            ctx.beginPath();
            ctx.moveTo(6, -3); ctx.lineTo(7.5, 0); ctx.lineTo(6, 3); ctx.lineTo(4.5, 0);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#c81e1e';
            ctx.beginPath();
            ctx.moveTo(7.5, -1.8);
            ctx.lineTo(18, -1.2);
            ctx.lineTo(21, 0);
            ctx.lineTo(18, 1.2);
            ctx.lineTo(7.5, 1.8);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(8, -0.6, 10, 1.2);
          }

          // 아트록스 전용: 회색 뿔 + 빨간 망토(박쥐날개)
          function renderAatroxCapeAndHorns(ctx) {
            ctx.fillStyle = '#8c1c1c';
            ctx.beginPath();
            ctx.moveTo(-2, -1);
            ctx.quadraticCurveTo(-9, -6, -8, -2);
            ctx.quadraticCurveTo(-6, 1, -2, 3);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(-2, 1);
            ctx.quadraticCurveTo(-9, 6, -8, 2);
            ctx.quadraticCurveTo(-6, -1, -2, -3);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = '#8a8a8a';
            ctx.beginPath();
            ctx.moveTo(-1, -3.5);
            ctx.quadraticCurveTo(-5, -8, -3, -9.5);
            ctx.quadraticCurveTo(0, -6, 1, -3.5);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(-1, 3.5);
            ctx.quadraticCurveTo(-5, 8, -3, 9.5);
            ctx.quadraticCurveTo(0, 6, 1, 3.5);
            ctx.closePath();
            ctx.fill();
          }

          function drawSimpleGaren(ctx, p) {
            if (p.isDead) return;

            if (p.hasShieldPhase || p.hasDamageReducePhase) {
              ctx.save();
              ctx.shadowColor = '#FFD700';
              ctx.shadowBlur = 15;
              ctx.strokeStyle = 'rgba(255, 215, 0, 0.9)';
              ctx.lineWidth = 2.5;
              ctx.beginPath();
              ctx.arc(0, 0, 11, 0, Math.PI * 2);
              ctx.stroke();
              ctx.restore();
            } else if (p.shield > 0) {
              // 럭스 W로 받은 보호막 (무지개 링)
              drawLuxShieldRing(ctx, 11);
            }

            ctx.fillStyle = '#FFE268';
            ctx.beginPath();
            ctx.arc(0, 0, 5, 0, Math.PI * 2);
            ctx.fill();

            if (p.isEActive) {
              // E스킬 회전 연산
              const elapsed = Date.now() - p.eStartTime;
              const spins = (elapsed / 3000) * (7 * Math.PI * 2);
              
              ctx.save();
              ctx.rotate(spins);

              // 검 길이에만 맞춰 남아있는 황금빛 궤적/잔상 (호 형태)
              ctx.save();
              ctx.shadowColor = '#FFE200';
              ctx.shadowBlur = 10;
              ctx.strokeStyle = 'rgba(255, 226, 104, 0.6)';
              ctx.lineWidth = 4;
              ctx.beginPath();
              // 검의 날 부분 시작점(7.2)부터 끝점(16)까지의 범위에 잔상 궤적 형성
              ctx.arc(0, 0, 12, -0.8, 0.2);
              ctx.stroke();
              ctx.restore();

              // 실제 칼 그리기
              renderSword(ctx, true);

              ctx.restore();
            } else {
              let swingAngle = 0;
              if (p.isAttacking) {
                swingAngle = -1.2 + (p.attackProgress * 2.4);
              }

              ctx.save();
              ctx.rotate(swingAngle);

              if (p.isAttacking) {
                ctx.fillStyle = p.hasQBuff ? 'rgba(255, 230, 0, 0.7)' : 'rgba(255, 226, 104, 0.45)';
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.arc(0, 0, 18, -1.2, -1.2 + (p.attackProgress * 2.4));
                ctx.fill();
              }

              renderSword(ctx, p.hasQBuff);
              ctx.restore();
            }
          }

          function drawLuxShieldRing(ctx, radius) {
            const colors = ['#ff6ec7', '#ffa76e', '#ffe76e', '#8fffc0', '#6ec7ff', '#c78fff'];
            const segments = colors.length;
            ctx.save();
            ctx.shadowBlur = 12;
            ctx.lineWidth = 2.5;
            for (let i = 0; i < segments; i++) {
              const start = (i / segments) * Math.PI * 2;
              const end = ((i + 1) / segments) * Math.PI * 2;
              ctx.strokeStyle = colors[i];
              ctx.shadowColor = colors[i];
              ctx.beginPath();
              ctx.arc(0, 0, radius, start, end);
              ctx.stroke();
            }
            ctx.restore();
          }

          function drawLuxSingularityZone(ctx, x, y, radius) {
            ctx.save();
            ctx.translate(x, y);
            ctx.globalAlpha = 0.14;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
            drawLuxShieldRing(ctx, radius);
            ctx.restore();
          }

          function drawSimpleLux(ctx, p) {
            if (p.isDead) return;

            if (p.shield > 0) {
              drawLuxShieldRing(ctx, 11);
            }

            ctx.fillStyle = '#FFDA5E';
            ctx.beginPath();
            ctx.arc(0, 0, 5, 0, Math.PI * 2);
            ctx.fill();

            ctx.save();
            renderWand(ctx);
            ctx.restore();

            if (p.isAttacking) {
              ctx.save();
              ctx.fillStyle = 'rgba(255, 110, 220, 0.9)';
              ctx.shadowColor = '#ff6ee0';
              ctx.shadowBlur = 10;
              ctx.beginPath();
              ctx.arc(15, 0, 2.5, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
          }

          function drawSimpleAshe(ctx, p) {
            if (p.isDead) return;

            if (p.hasShieldPhase || p.hasDamageReducePhase) {
              ctx.save();
              ctx.shadowColor = '#FFD700';
              ctx.shadowBlur = 15;
              ctx.strokeStyle = 'rgba(255, 215, 0, 0.9)';
              ctx.lineWidth = 2.5;
              ctx.beginPath();
              ctx.arc(0, 0, 11, 0, Math.PI * 2);
              ctx.stroke();
              ctx.restore();
            } else if (p.shield > 0) {
              drawLuxShieldRing(ctx, 11);
            }

            ctx.fillStyle = '#0e4d96';
            ctx.beginPath();
            ctx.arc(0, 0, 5, 0, Math.PI * 2);
            ctx.fill();

            ctx.save();
            renderBow(ctx);
            ctx.restore();

            if (p.isAttacking) {
              ctx.save();
              ctx.translate(6, 0);
              renderArrowShape(ctx, 6);
              ctx.restore();
            }
          }

          function drawSimpleAatrox(ctx, p) {
  if (p.isDead) return;

  ctx.save();

  // 부모(호출부)에서 이미 ctx.rotate(p.renderAngle)를 걸어놨기 때문에,
  // 이미지가 그 회전을 그대로 따라가며 계속 도는 것을 막기 위해 되돌림
  if (!p.isEActive) ctx.rotate(-p.renderAngle);

  // 좌우 이동일 때만 좌우 반전, 위/아래 이동은 반전하지 않음
  if (Math.cos(p.renderAngle) < 0) {
    ctx.scale(-1, 1);
  }

  // 보호막/피해감소 상태 효과 링은 그대로 유지
  if (p.hasShieldPhase || p.hasDamageReducePhase) {
    ctx.save();
    ctx.shadowColor = '#FFD700';
    ctx.shadowBlur = 15;
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.9)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  } else if (p.shield > 0) {
    drawLuxShieldRing(ctx, 11);
  }

  const size = 24; // 캐릭터 표시 크기 — 너무 크거나 작으면 이 숫자만 조절
  const imgToDraw = atroxImageClean || (atroxImage.complete && atroxImage.naturalWidth > 0 ? atroxImage : null);
  const swordImgToDraw = atroxSwordImageClean || (atroxSwordImage.complete && atroxSwordImage.naturalWidth > 0 ? atroxSwordImage : null);

  function drawAatroxBody() {
    if (imgToDraw) {
      ctx.drawImage(imgToDraw, -size / 2, -size / 2, size, size);
    }
  }

  if (typeof devSwordOnBack !== 'undefined' && devSwordOnBack) {
    // [테스트용] 등 뒤 포즈: 칼을 머리 위에 세로로 세워서, 몸통보다 먼저 그려 아래쪽이 몸에 가려지게 함
    const backPivotX = 2;    // 회전축(칼이 등에 닿는 지점) — 좌우 중앙 기준 살짝 오른쪽. 필요시 조절.
    const backPivotY = -4;   // 회전축 — 머리 바로 위쪽. 필요시 조절.
    const backSwordSize = 22; // 필요시 조절
    const backAngle = -Math.PI / 4; // 칼이 위를 향하도록. 칼 이미지가 원래 대각선이라 -90도는 과했음 → -45도로 축소.

    ctx.save();
    ctx.translate(backPivotX, backPivotY);
    ctx.rotate(backAngle);
    if (swordImgToDraw) {
      ctx.drawImage(
        swordImgToDraw,
        -backSwordSize * 0.2,
        -backSwordSize * 0.7,
        backSwordSize,
        backSwordSize
      );
    }
    ctx.restore();

    drawAatroxBody();
    ctx.restore();
    return;
  }

  drawAatroxBody();

  // 공격 중: 실제 사거리(CHAMPION_BASE_STATS.aatrox.attackRange)만큼 반투명 검붉은 부채꼴 표시
  if (p.isAttacking) {
    const rangeFanRadius = (CHAMPION_BASE_STATS.aatrox && CHAMPION_BASE_STATS.aatrox.attackRange) || 35;
    const rangeFanHalfAngle = 0.6; // 부채꼴 좌우 폭(라디안) — 필요시 조절
    ctx.save();
    ctx.fillStyle = 'rgba(120, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, rangeFanRadius, -rangeFanHalfAngle, rangeFanHalfAngle);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 칼: 몸통과 완전히 분리된 레이어. 평소에도 "든 자세"로 항상 보이고,
  // 공격할 때만 그 위치를 기준으로 0 → 70도까지 아래로 내려감(공격 끝나면 다시 원위치).
  const pivotX = 6;         // 회전축(칼 쥔 손 위치) — 몸통 중심(0,0) 기준. 오른쪽으로 이동.
  const pivotY = 1;         // 회전축(칼 쥔 손 위치) — 머리 위로 안 뜨게 몸통 중앙 높이로 내림.
  const swordDrawSize = 20.8; // 칼 이미지 표시 크기 — 기존 16의 1.3배. 필요시 조절.

  // 칼 이미지 안에서 "손잡이 끝(=회전축)"의 위치를 이미지 가로/세로 비율(0~1)로 지정
  const swordPivotFracX = 0.2; // 필요시 조절
  const swordPivotFracY = 0.7; // 필요시 조절

  // 칼 이미지 자체가 비스듬히 그려져 있어서, 회전 0도일 때도 보정이 필요하면 여기서 조절 (라디안)
  const swordBaseAngle = 0; // 필요시 조절

  const maxSwingDeg = 70; // 공격 시 최대로 내려가는 각도(도)
  const swingAngle = swordBaseAngle + (p.isAttacking ? p.attackProgress * (maxSwingDeg * Math.PI / 180) : 0);

  ctx.save();
  ctx.translate(pivotX, pivotY);

  // 실제 칼 이미지 — 손잡이 끝을 회전축으로 삼아서 그림 (평소에도 항상 그려짐)
  ctx.rotate(swingAngle);
  if (swordImgToDraw) {
    ctx.drawImage(
      swordImgToDraw,
      -swordDrawSize * swordPivotFracX,
      -swordDrawSize * swordPivotFracY,
      swordDrawSize,
      swordDrawSize
    );
  }
  ctx.restore();

  ctx.restore();
}
          function drawLuxRCastGlow(ctx, p) {
            if (!p.isCastingR) return;
            ctx.save();
            ctx.translate(p.renderX, p.renderY);
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 16;
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.beginPath();
            ctx.arc(0, 0, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }

          function drawLuxRBeam(ctx, p) {
            if (!p.rBeamShownUntil || Date.now() >= p.rBeamShownUntil) return;
            const colors = ['#ff3b3b', '#ff9d3b', '#fff23b', '#3bff6e', '#3bd4ff', '#8b3bff'];
            ctx.save();
            ctx.lineCap = 'round';
            const segs = colors.length;
            for (let i = 0; i < segs; i++) {
              const t0 = i / segs, t1 = (i + 1) / segs;
              const x0 = p.rBeamStartX + (p.rBeamEndX - p.rBeamStartX) * t0;
              const y0 = p.rBeamStartY + (p.rBeamEndY - p.rBeamStartY) * t0;
              const x1 = p.rBeamStartX + (p.rBeamEndX - p.rBeamStartX) * t1;
              const y1 = p.rBeamStartY + (p.rBeamEndY - p.rBeamStartY) * t1;
              ctx.strokeStyle = colors[i];
              ctx.shadowColor = colors[i];
              ctx.shadowBlur = 14;
              ctx.lineWidth = 18;
              ctx.beginPath();
              ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
              ctx.stroke();
            }
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 10;
            ctx.lineWidth = 7.5;
            ctx.beginPath();
            ctx.moveTo(p.rBeamStartX, p.rBeamStartY);
            ctx.lineTo(p.rBeamEndX, p.rBeamEndY);
            ctx.stroke();
            ctx.restore();
          }

          function drawRMarker(ctx, p) {
            if (!p.isRMarked) return;

            const now = Date.now();
            const totalDuration = Math.max(1, p.rImpactTime - p.rMarkStartTime);
            let progress = (now - p.rMarkStartTime) / totalDuration;
            progress = Math.max(0, Math.min(1, progress));

            const swordScale = 6.9;
            const startTipGap = 90; // 화면 안에 다 보이도록 낮춤
            const endTipGap = 2;    // 거의 닿는 높이까지 하강

            const tipGap = startTipGap + (endTipGap - startTipGap) * progress;

            // 바닥의 황금빛 원형 글로우
            ctx.save();
            ctx.translate(p.renderX, p.renderY);
            const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 12);
            grad.addColorStop(0, 'rgba(255, 246, 190, 0.95)');
            grad.addColorStop(0.45, 'rgba(255, 215, 80, 0.65)');
            grad.addColorStop(1, 'rgba(255, 200, 40, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(0, 0, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // 머리 위에서 수직으로 떨어지는 황금빛 검
            ctx.save();
            ctx.translate(p.renderX, p.renderY - tipGap);
            ctx.rotate(Math.PI / 2);
            ctx.scale(swordScale, swordScale);
            ctx.translate(-16, 0);

            ctx.shadowColor = '#FFF7B0';
            ctx.shadowBlur = 22;
            renderGoldenSword(ctx);
            ctx.shadowBlur = 34;
            renderGoldenSword(ctx);
            ctx.restore();
          }

          function drawFountainLaser(ctx, p) {
            const enemyFountain = FOUNTAIN_POS_CLIENT[p.team === 'blue' ? 'red' : 'blue'];
            if (!enemyFountain) return;

            const edx = p.renderX - enemyFountain.x;
            const edy = p.renderY - enemyFountain.y;
            const edist = Math.sqrt(edx * edx + edy * edy);
            if (edist > FOUNTAIN_RADIUS_CLIENT) return;

            ctx.save();
            ctx.strokeStyle = 'rgba(255, 50, 50, 0.9)';
            ctx.shadowColor = '#ff1111';
            ctx.shadowBlur = 18;
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.moveTo(enemyFountain.x, enemyFountain.y);
            ctx.lineTo(p.renderX, p.renderY);
            ctx.stroke();
            ctx.restore();
          }

          // 럭스 Q(속박) 적중 이펙트: 무지개색 궤도 + 떠오르는 파티클
          function drawRootEffect(ctx, p) {
            if (!p.isRooted) return;

            const t = Date.now() / 1000;
            const colors = ['#ff6ec7', '#ffd76e', '#8fffc0', '#6ec7ff', '#c78fff'];

            ctx.save();
            ctx.translate(p.renderX, p.renderY);

            for (let ring = 0; ring < 2; ring++) {
              const radius = 8 + ring * 3;
              const rotSpeed = ring === 0 ? 2.2 : -1.6;
              ctx.save();
              ctx.rotate(t * rotSpeed);
              for (let i = 0; i < colors.length; i++) {
                const angle = (i / colors.length) * Math.PI * 2;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius * 0.45;
                ctx.fillStyle = colors[i];
                ctx.shadowColor = colors[i];
                ctx.shadowBlur = 6;
                ctx.beginPath();
                ctx.arc(x, y, 1.1, 0, Math.PI * 2);
                ctx.fill();
              }
              ctx.restore();
            }

            for (let i = 0; i < 4; i++) {
              const phase = (t * 1.5 + i * 0.7) % 1;
              const py = -phase * 14;
              const alpha = 1 - phase;
              ctx.globalAlpha = alpha;
              ctx.fillStyle = colors[i % colors.length];
              ctx.shadowColor = colors[i % colors.length];
              ctx.shadowBlur = 6;
              ctx.beginPath();
              ctx.arc((i - 1.5) * 3, py - 6, 0.9, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.globalAlpha = 1;

            ctx.restore();
          }

          // 스턴 이펙트: 머리 위 회전하는 별
          function drawStunEffect(ctx, p) {
            if (!p.isStunned) return;
            const t = Date.now() / 1000;
            ctx.save();
            ctx.translate(p.renderX, p.renderY - 12);
            for (let i = 0; i < 3; i++) {
              const angle = t * 4 + (i / 3) * Math.PI * 2;
              const x = Math.cos(angle) * 5;
              const y = Math.sin(angle) * 2;
              ctx.fillStyle = '#ffe066';
              ctx.shadowColor = '#ffe066';
              ctx.shadowBlur = 5;
              ctx.font = 'bold 4px sans-serif';
              ctx.fillText('★', x - 1.5, y);
            }
            ctx.restore();
          }

          function drawGarenPortrait(ctx) {
            ctx.clearRect(0, 0, 64, 64);
            ctx.fillStyle = '#0a0f14';
            ctx.fillRect(0, 0, 64, 64);

            ctx.save();
            ctx.translate(26, 38);
            
            ctx.fillStyle = '#FFE268';
            ctx.beginPath();
            ctx.arc(0, 0, 10, 0, Math.PI * 2);
            ctx.fill();

            ctx.save();
            ctx.rotate(-60 * (Math.PI / 180));

            ctx.fillStyle = '#653311';
            ctx.fillRect(6, -1.2, 5, 2.4);

            ctx.fillStyle = '#D1AC38';
            ctx.beginPath();
            ctx.arc(11, 0, 3.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#A0A0A0';
            ctx.beginPath();
            ctx.moveTo(13, -2.5);
            ctx.lineTo(26, -2.5);
            ctx.lineTo(31, 0);
            ctx.lineTo(26, 2.5);
            ctx.lineTo(13, 2.5);
            ctx.fill();

            ctx.restore();
            ctx.restore();
          }

          function drawLuxPortrait(ctx) {
            ctx.clearRect(0, 0, 64, 64);
            ctx.fillStyle = '#241a12';
            ctx.fillRect(0, 0, 64, 64);

            ctx.save();
            ctx.translate(24, 40);

            ctx.fillStyle = '#FFDA5E';
            ctx.beginPath();
            ctx.arc(0, 0, 10, 0, Math.PI * 2);
            ctx.fill();

            ctx.save();
            ctx.rotate(-50 * (Math.PI / 180));
            ctx.scale(1.7, 1.7);
            renderWand(ctx);
            ctx.restore();

            ctx.restore();
          }

          function drawAshePortrait(ctx) {
            ctx.clearRect(0, 0, 64, 64);
            ctx.fillStyle = '#0a1a2e';
            ctx.fillRect(0, 0, 64, 64);

            ctx.save();
            ctx.translate(24, 32);

            ctx.fillStyle = '#0e4d96';
            ctx.beginPath();
            ctx.arc(0, 0, 10, 0, Math.PI * 2);
            ctx.fill();

            ctx.save();
            ctx.scale(1.6, 1.6);
            renderBow(ctx);
            ctx.restore();

            ctx.restore();
          }

          function drawAatroxPortrait(ctx) {
            ctx.clearRect(0, 0, 64, 64);
            ctx.fillStyle = '#2a0e0e';
            ctx.fillRect(0, 0, 64, 64);

            ctx.save();
            ctx.translate(28, 34);
            ctx.scale(1.6, 1.6);

            renderAatroxCapeAndHorns(ctx);

            ctx.fillStyle = '#f5f0e6';
            ctx.beginPath();
            ctx.arc(0, 0, 5, 0, Math.PI * 2);
            ctx.fill();

            ctx.save();
            ctx.rotate(-40 * Math.PI / 180);
            renderAatroxBlade(ctx);
            ctx.restore();

            ctx.restore();
          }

          function drawPassiveIcon(ctx) {
            ctx.clearRect(0, 0, 48, 48);
            ctx.fillStyle = '#0a3d2e';
            ctx.fillRect(0, 0, 48, 48);

            ctx.save();
            ctx.translate(20, 30);

            ctx.fillStyle = '#eafff2';
            ctx.beginPath();
            ctx.arc(0, -16, 5, 0, Math.PI * 2);
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(-7, -9);
            ctx.lineTo(7, -9);
            ctx.lineTo(9, 15);
            ctx.lineTo(-9, 15);
            ctx.closePath();
            ctx.fill();

            ctx.strokeStyle = '#eafff2';
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.moveTo(9, -20);
            ctx.lineTo(15, 18);
            ctx.stroke();

            ctx.fillStyle = '#eafff2';
            ctx.beginPath();
            ctx.arc(9, -20, 2, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
          }

          function drawGarenSkillIcons() {
            const passiveCanvas = document.getElementById('icon-passive');
            drawPassiveIcon(passiveCanvas.getContext('2d'));

            const qCanvas = document.getElementById('icon-q');
            const qCtx = qCanvas.getContext('2d');
            qCtx.fillStyle = '#1c1917'; qCtx.fillRect(0, 0, 48, 48);
            qCtx.save();
            qCtx.translate(16, 32);
            qCtx.rotate(-45 * Math.PI / 180);
            qCtx.scale(1.8, 1.8);
            renderSword(qCtx, true);
            qCtx.restore();

            const wCanvas = document.getElementById('icon-w');
            const wCtx = wCanvas.getContext('2d');
            wCtx.fillStyle = '#064e3b'; wCtx.fillRect(0, 0, 48, 48);
            wCtx.save();
            wCtx.translate(24, 24);
            wCtx.shadowColor = '#FFD700'; wCtx.shadowBlur = 10;
            wCtx.strokeStyle = '#FFD700'; wCtx.lineWidth = 3;
            wCtx.beginPath(); wCtx.arc(0, 0, 14, 0, Math.PI * 2); wCtx.stroke();
            wCtx.fillStyle = 'rgba(255, 215, 0, 0.3)'; wCtx.fill();
            wCtx.restore();

            const eCanvas = document.getElementById('icon-e');
            const eCtx = eCanvas.getContext('2d');
            eCtx.fillStyle = '#7f1d1d'; eCtx.fillRect(0, 0, 48, 48);
            eCtx.strokeStyle = '#fca5a5'; eCtx.lineWidth = 3;
            eCtx.beginPath(); eCtx.arc(24, 24, 12, 0, Math.PI * 1.5); eCtx.stroke();

            const rCanvas = document.getElementById('icon-r');
            const rCtx = rCanvas.getContext('2d');
            rCtx.fillStyle = '#581c87'; rCtx.fillRect(0, 0, 48, 48);
            rCtx.fillStyle = '#c084fc';
            rCtx.fillRect(22, 10, 4, 28);
          }

          function drawLuxSkillIcons() {
            // 패시브 - 광채 (금빛 반짝임)
            const passiveCanvas = document.getElementById('icon-passive');
            const passiveCtx = passiveCanvas.getContext('2d');
            passiveCtx.fillStyle = '#3a2a10'; passiveCtx.fillRect(0, 0, 48, 48);
            passiveCtx.save();
            passiveCtx.translate(24, 24);
            passiveCtx.shadowColor = '#FFD700'; passiveCtx.shadowBlur = 12;
            passiveCtx.fillStyle = '#FFE066';
            for (let i = 0; i < 8; i++) {
              passiveCtx.save();
              passiveCtx.rotate(i * Math.PI / 4);
              passiveCtx.beginPath();
              passiveCtx.moveTo(0, 0);
              passiveCtx.lineTo(3, -14);
              passiveCtx.lineTo(-3, -14);
              passiveCtx.closePath();
              passiveCtx.fill();
              passiveCtx.restore();
            }
            passiveCtx.beginPath();
            passiveCtx.arc(0, 0, 5, 0, Math.PI * 2);
            passiveCtx.fillStyle = '#fff6d6';
            passiveCtx.fill();
            passiveCtx.restore();

            // Q - 빛의 속박
            const qCanvas = document.getElementById('icon-q');
            const qCtx = qCanvas.getContext('2d');
            qCtx.fillStyle = '#241a12'; qCtx.fillRect(0, 0, 48, 48);
            qCtx.strokeStyle = '#e8c877'; qCtx.lineWidth = 3;
            qCtx.shadowColor = '#FFD86B'; qCtx.shadowBlur = 8;
            qCtx.beginPath();
            qCtx.moveTo(8, 38);
            qCtx.bezierCurveTo(20, 10, 28, 38, 40, 10);
            qCtx.stroke();

            // W - 프리즘 장벽
            const wCanvas = document.getElementById('icon-w');
            const wCtx = wCanvas.getContext('2d');
            wCtx.fillStyle = '#0d2a4a'; wCtx.fillRect(0, 0, 48, 48);
            wCtx.strokeStyle = '#6ec6ff'; wCtx.lineWidth = 3;
            wCtx.shadowColor = '#6ec6ff'; wCtx.shadowBlur = 10;
            wCtx.beginPath();
            wCtx.ellipse(24, 24, 14, 8, -0.3, 0, Math.PI * 2);
            wCtx.stroke();
            wCtx.fillStyle = '#bfe6ff';
            wCtx.beginPath();
            wCtx.arc(36, 16, 2.5, 0, Math.PI * 2);
            wCtx.fill();

            // E - 빛의 특이점
            const eCanvas = document.getElementById('icon-e');
            const eCtx = eCanvas.getContext('2d');
            eCtx.fillStyle = '#1a1030'; eCtx.fillRect(0, 0, 48, 48);
            eCtx.save();
            eCtx.translate(24, 24);
            eCtx.shadowColor = '#FFF7B0'; eCtx.shadowBlur = 16;
            eCtx.fillStyle = '#FFF7B0';
            for (let i = 0; i < 6; i++) {
              eCtx.save();
              eCtx.rotate(i * Math.PI / 3);
              eCtx.beginPath();
              eCtx.moveTo(0, 0);
              eCtx.lineTo(2, -16);
              eCtx.lineTo(-2, -16);
              eCtx.closePath();
              eCtx.fill();
              eCtx.restore();
            }
            eCtx.beginPath();
            eCtx.arc(0, 0, 4, 0, Math.PI * 2);
            eCtx.fillStyle = '#fff';
            eCtx.fill();
            eCtx.restore();

            // R - 궁극의 섬광
            const rCanvas = document.getElementById('icon-r');
            const rCtx = rCanvas.getContext('2d');
            rCtx.fillStyle = '#160e28'; rCtx.fillRect(0, 0, 48, 48);
            const grad = rCtx.createLinearGradient(4, 44, 44, 4);
            grad.addColorStop(0, '#ff5fd1');
            grad.addColorStop(0.5, '#7ee8ff');
            grad.addColorStop(1, '#fff36e');
            rCtx.strokeStyle = grad;
            rCtx.lineWidth = 4;
            rCtx.shadowColor = '#b98bff'; rCtx.shadowBlur = 10;
            rCtx.beginPath();
            rCtx.moveTo(4, 44);
            rCtx.lineTo(44, 4);
            rCtx.stroke();
          }

          function drawAsheSkillIcons() {
            // 패시브 - 냉기 사격
            const passiveCanvas = document.getElementById('icon-passive');
            const passiveCtx = passiveCanvas.getContext('2d');
            passiveCtx.fillStyle = '#0a2a3d'; passiveCtx.fillRect(0, 0, 48, 48);
            passiveCtx.save();
            passiveCtx.translate(24, 24);
            passiveCtx.shadowColor = '#8fd9ff'; passiveCtx.shadowBlur = 10;
            passiveCtx.strokeStyle = '#bfefff';
            passiveCtx.lineWidth = 2;
            for (let i = 0; i < 6; i++) {
              passiveCtx.save();
              passiveCtx.rotate(i * Math.PI / 3);
              passiveCtx.beginPath();
              passiveCtx.moveTo(0, 0);
              passiveCtx.lineTo(0, -14);
              passiveCtx.stroke();
              passiveCtx.restore();
            }
            passiveCtx.restore();

            // Q - 포커스
            const qCanvas = document.getElementById('icon-q');
            const qCtx = qCanvas.getContext('2d');
            qCtx.fillStyle = '#12233d'; qCtx.fillRect(0, 0, 48, 48);
            qCtx.save();
            qCtx.translate(24, 24);
            for (let i = 0; i < 5; i++) {
              qCtx.save();
              qCtx.rotate((i - 2) * 0.28);
              qCtx.translate(-14, 0);
              renderArrowShape(qCtx, 20);
              qCtx.restore();
            }
            qCtx.restore();

            // W - 일제사격
            const wCanvas = document.getElementById('icon-w');
            const wCtx = wCanvas.getContext('2d');
            wCtx.fillStyle = '#12233d'; wCtx.fillRect(0, 0, 48, 48);
            wCtx.save();
            wCtx.translate(14, 24);
            for (let i = 0; i < 6; i++) {
              wCtx.save();
              wCtx.rotate((i - 2.5) * 0.16);
              renderArrowShape(wCtx, 26);
              wCtx.restore();
            }
            wCtx.restore();

            // E - 매의 눈
            const eCanvas = document.getElementById('icon-e');
            const eCtx = eCanvas.getContext('2d');
            eCtx.fillStyle = '#12233d'; eCtx.fillRect(0, 0, 48, 48);
            eCtx.save();
            eCtx.translate(24, 24);
            eCtx.scale(0.9, 0.9);
            renderHawkSilhouette(eCtx, 0.6);
            eCtx.restore();

            // R - 마법의 수정 화살
            const rCanvas = document.getElementById('icon-r');
            const rCtx = rCanvas.getContext('2d');
            rCtx.fillStyle = '#08131f'; rCtx.fillRect(0, 0, 48, 48);
            rCtx.save();
            rCtx.translate(10, 38);
            rCtx.rotate(-45 * Math.PI / 180);
            renderCrystalArrowShape(rCtx, 44);
            rCtx.restore();
          }

          function drawAatroxSkillIcons() {
            // 아직 패시브/Q/W/E/R 미구현 - 빈 슬롯만 표시
            ['icon-passive', 'icon-q', 'icon-w', 'icon-e', 'icon-r'].forEach((id) => {
              const c = document.getElementById(id);
              const cx = c.getContext('2d');
              cx.fillStyle = '#1a1414';
              cx.fillRect(0, 0, 48, 48);
            });
          }

          function drawSkillIcons(champion) {
            if (champion === 'lux') {
              drawLuxSkillIcons();
            } else if (champion === 'ashe') {
              drawAsheSkillIcons();
            } else if (champion === 'aatrox') {
              drawAatroxSkillIcons();
            } else {
              drawGarenSkillIcons();
            }
          }

          function drawHUD() {
            const me = clientPlayers[socket.id];
            if (!me) return;

            if (me.champion === 'lux') {
              drawLuxPortrait(portraitCtx);
            } else if (me.champion === 'ashe') {
              drawAshePortrait(portraitCtx);
            } else if (me.champion === 'aatrox') {
              drawAatroxPortrait(portraitCtx);
            } else {
              drawGarenPortrait(portraitCtx);
            }

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

            const rCdBox = document.getElementById('cd-r');
            const rRemaining = Math.max(0, Math.ceil(((me.lastRTime + me.rCooldown) - now) / 1000));
            rCdBox.style.display = rRemaining > 0 ? 'flex' : 'none';
            if (rRemaining > 0) rCdBox.innerText = rRemaining;
          }

          function drawHawkFlyover() {
            if (!hawkAnimStart) return;
            const elapsed = performance.now() - hawkAnimStart;
            if (elapsed > 1500) { hawkAnimStart = 0; return; }

            const cssWidth = canvas.width / dpr;
            const cssHeight = canvas.height / dpr;
            const t = elapsed / 1500;
            const x = t * cssWidth;
            const y = cssHeight * 0.3;

            ctx.save();
            ctx.scale(dpr, dpr);
            ctx.translate(x, y);
            ctx.scale(3.2, 3.2);
            renderHawkSilhouette(ctx, elapsed / 90);
            ctx.restore();
          }

          function drawGame() {
            const me = clientPlayers[socket.id];
            ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.save();

            let zoom = 4.0;
            if (me && me.visionBoostEndTime && me.visionBoostEndTime > Date.now()) {
              zoom = 4.0 / Math.SQRT2; // 면적 기준 100% 넓은 시야
            }
            
            if (me) {
              camX += (me.renderX - camX) * 0.2;
              camY += (me.renderY - camY) * 0.2;
              const cssWidth = canvas.width / dpr, cssHeight = canvas.height / dpr;
              ctx.scale(dpr, dpr); ctx.translate(cssWidth / 2, cssHeight / 2);
              ctx.scale(zoom, zoom); ctx.translate(-camX, -camY);
            }

            if (mapImage.complete && mapImage.naturalWidth !== 0) {
              ctx.drawImage(mapImage, 0, 0, MAP_SIZE, MAP_SIZE);
            }

            for (let pid in serverProjectiles) {
              const proj = serverProjectiles[pid];
              if (proj.type === 'luxE' && proj.phase === 'active') {
                drawLuxSingularityZone(ctx, proj.x, proj.y, LUX_E_RADIUS_CLIENT);
              }
            }

            for (let id in clientPlayers) {
              const p = clientPlayers[id];
              if (p.isDead) continue;

              drawFountainLaser(ctx, p);
              drawLuxRBeam(ctx, p);

              ctx.save();
              ctx.translate(p.renderX, p.renderY);
              
              ctx.scale(1.3, 1.3);
              if (!p.isEActive) ctx.rotate(p.renderAngle);

              if (p.champion === 'lux') {
                drawSimpleLux(ctx, p);
              } else if (p.champion === 'ashe') {
                drawSimpleAshe(ctx, p);
              } else if (p.champion === 'aatrox') {
                drawSimpleAatrox(ctx, p);
              } else {
                drawSimpleGaren(ctx, p);
              }

              ctx.restore();

              drawRMarker(ctx, p);
              drawRootEffect(ctx, p);
              drawStunEffect(ctx, p);
              drawLuxRCastGlow(ctx, p);

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

              // 방깎 이펙트 표시
              if (p.isArmorDebuffed) {
                ctx.fillStyle = '#A855F7';
                ctx.font = 'bold 3px sans-serif';
                ctx.fillText('🛡️-25%', p.renderX, p.renderY + 8);
              }

              // 럭스 표식 이펙트 표시
              if (p.isLuxMarked) {
                ctx.fillStyle = '#fff2a8';
                ctx.font = 'bold 3.5px sans-serif';
                ctx.fillText('✨', p.renderX + 6, p.renderY + 6);
              }

              ctx.font = 'bold 4.5px sans-serif';
              ctx.textAlign = 'center';
              ctx.fillStyle = (p.team === 'blue') ? '#38bdf8' : '#f87171';
              
              ctx.strokeStyle = '#000000';
              ctx.lineWidth = 0.8;
              ctx.strokeText(p.username, p.renderX, p.renderY - 13);
              ctx.fillText(p.username, p.renderX, p.renderY - 13);
            }

            for (let pid in serverProjectiles) {
              const proj = serverProjectiles[pid];
              ctx.save();
              if (proj.type === 'luxQ') {
                const grad = ctx.createRadialGradient(proj.x - 1, proj.y - 1, 0, proj.x, proj.y, 4);
                grad.addColorStop(0, '#ffffff');
                grad.addColorStop(0.25, '#8fd9ff');
                grad.addColorStop(0.5, '#c88fff');
                grad.addColorStop(0.75, '#ff8fd9');
                grad.addColorStop(1, '#ffe98f');
                ctx.fillStyle = grad;
                ctx.shadowColor = '#ffffff';
                ctx.shadowBlur = 14;
                ctx.beginPath();
                ctx.arc(proj.x, proj.y, 3.6, 0, Math.PI * 2);
                ctx.fill();
              } else if (proj.type === 'luxE' && proj.phase === 'flying') {
                const grad = ctx.createRadialGradient(proj.x - 1, proj.y - 1, 0, proj.x, proj.y, 4);
                grad.addColorStop(0, '#ffffff');
                grad.addColorStop(0.25, '#8fd9ff');
                grad.addColorStop(0.5, '#c88fff');
                grad.addColorStop(0.75, '#ff8fd9');
                grad.addColorStop(1, '#ffe98f');
                ctx.fillStyle = grad;
                ctx.shadowColor = '#ffffff';
                ctx.shadowBlur = 14;
                ctx.beginPath();
                ctx.arc(proj.x, proj.y, 3.6, 0, Math.PI * 2);
                ctx.fill();
              } else if (proj.type === 'luxW') {
                ctx.translate(proj.x, proj.y);
                ctx.rotate((Date.now() / 80) % (Math.PI * 2));
                ctx.scale(1.3, 1.3);
                ctx.translate(-10, 0); // 지팡이 중심을 회전축에 맞춤
                renderWand(ctx);
              } else if (proj.type === 'luxAttack') {
                ctx.fillStyle = '#ff5fd1';
                ctx.shadowColor = '#ff9bee';
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.arc(proj.x, proj.y, 2.4, 0, Math.PI * 2);
                ctx.fill();
              } else if (proj.type === 'asheAttack' || proj.type === 'asheW') {
                const angle = Math.atan2(proj.dirY, proj.dirX);
                ctx.translate(proj.x, proj.y);
                ctx.rotate(angle);
                renderArrowShape(ctx, 9);
              } else if (proj.type === 'asheQArrow') {
                const angle = Math.atan2(proj.dirY, proj.dirX);
                ctx.translate(proj.x, proj.y);
                ctx.rotate(angle);
                renderArrowShape(ctx, 7);
              } else if (proj.type === 'asheR') {
                const angle = Math.atan2(proj.dirY, proj.dirX);
                ctx.translate(proj.x, proj.y);
                ctx.rotate(angle);
                renderCrystalArrowShape(ctx, 45);
              }
              ctx.restore();
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

  const champion = socket.handshake.auth.champion;
  if (champion === 'lux') socket.champion = 'lux';
  else if (champion === 'ashe') socket.champion = 'ashe';
  else if (champion === 'aatrox') socket.champion = 'aatrox';
  else socket.champion = 'garen';

  next();
});

io.on('connection', (socket) => {
  const team = getBalancedTeam();
  const champion = socket.champion;
  const baseStats = CHAMPION_BASE_STATS[champion] || CHAMPION_BASE_STATS.garen;
  
  socket.join(team);

  const spawnX = team === 'blue' ? 100 : 1900;
  const spawnY = team === 'blue' ? 1900 : 100;

  players[socket.id] = { 
    socketId: socket.id,
    x: spawnX, 
    y: spawnY, 
    dirX: 0, 
    dirY: 0,
    facingX: team === 'blue' ? 1 : -1,
    facingY: team === 'blue' ? -1 : 1,
    username: socket.username,
    champion: champion,
    team: team,
    isAttacking: false,
    attackProgress: 0,
    lastAttackTime: 0,

    isDead: false,
    respawnTime: 0,

    hp: baseStats.hp,
    maxHp: baseStats.hp,
    shield: 0,
    attackDamage: baseStats.attackDamage,
    attackRange: baseStats.attackRange,
    baseMoveSpeed: baseStats.baseMoveSpeed,
    armor: baseStats.armor,
    magicResist: baseStats.magicResist,
    hpRegen: baseStats.hpRegen,
    mana: baseStats.mana,
    maxMana: baseStats.mana,
    manaRegen: baseStats.manaRegen,

    lastCombatTime: 0,
    nextPassiveTickTime: 0,

    wBonusStats: 0,

    qCooldown: champion === 'lux' ? LUX_Q_COOLDOWN : 8000,
    lastQTime: 0,

    wCooldown: champion === 'lux' ? LUX_W_COOLDOWN : (champion === 'ashe' ? ASHE_W_COOLDOWN : 23000),
    lastWTime: 0,

    eCooldown: champion === 'lux' ? LUX_E_COOLDOWN : (champion === 'ashe' ? ASHE_E_COOLDOWN : 9000),
    lastETime: 0,
    isEActive: false,
    eStartTime: 0,
    eHitCount: {},
    eDamageLevel: 2.5333, // 기존 3.8 * 2/3 (너프)

    rCooldown: champion === 'lux' ? LUX_R_COOLDOWN : (champion === 'ashe' ? ASHE_R_COOLDOWN : 140000),
    lastRTime: 0,
    isRMarked: false,
    rMarkStartTime: 0,
    rImpactTime: 0,
    rCasterId: null,
    rCasterUsername: null,

    // 럭스 패시브(광채) / Q(속박) / W(보호막) / E(둔화) / R(궁극) 상태
    isLuxMarked: false,
    luxMarkedBy: null,
    luxMarkEndTime: 0,
    isRooted: false,
    rootEndTime: 0,
    luxShieldEndTime: 0,
    isSlowed: false,
    slowEndTime: 0,

    isCastingR: false,
    rCastEndTime: 0,
    rCastDirX: 0,
    rCastDirY: 0,
    rBeamStartX: 0,
    rBeamStartY: 0,
    rBeamEndX: 0,
    rBeamEndY: 0,
    rBeamShownUntil: 0,

    // 애쉬 Q(포커스) / 공속버프 / 시야버프 / 스턴
    asheFocusStacks: 0,
    asheFocusStackEndTime: 0,
    attackSpeedBoostEndTime: 0,
    visionBoostEndTime: 0,
    isStunned: false,
    stunEndTime: 0,

    isRecalling: false,
    recallStartTime: 0,

    isArmorDebuffed: false,
    armorDebuffEndTime: 0,

    hasQBuff: false,
    qBuffEndTime: 0,
    hasSpeedBuff: false,
    speedBuffEndTime: 0,

    hasShieldPhase: false,
    shieldPhaseEndTime: 0,
    hasDamageReducePhase: false,
    damageReducePhaseEndTime: 0,

    devSpeedBoost: false
  };

  const teamName = team === 'blue' ? '블루팀' : '레드팀';
  const champNameMap = { lux: '럭스', ashe: '애쉬', aatrox: '아트록스', garen: '가렌' };
  const champName = champNameMap[champion] || '가렌';
  io.emit('chatMessage', {
    username: '시스템',
    text: `${socket.username}님이 ${champName}(으)로 ${teamName}에 입장하셨습니다.`,
    isSystem: true,
    targetMode: 'all'
  });

  socket.on('keyMove', (dir) => {
    const p = players[socket.id];
    if (!p || p.isDead) return;

    if (p.isRecalling) {
      // 실제 이동 입력이 들어오면 귀환 취소, 그 외(키를 뗀 경우 등)는 무시하고 귀환 유지
      if (dir.x !== 0 || dir.y !== 0) {
        p.isRecalling = false;
        p.dirX = dir.x;
        p.dirY = dir.y;
        p.facingX = dir.x;
        p.facingY = dir.y;
      }
      return;
    }

    p.dirX = dir.x;
    p.dirY = dir.y;
    if (dir.x !== 0 || dir.y !== 0) {
      p.facingX = dir.x;
      p.facingY = dir.y;
    }
  });

  socket.on('useQ', () => {
    const p = players[socket.id];
    if (!p || p.isDead || p.isStunned) return;

    const now = Date.now();

    if (p.champion === 'lux') {
      if (now - p.lastQTime < p.qCooldown) return;
      if (p.mana < LUX_Q_MANA_COST) return;

      let dx = p.facingX, dy = p.facingY;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= len; dy /= len;

      p.lastQTime = now;
      p.mana -= LUX_Q_MANA_COST;

      const projId = 'proj_' + (projectileIdCounter++);
      projectiles[projId] = {
        id: projId,
        type: 'luxQ',
        ownerId: socket.id,
        team: p.team,
        x: p.x,
        y: p.y,
        dirX: dx,
        dirY: dy,
        speed: LUX_Q_PROJECTILE_SPEED,
        damage: LUX_Q_DAMAGE,
        maxDistance: LUX_Q_RANGE,
        traveled: 0,
        hitTargets: [],
        hitCount: 0
      };
      return;
    }

    // 애쉬/아트록스는 Q 수동 시전 없음
    if (p.champion !== 'garen') return;

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
    if (!p || p.isDead || p.isStunned) return;

    const now = Date.now();

    if (p.champion === 'lux') {
      if (now - p.lastWTime < p.wCooldown) return;
      if (p.mana < LUX_W_MANA_COST) return;

      let dx = p.facingX, dy = p.facingY;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= len; dy /= len;

      p.lastWTime = now;
      p.mana -= LUX_W_MANA_COST;

      const projId = 'proj_' + (projectileIdCounter++);
      projectiles[projId] = {
        id: projId,
        type: 'luxW',
        ownerId: socket.id,
        team: p.team,
        x: p.x,
        y: p.y,
        dirX: dx,
        dirY: dy,
        speed: LUX_W_PROJECTILE_SPEED,
        maxDistance: LUX_W_RANGE,
        traveled: 0,
        phase: 'out',
        hitCounts: {}
      };
      return;
    }

    if (p.champion === 'ashe') {
      if (now - p.lastWTime < p.wCooldown) return;
      if (p.mana < ASHE_W_MANA_COST) return;

      let dx = p.facingX, dy = p.facingY;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= len; dy /= len;
      const baseAngle = Math.atan2(dy, dx);

      p.lastWTime = now;
      p.mana -= ASHE_W_MANA_COST;

      const sharedHitTracker = [];
      const count = ASHE_W_ARROW_COUNT;
      const startDeg = -ASHE_W_SPREAD_DEG / 2;
      const stepDeg = ASHE_W_SPREAD_DEG / (count - 1);

      for (let i = 0; i < count; i++) {
        const angle = baseAngle + (startDeg + stepDeg * i) * Math.PI / 180;
        const adx = Math.cos(angle), ady = Math.sin(angle);
        const projId = 'proj_' + (projectileIdCounter++);
        projectiles[projId] = {
          id: projId,
          type: 'asheW',
          ownerId: socket.id,
          team: p.team,
          x: p.x,
          y: p.y,
          dirX: adx,
          dirY: ady,
          speed: ASHE_W_ARROW_SPEED,
          damage: p.attackDamage,
          maxDistance: ASHE_W_RANGE,
          traveled: 0,
          hitTracker: sharedHitTracker
        };
      }
      return;
    }

    // 가렌 W (기존 로직) / 아트록스는 아직 미구현이라 아무 동작 없음
    if (p.champion !== 'garen') return;
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
    if (!p || p.isDead || p.isStunned) return;

    const now = Date.now();

    if (p.champion === 'lux') {
      // 이미 날아가고 있거나 활성화된 자신의 특이점이 있으면 즉시 터뜨림 (쿨타임/마나 소모 없음)
      for (let pid in projectiles) {
        const proj = projectiles[pid];
        if (proj.type === 'luxE' && proj.ownerId === socket.id) {
          explodeLuxE(proj, now);
          delete projectiles[pid];
          return;
        }
      }

      // 새로 시전
      if (now - p.lastETime < p.eCooldown) return;
      if (p.mana < LUX_E_MANA_COST) return;

      let dx = p.facingX, dy = p.facingY;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= len; dy /= len;

      p.lastETime = now;
      p.mana -= LUX_E_MANA_COST;

      const projId = 'proj_' + (projectileIdCounter++);
      projectiles[projId] = {
        id: projId,
        type: 'luxE',
        ownerId: socket.id,
        team: p.team,
        x: p.x,
        y: p.y,
        dirX: dx,
        dirY: dy,
        speed: LUX_E_PROJECTILE_SPEED,
        maxDistance: LUX_E_RANGE,
        traveled: 0,
        phase: 'flying',
        explodeAt: null
      };
      return;
    }

    if (p.champion === 'ashe') {
      if (now - p.lastETime < p.eCooldown) return;

      p.lastETime = now;
      p.visionBoostEndTime = now + ASHE_E_VISION_DURATION;
      return;
    }

    // 가렌 E (기존 로직) / 아트록스는 아직 미구현
    if (p.champion !== 'garen') return;
    if (now - p.lastETime < p.eCooldown) return;

    p.lastETime = now;
    p.isEActive = true;
    p.eStartTime = now;
    p.eHitCount = {};
  });

  socket.on('useR', () => {
    const p = players[socket.id];
    if (!p || p.isDead || p.isStunned) return;

    const now = Date.now();

    if (p.champion === 'lux') {
      if (p.isCastingR) return; // 이미 시전 중이면 무시
      if (now - p.lastRTime < p.rCooldown) return;
      if (p.mana < LUX_R_MANA_COST) return;

      let dx = p.facingX, dy = p.facingY;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= len; dy /= len;

      p.lastRTime = now;
      p.mana -= LUX_R_MANA_COST;
      p.rCastDirX = dx;
      p.rCastDirY = dy;

      if (LUX_R_CAST_DELAY <= 0) {
        // 선딜 없이 즉시 발동
        fireLuxR(p, socket.id, now);
      } else {
        p.isCastingR = true;
        p.rCastEndTime = now + LUX_R_CAST_DELAY;
      }
      return;
    }

    if (p.champion === 'ashe') {
      if (now - p.lastRTime < p.rCooldown) return;
      if (p.mana < ASHE_R_MANA_COST) return;

      let dx = p.facingX, dy = p.facingY;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= len; dy /= len;

      p.lastRTime = now;
      p.mana -= ASHE_R_MANA_COST;

      const projId = 'proj_' + (projectileIdCounter++);
      projectiles[projId] = {
        id: projId,
        type: 'asheR',
        ownerId: socket.id,
        team: p.team,
        x: p.x,
        y: p.y,
        dirX: dx,
        dirY: dy,
        speed: ASHE_R_SPEED,
        damage: ASHE_R_DAMAGE,
        maxDistance: MAP_SIZE * 2,
        traveled: 0
      };
      return;
    }

    // 가렌 R (기존 로직) / 아트록스는 아직 미구현
    const caster = p;
    if (caster.champion !== 'garen') return;
    if (now - caster.lastRTime < caster.rCooldown) return;

    let fx = caster.facingX, fy = caster.facingY;
    const fLen = Math.sqrt(fx * fx + fy * fy) || 1;
    fx /= fLen; fy /= fLen;

    let candidates = [];
    for (let tid in players) {
      if (tid === socket.id) continue;
      const target = players[tid];
      if (target.team === caster.team || target.isDead) continue;

      const dx = target.x - caster.x;
      const dy = target.y - caster.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist === 0 || dist > R_RANGE) continue;

      const ndx = dx / dist, ndy = dy / dist;
      const dot = Math.max(-1, Math.min(1, fx * ndx + fy * ndy));
      const angle = Math.acos(dot);

      if (angle <= R_HALF_ANGLE) {
        candidates.push({ id: tid, target, dist });
      }
    }

    // 지정할 대상이 없으면 스킬이 나가지 않은 것으로 취급 (쿨타임 소모 없음)
    if (candidates.length === 0) return;

    candidates.sort((a, b) => a.dist - b.dist);
    const chosen = candidates[0].target;

    caster.lastRTime = now;

    chosen.isRMarked = true;
    chosen.rMarkStartTime = now;
    chosen.rImpactTime = now + R_IMPACT_DELAY;
    chosen.rCasterId = socket.id;
    chosen.rCasterUsername = caster.username;
  });

  socket.on('recall', () => {
    const p = players[socket.id];
    if (!p || p.isDead || p.isRecalling) return;

    p.isRecalling = true;
    p.recallStartTime = Date.now();
  });

  socket.on('devResetCooldowns', () => {
    const p = players[socket.id];
    if (!p || socket.username !== DEV_USERNAME) return;

    p.lastQTime = 0;
    p.lastWTime = 0;
    p.lastETime = 0;
    p.lastRTime = 0;
  });

  socket.on('devToggleSpeedBoost', () => {
    const p = players[socket.id];
    if (!p || socket.username !== DEV_USERNAME) return;

    p.devSpeedBoost = !p.devSpeedBoost;
  });

  socket.on('attack', () => {
    const p = players[socket.id];
    const now = Date.now();
    if (!p || p.isDead || p.isStunned) return;

    const baseAttackCooldown = (CHAMPION_BASE_STATS[p.champion] && CHAMPION_BASE_STATS[p.champion].attackCooldown) || 1000;
    const attackCooldown = (p.champion === 'ashe' && now < p.attackSpeedBoostEndTime) ? ASHE_Q_ATTACK_COOLDOWN_BOOSTED : baseAttackCooldown;

    if (p.isAttacking || p.isEActive || (now - p.lastAttackTime < attackCooldown)) return;

    p.isAttacking = true;
    p.attackProgress = 0;
    p.lastAttackTime = now;

    if (p.champion === 'lux') {
      // 럭스 평타: 바라보는 방향으로 분홍색 구체 발사
      let dx = p.facingX, dy = p.facingY;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= len; dy /= len;

      const projId = 'proj_' + (projectileIdCounter++);
      projectiles[projId] = {
        id: projId,
        type: 'luxAttack',
        ownerId: socket.id,
        team: p.team,
        x: p.x,
        y: p.y,
        dirX: dx,
        dirY: dy,
        speed: LUX_PROJECTILE_SPEED,
        damage: p.attackDamage,
        maxDistance: p.attackRange,
        traveled: 0
      };
      return;
    }

    if (p.champion === 'ashe') {
      // 애쉬 평타: 바라보는 방향으로 화살 발사
      let dx = p.facingX, dy = p.facingY;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= len; dy /= len;

      const projId = 'proj_' + (projectileIdCounter++);
      projectiles[projId] = {
        id: projId,
        type: 'asheAttack',
        ownerId: socket.id,
        team: p.team,
        x: p.x,
        y: p.y,
        dirX: dx,
        dirY: dy,
        speed: ASHE_ATTACK_PROJECTILE_SPEED,
        damage: p.attackDamage,
        maxDistance: p.attackRange,
        traveled: 0
      };
      return;
    }

    // 가렌 / 아트록스 평타 (근접, 공용 로직)
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

      if (dist <= p.attackRange) {
        // 전투 판정: 실제로 스치기만 해도 전투 중으로 취급 (가렌 패시브용)
        p.lastCombatTime = now;
        target.lastCombatTime = now;

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

          // 공격을 맞으면 귀환 취소
          if (target.isRecalling) {
            target.isRecalling = false;
          }
          
          if (target.hp === 0) {
            target.isDead = true;
            target.respawnTime = Date.now() + 10000;
            resetOnDeathBuffs(target);

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
    const dc = players[socket.id];
    if (dc) {
      // 지정 대상이 접속을 끊으면 스킬을 못 쓴 것과 같으므로 시전자 쿨타임 환급
      if (dc.isRMarked) {
        refundRCooldown(dc.rCasterId);
      }

      io.emit('chatMessage', {
        username: '시스템',
        text: `${dc.username}님이 퇴장하셨습니다.`,
        isSystem: true,
        targetMode: 'all'
      });
      delete players[socket.id];
    }
  });
});

setInterval(() => {
  const now = Date.now();

  // === 투사체 이동 및 충돌 처리 ===
  for (let pid in projectiles) {
    const proj = projectiles[pid];

    // 럭스 W(프리즘 보호막): 아군 전용 부메랑, 별도 로직
    if (proj.type === 'luxW') {
      const moveDist = proj.speed / 60;

      if (proj.phase === 'out') {
        proj.x += proj.dirX * moveDist;
        proj.y += proj.dirY * moveDist;
        proj.traveled += moveDist;

        if (proj.traveled >= proj.maxDistance || proj.x < 0 || proj.x > MAP_SIZE || proj.y < 0 || proj.y > MAP_SIZE) {
          proj.phase = 'return';
        }
      } else {
        const owner = players[proj.ownerId];
        if (!owner) { delete projectiles[pid]; continue; }

        const odx = owner.x - proj.x;
        const ody = owner.y - proj.y;
        const odist = Math.sqrt(odx * odx + ody * ody);

        if (odist <= moveDist || odist < 8) {
          delete projectiles[pid];
          continue;
        }
        proj.x += (odx / odist) * moveDist;
        proj.y += (ody / odist) * moveDist;
      }

      for (let tid in players) {
        const target = players[tid];
        if (target.team !== proj.team || target.isDead) continue;

        const hitsSoFar = proj.hitCounts[tid] || 0;
        if (hitsSoFar >= LUX_W_MAX_HITS_PER_TARGET) continue;

        const tdx = target.x - proj.x;
        const tdy = target.y - proj.y;
        const tdist = Math.sqrt(tdx * tdx + tdy * tdy);

        if (tdist <= LUX_W_HIT_RADIUS) {
          target.shield = (target.shield || 0) + LUX_W_SHIELD_AMOUNT;
          target.luxShieldEndTime = now + LUX_W_SHIELD_DURATION;
          proj.hitCounts[tid] = hitsSoFar + 1;
        }
      }

      continue;
    }

    // 럭스 E(빛의 특이점): 비행 → 착지 후 활성 구역(지속 둔화) → 폭발
    if (proj.type === 'luxE') {
      if (proj.phase === 'flying') {
        const moveDist = proj.speed / 60;
        proj.x += proj.dirX * moveDist;
        proj.y += proj.dirY * moveDist;
        proj.traveled += moveDist;

        if (proj.traveled >= proj.maxDistance || proj.x < 0 || proj.x > MAP_SIZE || proj.y < 0 || proj.y > MAP_SIZE) {
          proj.phase = 'active';
          proj.explodeAt = now + LUX_E_FUSE_DURATION;
        }
      }

      if (proj.phase === 'active') {
        for (let tid in players) {
          const target = players[tid];
          if (target.team === proj.team || target.isDead) continue;

          const tdx = target.x - proj.x;
          const tdy = target.y - proj.y;
          const tdist = Math.sqrt(tdx * tdx + tdy * tdy);

          if (tdist <= LUX_E_RADIUS) {
            target.isSlowed = true;
            target.slowEndTime = now + 200; // 영역 안에 있는 동안 매틱 갱신되는 지속 둔화
          }
        }

        if (now >= proj.explodeAt) {
          explodeLuxE(proj, now);
          delete projectiles[pid];
        }
      }

      continue;
    }

    // 애쉬 Q 강화 화살(곡선 이동)
    if (proj.type === 'asheQArrow') {
      proj.elapsed = (proj.elapsed || 0) + (1 / 60);
      const t = Math.min(1, proj.elapsed / proj.duration);
      const it = 1 - t;
      proj.x = it * it * proj.startX + 2 * it * t * proj.ctrlX + t * t * proj.endX;
      proj.y = it * it * proj.startY + 2 * it * t * proj.ctrlY + t * t * proj.endY;

      let hit = false;
      for (let tid in players) {
        const target = players[tid];
        if (target.team === proj.team || target.isDead) continue;

        const tdx = target.x - proj.x, tdy = target.y - proj.y;
        const tdist = Math.sqrt(tdx * tdx + tdy * tdy);

        if (tdist <= ASHE_Q_HIT_RADIUS) {
          const owner = players[proj.ownerId];
          if (owner) owner.lastCombatTime = now;
          target.lastCombatTime = now;

          let mitigation = target.armor + (target.wBonusStats || 0);
          if (target.isArmorDebuffed) mitigation *= 0.75;
          let incomingDamage = Math.max(1, proj.damage - mitigation);
          if (target.hasDamageReducePhase) incomingDamage *= 0.7;

          if (target.shield > 0) {
            if (target.shield >= incomingDamage) { target.shield -= incomingDamage; incomingDamage = 0; }
            else { incomingDamage -= target.shield; target.shield = 0; }
          }

          if (incomingDamage > 0) {
            target.hp = Math.max(0, target.hp - incomingDamage);
            if (target.isRecalling) target.isRecalling = false;

            if (target.hp === 0) {
              target.isDead = true;
              target.respawnTime = now + 10000;
              resetOnDeathBuffs(target);

              if (owner) {
                if (owner.wBonusStats < 30) owner.wBonusStats = Math.min(30, owner.wBonusStats + 0.2);
                io.emit('chatMessage', {
                  username: '시스템',
                  text: `${owner.username}님이 ${target.username}님을 처치했습니다!`,
                  isSystem: true,
                  targetMode: 'all'
                });
              }
            }
          }

          if (!target.isDead) {
            target.isSlowed = true;
            target.slowEndTime = now + ASHE_Q_SLOW_DURATION;
          }

          hit = true;
          break;
        }
      }

      if (hit || t >= 1) {
        delete projectiles[pid];
      }
      continue;
    }

    // 애쉬 R(마법의 수정 화살): 단일 대상, 거리비례 기절
    if (proj.type === 'asheR') {
      const moveDist = proj.speed / 60;
      proj.x += proj.dirX * moveDist;
      proj.y += proj.dirY * moveDist;
      proj.traveled += moveDist;

      let hit = false;

      for (let tid in players) {
        const target = players[tid];
        if (target.team === proj.team || target.isDead) continue;

        const tdx = target.x - proj.x, tdy = target.y - proj.y;
        const tdist = Math.sqrt(tdx * tdx + tdy * tdy);

        if (tdist <= ASHE_R_HIT_RADIUS) {
          const owner = players[proj.ownerId];
          if (owner) owner.lastCombatTime = now;
          target.lastCombatTime = now;

          let mitigation = target.armor + (target.wBonusStats || 0);
          if (target.isArmorDebuffed) mitigation *= 0.75;
          let incomingDamage = Math.max(1, proj.damage - mitigation);
          if (target.hasDamageReducePhase) incomingDamage *= 0.7;

          if (target.shield > 0) {
            if (target.shield >= incomingDamage) { target.shield -= incomingDamage; incomingDamage = 0; }
            else { incomingDamage -= target.shield; target.shield = 0; }
          }

          if (incomingDamage > 0) {
            target.hp = Math.max(0, target.hp - incomingDamage);
            if (target.isRecalling) target.isRecalling = false;

            if (target.hp === 0) {
              target.isDead = true;
              target.respawnTime = now + 10000;
              resetOnDeathBuffs(target);

              if (owner) {
                if (owner.wBonusStats < 30) owner.wBonusStats = Math.min(30, owner.wBonusStats + 0.2);
                io.emit('chatMessage', {
                  username: '시스템',
                  text: `${owner.username}님이 궁극기로 ${target.username}님을 처치했습니다!`,
                  isSystem: true,
                  targetMode: 'all'
                });
              }
            }
          }

          if (!target.isDead) {
            const distRatio = Math.max(0, Math.min(1, proj.traveled / MAP_SIZE));
            const stunDuration = ASHE_R_MIN_STUN + (ASHE_R_MAX_STUN - ASHE_R_MIN_STUN) * distRatio;
            target.isStunned = true;
            target.stunEndTime = now + stunDuration;

            target.isSlowed = true;
            target.slowEndTime = now + ASHE_PASSIVE_SLOW_DURATION;
          }

          hit = true;
          break;
        }
      }

      if (hit || proj.x < 0 || proj.x > MAP_SIZE || proj.y < 0 || proj.y > MAP_SIZE) {
        delete projectiles[pid];
      }
      continue;
    }

    // 애쉬 평타(asheAttack) / W(asheW): 직선 이동, 관통 없음
    if (proj.type === 'asheAttack' || proj.type === 'asheW') {
      const moveDist = proj.speed / 60;
      proj.x += proj.dirX * moveDist;
      proj.y += proj.dirY * moveDist;
      proj.traveled += moveDist;

      let hit = false;

      for (let tid in players) {
        const target = players[tid];
        if (target.team === proj.team || target.isDead) continue;
        if (proj.hitTracker && proj.hitTracker.includes(tid)) continue;

        const tdx = target.x - proj.x, tdy = target.y - proj.y;
        const tdist = Math.sqrt(tdx * tdx + tdy * tdy);

        if (tdist <= ASHE_W_HIT_RADIUS) {
          const owner = players[proj.ownerId];
          if (owner) owner.lastCombatTime = now;
          target.lastCombatTime = now;

          let mitigation = target.armor + (target.wBonusStats || 0);
          if (target.isArmorDebuffed) mitigation *= 0.75;
          let incomingDamage = Math.max(1, proj.damage - mitigation);
          if (target.hasDamageReducePhase) incomingDamage *= 0.7;

          if (target.shield > 0) {
            if (target.shield >= incomingDamage) { target.shield -= incomingDamage; incomingDamage = 0; }
            else { incomingDamage -= target.shield; target.shield = 0; }
          }

          if (incomingDamage > 0) {
            target.hp = Math.max(0, target.hp - incomingDamage);
            if (target.isRecalling) target.isRecalling = false;

            if (target.hp === 0) {
              target.isDead = true;
              target.respawnTime = now + 10000;
              resetOnDeathBuffs(target);

              if (owner) {
                if (owner.wBonusStats < 30) owner.wBonusStats = Math.min(30, owner.wBonusStats + 0.2);
                io.emit('chatMessage', {
                  username: '시스템',
                  text: `${owner.username}님이 ${target.username}님을 처치했습니다!`,
                  isSystem: true,
                  targetMode: 'all'
                });
              }
            }
          }

          if (!target.isDead) {
            // 애쉬 패시브: W는 2배 지속시간
            const slowDur = proj.type === 'asheW' ? ASHE_PASSIVE_SLOW_DURATION * 2 : ASHE_PASSIVE_SLOW_DURATION;
            target.isSlowed = true;
            target.slowEndTime = now + slowDur;
          }

          // 애쉬 평타 명중 시 포커스 스택
          if (proj.type === 'asheAttack' && owner && !target.isDead) {
            applyAsheFocusStack(owner, now);
          }

          if (proj.hitTracker) proj.hitTracker.push(tid);
          hit = true;
          break;
        }
      }

      if (hit || proj.traveled >= proj.maxDistance || proj.x < 0 || proj.x > MAP_SIZE || proj.y < 0 || proj.y > MAP_SIZE) {
        delete projectiles[pid];
      }
      continue;
    }

    // 럭스 평타(luxAttack) / Q(luxQ): 적 대상 판정
    const moveDist = proj.speed / 60;
    proj.x += proj.dirX * moveDist;
    proj.y += proj.dirY * moveDist;
    proj.traveled += moveDist;

    const isQ = proj.type === 'luxQ';
    const hitRadius = isQ ? LUX_Q_HIT_RADIUS : LUX_PROJECTILE_HIT_RADIUS;

    let destroyNow = false;

    for (let tid in players) {
      const target = players[tid];
      if (target.team === proj.team || target.isDead) continue;
      if (isQ && proj.hitTargets.includes(tid)) continue;

      const tdx = target.x - proj.x;
      const tdy = target.y - proj.y;
      const tdist = Math.sqrt(tdx * tdx + tdy * tdy);

      if (tdist <= hitRadius) {
        const owner = players[proj.ownerId];
        if (owner) owner.lastCombatTime = now;
        target.lastCombatTime = now;

        // 데미지 계산: 럭스 스킬(Q)은 마법 피해라 마법저항력 적용, 평타는 방어력 적용
        let mitigation;
        if (isQ) {
          mitigation = target.magicResist;
        } else {
          mitigation = target.armor + target.wBonusStats;
          if (target.isArmorDebuffed) mitigation *= 0.75;
        }

        let incomingDamage = Math.max(1, proj.damage - mitigation);
        if (target.hasDamageReducePhase) incomingDamage *= 0.7;

        // 럭스 패시브(광채): 표식이 있으면 추가 피해 + 표식 소모
        if (target.isLuxMarked && target.luxMarkedBy === proj.ownerId) {
          incomingDamage += LUX_PASSIVE_BONUS_DAMAGE;
          target.isLuxMarked = false;
        }

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

          if (target.isRecalling) {
            target.isRecalling = false;
          }

          if (target.hp === 0) {
            target.isDead = true;
            target.respawnTime = now + 10000;
            resetOnDeathBuffs(target);

            if (owner) {
              if (owner.wBonusStats < 30) {
                owner.wBonusStats = Math.min(30, owner.wBonusStats + 0.2);
              }
              io.emit('chatMessage', {
                username: '시스템',
                text: `${owner.username}님이 ${target.username}님을 처치했습니다!`,
                isSystem: true,
                targetMode: 'all'
              });
            }
          }
        }

        // 럭스의 평타/스킬에 맞으면(적 대상) 무조건 표식 (재)적용
        if (!target.isDead) {
          target.isLuxMarked = true;
          target.luxMarkedBy = proj.ownerId;
          target.luxMarkEndTime = now + LUX_PASSIVE_MARK_DURATION;
        }

        // Q 전용: 속박 부여, 최대 2명까지 관통
        if (isQ && !target.isDead) {
          target.isRooted = true;
          target.rootEndTime = now + LUX_Q_ROOT_DURATION;

          proj.hitTargets.push(tid);
          proj.hitCount++;

          if (proj.hitCount >= LUX_Q_MAX_TARGETS) destroyNow = true;
        } else if (!isQ) {
          destroyNow = true; // 평타는 한 명 맞으면 소멸
        }

        break;
      }
    }

    if (destroyNow || proj.traveled >= proj.maxDistance || proj.x < 0 || proj.x > MAP_SIZE || proj.y < 0 || proj.y > MAP_SIZE) {
      delete projectiles[pid];
    }
  }

  for (let id in players) {
    const p = players[id];

    if (p.isDead) {
      // 궁극기 판정 전에 다른 이유로 대상이 죽으면(스킬이 실패한 것으로 취급) 시전자 쿨타임 환급
      if (p.isRMarked) {
        refundRCooldown(p.rCasterId);
        p.isRMarked = false;
        p.rCasterId = null;
        p.rCasterUsername = null;
      }

      if (now >= p.respawnTime) {
        p.isDead = false;
        p.hp = p.maxHp;
        p.mana = p.maxMana;
        p.x = p.team === 'blue' ? 100 : 1900;
        p.y = p.team === 'blue' ? 1900 : 100;
        p.dirX = 0;
        p.dirY = 0;
        p.isRooted = false;
        p.isLuxMarked = false;
        p.isSlowed = false;
        p.isStunned = false;
        p.luxShieldEndTime = 0;
        p.isCastingR = false;
        p.asheFocusStacks = 0;

        // 부활 시 모든 스킬 쿨타임 초기화
        p.lastQTime = 0;
        p.lastWTime = 0;
        p.lastETime = 0;
        p.lastRTime = 0;
      }
      continue;
    }

    // 상대 팀 우물에 들어가면 레이저에 즉시 전멸 (틱당 최대체력 100% 피해)
    const enemyFountain = FOUNTAIN_POS[p.team === 'blue' ? 'red' : 'blue'];
    if (enemyFountain) {
      const edx = p.x - enemyFountain.x;
      const edy = p.y - enemyFountain.y;
      const edist = Math.sqrt(edx * edx + edy * edy);
      if (edist <= FOUNTAIN_RADIUS) {
        p.hp = 0;
        p.isDead = true;
        p.respawnTime = now + 10000;
        p.isRecalling = false;
        resetOnDeathBuffs(p);

        io.emit('chatMessage', {
          username: '시스템',
          text: `${p.username}님이 적의 우물에 들어가 전멸했습니다!`,
          isSystem: true,
          targetMode: 'all'
        });

        continue; // 사망 처리 후 이번 틱 나머지 로직 건너뛰기
      }
    }

    if (p.isArmorDebuffed && now >= p.armorDebuffEndTime) {
      p.isArmorDebuffed = false;
    }

    if (p.isLuxMarked && now >= p.luxMarkEndTime) {
      p.isLuxMarked = false;
    }

    if (p.isRooted && now >= p.rootEndTime) {
      p.isRooted = false;
    }

    if (p.isSlowed && now >= p.slowEndTime) {
      p.isSlowed = false;
    }

    if (p.isStunned && now >= p.stunEndTime) {
      p.isStunned = false;
    }

    if (p.luxShieldEndTime > 0 && now >= p.luxShieldEndTime) {
      p.shield = 0;
      p.luxShieldEndTime = 0;
    }

    if (p.isCastingR && now >= p.rCastEndTime) {
      p.isCastingR = false;
      fireLuxR(p, id, now);
    }

    if (p.isRecalling) {
      if (now - p.recallStartTime >= 8000) {
        p.isRecalling = false;
        p.x = p.team === 'blue' ? 100 : 1900;
        p.y = p.team === 'blue' ? 1900 : 100;
        p.dirX = 0;
        p.dirY = 0;
      }
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
            // 전투 판정 (가렌 패시브용)
            p.lastCombatTime = now;
            target.lastCombatTime = now;

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

              // 공격을 맞으면 귀환 취소
              if (target.isRecalling) {
                target.isRecalling = false;
              }
              
              p.eHitCount[tId] = (p.eHitCount[tId] || 0) + 1;
              
              if (p.eHitCount[tId] >= 6) {
                target.isArmorDebuffed = true;
                target.armorDebuffEndTime = now + 6000;
              }

              if (target.hp === 0) {
                target.isDead = true;
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

    // R스킬(궁극기) 판정 시각(rImpactTime) 도달 시 데미지 적용
    if (p.isRMarked && now >= p.rImpactTime) {
      p.isRMarked = false;

      const rCaster = players[p.rCasterId];
      p.lastCombatTime = now;
      if (rCaster) rCaster.lastCombatTime = now;

      const hpPercent = p.hp / p.maxHp;

      if (hpPercent <= 0.3) {
        p.hp = 0;
      } else {
        p.hp = Math.max(0, p.hp - p.maxHp * 0.15);
      }

      if (p.isRecalling) {
        p.isRecalling = false;
      }

      if (p.hp === 0) {
        p.isDead = true;
        p.respawnTime = now + 10000;
        resetOnDeathBuffs(p);

        if (rCaster && rCaster.wBonusStats < 30) {
          rCaster.wBonusStats = Math.min(30, rCaster.wBonusStats + 0.2);
        }

        io.emit('chatMessage', {
          username: '시스템',
          text: `${p.rCasterUsername || '알 수 없음'}님이 궁극기로 ${p.username}님을 처치했습니다!`,
          isSystem: true,
          targetMode: 'all'
        });

        p.rCasterId = null;
        p.rCasterUsername = null;
        continue; // 사망 처리 이후 이번 틱의 나머지 로직(회복, 이동 등) 건너뛰기
      }

      p.rCasterId = null;
      p.rCasterUsername = null;
    }

    if (p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, p.hp + (p.hpRegen / 60));
    }

    if (p.mana < p.maxMana) {
      p.mana = Math.min(p.maxMana, p.mana + (p.manaRegen / 60));
    }

    // 우물(스폰) 반경 내에 있으면 초당 최대체력의 20% 추가 회복
    const fountain = FOUNTAIN_POS[p.team];
    if (fountain) {
      const fdx = p.x - fountain.x;
      const fdy = p.y - fountain.y;
      const fdist = Math.sqrt(fdx * fdx + fdy * fdy);
      if (fdist <= FOUNTAIN_RADIUS && p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + (p.maxHp * FOUNTAIN_HEAL_PERCENT_PER_SEC) / 60);
      }
    }

    // 가렌 패시브: 15초 동안 전투가 없으면, 이후 5초마다 최대체력의 1.5% 회복
    if (now - p.lastCombatTime >= PASSIVE_COMBAT_TIMEOUT && now >= p.nextPassiveTickTime) {
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * PASSIVE_HEAL_PERCENT);
      p.nextPassiveTickTime = now + PASSIVE_TICK_INTERVAL;
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
      // 스윙 애니메이션 자체의 재생 속도 (공격 쿨타임/공속과는 별개).
      // 아트록스만 1.3배 빠르게 재생되도록 함.
      const progressStep = p.champion === 'aatrox' ? 0.05 * 1.3 : 0.05;
      p.attackProgress += progressStep;
      if (p.attackProgress >= 1) {
        p.isAttacking = false;
        p.attackProgress = 0;
      }
    }

    if (!p.isRecalling && !p.isRooted && !p.isStunned) {
      let currentSpeed = p.baseMoveSpeed;
      if (p.hasSpeedBuff) currentSpeed *= 1.35;
      if (p.isEActive) currentSpeed *= 1.3;
      if (p.devSpeedBoost) currentSpeed *= 5;
      if (p.isSlowed) currentSpeed *= LUX_SLOW_MULTIPLIER;

      let moveX = p.dirX, moveY = p.dirY;
      if (moveX !== 0 && moveY !== 0) {
        moveX *= 0.7071; moveY *= 0.7071;
      }

      const nextX = p.x + moveX * currentSpeed;
      const nextY = p.y + moveY * currentSpeed;

      if (nextX >= 10 && nextX <= MAP_SIZE - 10 && !isColliding(nextX, p.y)) p.x = nextX;
      if (nextY >= 10 && nextY <= MAP_SIZE - 10 && !isColliding(p.x, nextY)) p.y = nextY;
    }
  }
  io.emit('gameState', { players, projectiles });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`게임 서버 작동 중 (포트: ${PORT})`); });
