// 기존 SPEED = 6 에서 실제 롤 비율에 맞춘 SPEED = 3.8 로 변경
setInterval(() => {
  const SPEED = 3.8; // 실제 롤의 걷기 속도 감각 반영

  for (let id in players) {
    const p = players[id];
    
    let moveX = p.dirX;
    let moveY = p.dirY;

    // 대각선 이동 시 속도 증가 방지 (1 / sqrt(2) 약 0.7071)
    if (moveX !== 0 && moveY !== 0) {
      moveX *= 0.7071;
      moveY *= 0.7071;
    }

    const nextX = p.x + moveX * SPEED;
    const nextY = p.y + moveY * SPEED;

    // 검은색 맵 바깥 경계선 충돌 판정
    if (isPointInMap(nextX, p.y)) {
      p.x = nextX;
    }
    if (isPointInMap(p.x, nextY)) {
      p.y = nextY;
    }
  }

  io.emit('gameState', { players, inhibitors });
}, 1000 / 60);
