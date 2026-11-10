const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const statusText = document.getElementById("status");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;

const GRAVITY = 1500;
const MOVE_SPEED = 320;
const ACCELERATION = 1800;
const FRICTION = 1800;
const JUMP_FORCE = 600;
const BALL_RADIUS = 16;

const PLAYER_SHOT_SPEED = 780;
let PLAYER_SHOT_COOLDOWN = 0.25;
const ENEMY_SHOT_SPEED = 170;

const MOVING_PLATFORM_SPEED = 95;
const MOVING_PLATFORM_LIFETIME = 6;

let currentLevelIndex = 0;
let level;
let cameraX = 0;
let cameraY = 0;
let gameWon = false;

let facing = 1;
let shootQueued = false;
let shootCooldown = 0;
let jumpQueued = false;
let platformQueued = false;
let platformCharges = 3;
let playerHealth = 1;
let playerInvulnerability = 0;

let nextPlatformId = 1;
let ridingPlatformId = null;

let dying = false;
let deathTimer = 0;

let particles = [];
let playerShots = [];
let enemyShots = [];
let movingPlatforms = [];
let enemies = [];

let currentSpikes = [];
let currentGrayPlatforms = [];

const keys = {
    left: false,
    right: false
};

const player = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: BALL_RADIUS,
    grounded: false
};


// ---------------- LEVEL LOADING ----------------

function loadLevel(index) {
    if (index >= LEVELS.length) {
        gameWon = true;
        statusText.textContent =
            `YOU COMPLETED ALL ${LEVELS.length} LEVELS! Press R to replay.`;
        return;
    }

    currentLevelIndex = index;
    level = LEVELS[index];
    gameWon = false;

    dying = false;
    deathTimer = 0;

    particles = [];
    playerShots = [];
    enemyShots = [];
    movingPlatforms = [];

    ridingPlatformId = null;
    nextPlatformId = 1;
    platformCharges = 3;
    playerHealth = 1;
    playerInvulnerability = 0;

    currentSpikes = (level.spikes || []).map(p => ({ ...p }));

    currentGrayPlatforms = [];

    // Breakable terrain is built from individual small tiles in a true grid.
    // Each tile can be shot independently, leaving holes that the player can
    // climb through or use as stepping stones.
    for (const p of (level.grayPlatforms || [])) {
        const tileW = p.tileW || 22;
        const tileH = p.tileH || 18;
        const gap = p.tileGap ?? 3;

        for (let y = p.y; y < p.y + p.h - 2; y += tileH + gap) {
            for (let x = p.x; x < p.x + p.w - 2; x += tileW + gap) {
                currentGrayPlatforms.push({
                    x,
                    y,
                    w: Math.min(tileW, p.x + p.w - x),
                    h: Math.min(tileH, p.y + p.h - y)
                });
            }
        }
    }

    enemies = (level.enemies || []).map(e => ({
        ...e,
        fireRate: e.type === "blue" ? 3.8 : Math.max(0.22, e.fireRate * 0.65),
        hp: 2,
        alive: true,
        direction: Math.random() < 0.5 ? -1 : 1,
        cooldown: Math.max(0.22, e.fireRate * 0.65) *
            (0.35 + Math.random() * 0.4),
        vy: 0,
        floatTime: 0,

        // Green enemies can hover independently.
        floatBaseY: e.y,
        floatPhase: Math.random() * Math.PI * 2,
        floatAmplitude: 24,
        burstShotsLeft: 0,
        burstTimer: 0
    }));

    player.x = level.start.x;
    player.y = level.start.y;
    player.vx = 0;
    player.vy = 0;
    player.grounded = false;

    facing = 1;

    shootCooldown = 0;
    shootQueued = false;
    jumpQueued = false;
    platformQueued = false;

    cameraX = 0;

    cameraY = Math.max(
        0,
        Math.min(level.worldHeight - HEIGHT, player.y - HEIGHT * 0.62)
    );

    statusText.textContent = level.name + " — Find the next floor!";
}

function restartLevel() {
    loadLevel(gameWon ? 0 : currentLevelIndex);
}


// ---------------- CONTROLS ----------------

window.addEventListener("keydown", e => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
    }

    if (e.key === "ArrowLeft") keys.left = true;
    if (e.key === "ArrowRight") keys.right = true;

    if (e.key === "ArrowUp" && !e.repeat) {
        jumpQueued = true;
    }

    if (e.key.toLowerCase() === "e" && !e.repeat) {
        shootQueued = true;
    }

    if (e.key.toLowerCase() === "t" && !e.repeat) {
        platformQueued = true;
    }

    if (e.key.toLowerCase() === "r" && !e.repeat) {
        restartLevel();
    }

    if (e.key === "0") {
        PLAYER_SHOT_COOLDOWN = Math.min(1.5, PLAYER_SHOT_COOLDOWN + 0.1);
    }

    if (e.key === "1") {
        PLAYER_SHOT_COOLDOWN = Math.max(0.05, PLAYER_SHOT_COOLDOWN - 0.1);
    }
});

window.addEventListener("keyup", e => {
    if (e.key === "ArrowLeft") keys.left = false;
    if (e.key === "ArrowRight") keys.right = false;
});

window.addEventListener("blur", () => {
    keys.left = false;
    keys.right = false;

    jumpQueued = false;
    shootQueued = false;
    platformQueued = false;
});


// ---------------- COLLISIONS ----------------

function overlaps(a, b) {
    const w = b.w ?? b.width;
    const h = b.h ?? b.height;

    return (
        a.x < b.x + w &&
        a.x + a.w > b.x &&
        a.y < b.y + h &&
        a.y + a.h > b.y
    );
}

function getPlayerBox() {
    return {
        x: player.x - player.radius,
        y: player.y - player.radius,
        w: player.radius * 2,
        h: player.radius * 2
    };
}

function circleRect(x, y, r, p) {
    const cx = Math.max(p.x, Math.min(x, p.x + p.w));
    const cy = Math.max(p.y, Math.min(y, p.y + p.h));

    return (
        (x - cx) ** 2 +
        (y - cy) ** 2 <= r * r
    );
}

function circleCircle(a, b) {
    return (
        (a.x - b.x) ** 2 +
        (a.y - b.y) ** 2 <=
        (a.radius + b.radius) ** 2
    );
}

function handleCollisions(axis) {
    const box = getPlayerBox();

    for (const p of [...level.platforms, ...currentGrayPlatforms]) {
        if (!overlaps(box, p)) continue;

        if (axis === "x") {
            if (player.vx > 0) {
                player.x = p.x - player.radius;
            } else if (player.vx < 0) {
                player.x = p.x + p.w + player.radius;
            }

            player.vx = 0;
        } else {
            if (player.vy > 0) {
                player.y = p.y - player.radius;
                player.grounded = true;
            } else if (player.vy < 0) {
                player.y = p.y + p.h + player.radius;
            }

            player.vy = 0;
        }

        Object.assign(box, getPlayerBox());
    }
}


// ---------------- PARTICLES ----------------

function createParticles(x, y, amount = 20, color = "white") {
    for (let i = 0; i < amount; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 100 + Math.random() * 300;
        const life = 0.55 + Math.random() * 0.4;

        particles.push({
            x,
            y,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            radius: 2 + Math.random() * 3,
            color,
            life,
            maxLife: life
        });
    }
}

function updateParticles(dt) {
    for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 350 * dt;
        p.life -= dt;
    }

    particles = particles.filter(p => p.life > 0);
}

function drawParticles() {
    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);

        ctx.fillStyle = p.color;
        ctx.fill();

        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "black";
        ctx.stroke();
    }

    ctx.globalAlpha = 1;
}


// ---------------- PLAYER DEATH ----------------

function triggerDeath() {
    if (dying || gameWon) return;

    dying = true;
    deathTimer = 0.85;

    createParticles(player.x, player.y, 40, "white");
}


// ---------------- PLAYER SHOOTING ----------------

function isAimingUp() {
    return !player.grounded;
}

function firePlayerShot() {
    const up = isAimingUp();

    playerShots.push({
        x: player.x + (up ? 0 : facing * (player.radius + 8)),
        y: player.y + (up ? -player.radius - 8 : 0),

        vx: up ? 0 : facing * PLAYER_SHOT_SPEED,
        vy: up ? -PLAYER_SHOT_SPEED : 0,

        radius: 5,
        dead: false
    });

    shootCooldown = PLAYER_SHOT_COOLDOWN;
}


// ---------------- T PLATFORMS ----------------

function fireMovingPlatform() {
    if (platformCharges <= 0) return;

    const up = isAimingUp();
    const w = 86;

    // No cooldown: charges are the only deployment limit.
    while (movingPlatforms.length >= 4) {
        const old = movingPlatforms.shift();
        createParticles(old.x + old.w / 2, old.y + old.h / 2, 12, "#d6a84b");

        if (ridingPlatformId === old.id) {
            ridingPlatformId = null;
            player.grounded = false;
        }
    }

    movingPlatforms.push({
        id: nextPlatformId++,
        x: up
            ? player.x - w / 2
            : player.x + facing * 38 - (facing < 0 ? w : 0),
        y: up ? player.y + player.radius + 18 : player.y + 18,
        w,
        h: 13,
        vx: up ? 0 : facing * MOVING_PLATFORM_SPEED,
        vy: up ? -MOVING_PLATFORM_SPEED : 0,
        prevX: 0,
        prevY: 0,
        life: MOVING_PLATFORM_LIFETIME,
        maxLife: MOVING_PLATFORM_LIFETIME,
        dead: false
    });

    platformCharges--;
}

function updateMovingPlatforms(dt) {
    for (const p of movingPlatforms) {
        p.prevX = p.x;
        p.prevY = p.y;

        p.x += p.vx * dt;
        p.y += p.vy * dt;

        p.life -= dt;

        if (p.life <= 0 && !p.dead) {
            p.dead = true;
            createParticles(p.x + p.w / 2, p.y + p.h / 2, 24, "#d6a84b");

            if (ridingPlatformId === p.id) {
                ridingPlatformId = null;
                player.grounded = false;
                player.vy = 0;
            }
        }

        if (
            p.x <= 0 ||
            p.x + p.w >= level.worldWidth
        ) {
            p.dead = true;

            createParticles(
                Math.max(
                    0,
                    Math.min(level.worldWidth, p.x + p.w / 2)
                ),
                p.y + p.h / 2,
                22,
                "#d6a84b"
            );

            if (ridingPlatformId === p.id) {
                ridingPlatformId = null;
                player.grounded = false;
                player.vy = 0;
            }
        }
    }

    movingPlatforms = movingPlatforms.filter(p =>
        !p.dead &&
        p.life > 0 &&
        p.x + p.w > -100 &&
        p.x < level.worldWidth + 100 &&
        p.y + p.h > -100 &&
        p.y < level.worldHeight + 100
    );

    if (
        ridingPlatformId !== null &&
        !movingPlatforms.some(p => p.id === ridingPlatformId)
    ) {
        ridingPlatformId = null;
        player.grounded = false;
    }
}

function landOnMovingPlatform(previousBottom) {
    for (const p of movingPlatforms) {
        const overlapX =
            player.x + player.radius > p.x &&
            player.x - player.radius < p.x + p.w;

        const crossed =
            previousBottom <= p.prevY + 3 &&
            player.y + player.radius >= p.y;

        if (overlapX && crossed && player.vy >= 0) {
            player.y = p.y - player.radius;
            player.vy = p.vy;
            player.grounded = true;
            ridingPlatformId = p.id;

            return;
        }
    }
}

function drawMovingPlatforms() {
    for (const p of movingPlatforms) {
        const alpha = Math.max(0.12, Math.min(1, p.life / 1.8));
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#d6a84b";
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#573d12";
        ctx.strokeRect(p.x, p.y, p.w, p.h);
        ctx.globalAlpha = 1;
    }
}


// ---------------- ENEMY PROJECTILES ----------------

function fireBlueBurst(enemy) {
    const x = enemy.x + enemy.size / 2;
    const y = enemy.y + enemy.size / 2;
    const baseAngle = Math.atan2(player.y - y, player.x - x);
    const spread = 0.19;

    for (let i = 0; i < 5; i++) {
        const angle = baseAngle + (i - 2) * spread;
        const speed = 145 + (i % 2) * 18;

        enemyShots.push({
            x,
            y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            radius: 7,
            dead: false,
            blueBurst: true
        });
    }
}

function damagePlayer() {
    if (dying || playerInvulnerability > 0) return;

    playerHealth--;
    playerInvulnerability = 0.85;

    createParticles(player.x, player.y, 18, "#ed2929");

    if (playerHealth <= 0) triggerDeath();
}


// ---------------- ENEMY MOVEMENT ----------------

function updateEnemies(dt) {
    for (const e of enemies) {
        if (!e.alive) continue;

        e.x += e.direction * e.speed * dt;

        if (e.x <= e.patrolMin) {
            e.x = e.patrolMin;
            e.direction = 1;
        } else if (e.x + e.size >= e.patrolMax) {
            e.x = e.patrolMax - e.size;
            e.direction = -1;
        }

        if (e.floating) {
            e.floatTime += dt;

            e.y = e.floatBaseY +
                Math.sin(e.floatTime * 2.2 + e.floatPhase) *
                e.floatAmplitude;
        } else {
            const oldBottom = e.y + e.size;

            e.vy += GRAVITY * dt;
            e.y += e.vy * dt;

            for (const p of level.platforms) {
                const overlapX =
                    e.x + e.size > p.x &&
                    e.x < p.x + p.w;

                if (
                    overlapX &&
                    oldBottom <= p.y + 4 &&
                    e.y + e.size >= p.y &&
                    e.vy >= 0
                ) {
                    e.y = p.y - e.size;
                    e.vy = 0;
                    break;
                }
            }
        }

        if (e.type === "blue") {
            // Blue enemies slowly pursue the player's horizontal position.
            const dx = player.x - (e.x + e.size / 2);
            e.x += Math.sign(dx) * Math.min(Math.abs(dx), 24 * dt);
            e.x = Math.max(24, Math.min(level.worldWidth - e.size - 24, e.x));

            e.cooldown -= dt;

            if (
                e.cooldown <= 0 &&
                Math.hypot(player.x - e.x, player.y - e.y) < 1050
            ) {
                fireBlueBurst(e);
                e.cooldown = e.fireRate;
            }
        }

        if (
            !dying &&
            overlaps(getPlayerBox(), {
                x: e.x,
                y: e.y,
                w: e.size,
                h: e.size
            })
        ) {
            damagePlayer();
            if (dying) return;
        }
    }
}

function drawEnemies() {
    for (const e of enemies) {
        if (!e.alive) continue;

        ctx.fillStyle = e.type === "green" ? "#24b84a" :
            e.type === "blue" ? "#2588ed" : "#ed2929";

        ctx.fillRect(e.x, e.y, e.size, e.size);

        ctx.fillStyle = "white";

        for (let i = 0; i < e.hp; i++) {
            ctx.fillRect(
                e.x + 5 + i * 8,
                e.y + 5,
                4,
                4
            );
        }

        ctx.lineWidth = 2;
        ctx.strokeStyle = "black";
        ctx.strokeRect(e.x, e.y, e.size, e.size);
    }
}


// ---------------- COMBAT ----------------

function updateCombat(dt) {
    for (const s of playerShots) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
    }

    for (const s of enemyShots) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
    }

    // Player bullets can shoot down blue enemy bullets.
    for (const red of playerShots) {
        if (red.dead) continue;

        for (const blue of enemyShots) {
            if (!blue.dead && circleCircle(red, blue)) {
                red.dead = true;
                blue.dead = true;

                createParticles(
                    (red.x + blue.x) / 2,
                    (red.y + blue.y) / 2,
                    18
                );

                break;
            }
        }
    }

    // Player shots damage enemies.
    for (const s of playerShots) {
        if (s.dead) continue;

        for (const e of enemies) {
            if (
                !e.alive ||
                !circleRect(
                    s.x,
                    s.y,
                    s.radius,
                    {
                        x: e.x,
                        y: e.y,
                        w: e.size,
                        h: e.size
                    }
                )
            ) {
                continue;
            }

            s.dead = true;
            e.hp--;

            if (e.hp <= 0) {
                e.alive = false;

                if (e.type === "red") {
                    platformCharges += 1;
                } else if (e.type === "green") {
                    platformCharges += 2;
                } else if (e.type === "blue") {
                    playerHealth += 2;
                }

                createParticles(
                    e.x + e.size / 2,
                    e.y + e.size / 2,
                    25,
                    e.type === "green" ? "#24b84a" :
                    e.type === "blue" ? "#2588ed" : "#ed2929"
                );
            } else {
                createParticles(
                    s.x,
                    s.y,
                    8,
                    e.type === "green" ? "#24b84a" : "#ed2929"
                );
            }

            break;
        }
    }

    // Gray platforms break one individual section per hit.
    for (const s of playerShots) {
        if (s.dead) continue;

        for (let i = currentGrayPlatforms.length - 1; i >= 0; i--) {
            const p = currentGrayPlatforms[i];

            if (circleRect(s.x, s.y, s.radius, p)) {
                s.dead = true;

                currentGrayPlatforms.splice(i, 1);

                createParticles(
                    p.x + p.w / 2,
                    p.y + p.h / 2,
                    15,
                    "#aeb4bd"
                );

                break;
            }
        }
    }

    // Player shots can destroy spikes.
    for (const s of playerShots) {
        if (s.dead) continue;

        for (let i = currentSpikes.length - 1; i >= 0; i--) {
            const p = currentSpikes[i];

            if (circleRect(s.x, s.y, s.radius, p)) {
                s.dead = true;

                createParticles(
                    p.x + p.w / 2,
                    p.y + p.h / 2,
                    16
                );

                currentSpikes.splice(i, 1);
                break;
            }
        }
    }

    // Normal solid platforms stop player shots.
    for (const s of playerShots) {
        if (s.dead) continue;

        for (const p of level.platforms) {
            if (circleRect(s.x, s.y, s.radius, p)) {
                s.dead = true;
                createParticles(s.x, s.y, 7);
                break;
            }
        }
    }

    // Blue bullets hurt the player.
    for (const s of enemyShots) {
        if (s.dead) continue;

        if (
            circleCircle(
                s,
                {
                    x: player.x,
                    y: player.y,
                    radius: player.radius
                }
            )
        ) {
            s.dead = true;
            damagePlayer();
            break;
        }
    }

    // Enemy shots are stopped by solid and gray platforms.
    for (const s of enemyShots) {
        if (s.dead) continue;

        for (const p of [
            ...level.platforms,
            ...currentGrayPlatforms
        ]) {
            if (circleRect(s.x, s.y, s.radius, p)) {
                s.dead = true;
                createParticles(s.x, s.y, 7, "#2588ed");
                break;
            }
        }
    }

    playerShots = playerShots.filter(s =>
        !s.dead &&
        s.x > cameraX - 100 &&
        s.x < cameraX + WIDTH + 100 &&
        s.y > cameraY - 100 &&
        s.y < cameraY + HEIGHT + 100
    );

    enemyShots = enemyShots.filter(s =>
        !s.dead &&
        s.x > -100 &&
        s.x < level.worldWidth + 100 &&
        s.y > -100 &&
        s.y < level.worldHeight + 100
    );
}


// ---------------- SPIKES ----------------

function checkSpikes() {
    const box = getPlayerBox();

    for (const p of currentSpikes) {
        if (overlaps(box, p)) {
            triggerDeath();
            return;
        }
    }
}

function drawSpikes() {
    ctx.fillStyle = "black";

    for (const p of currentSpikes) {
        const count = Math.max(1, Math.floor(p.w / 13));
        const tw = p.w / count;

        for (let i = 0; i < count; i++) {
            const x = p.x + i * tw;

            ctx.beginPath();
            ctx.moveTo(x, p.y + p.h);
            ctx.lineTo(x + tw / 2, p.y);
            ctx.lineTo(x + tw, p.y + p.h);
            ctx.closePath();
            ctx.fill();
        }
    }
}


// ---------------- PLAYER MOVEMENT ----------------

function updatePlayer(dt) {
    shootCooldown = Math.max(0, shootCooldown - dt);
    playerInvulnerability = Math.max(0, playerInvulnerability - dt);

    if (keys.left && !keys.right) facing = -1;
    if (keys.right && !keys.left) facing = 1;

    // Ride a moving platform.
    if (ridingPlatformId !== null && !jumpQueued) {
        const ride = movingPlatforms.find(
            p => p.id === ridingPlatformId
        );

        if (ride) {
            player.x += ride.vx * dt;
            player.y = ride.y - player.radius;
            player.vy = ride.vy;
            player.grounded = true;
        } else {
            ridingPlatformId = null;
        }
    }

    if (keys.left) {
        player.vx -= ACCELERATION * dt;
    }

    if (keys.right) {
        player.vx += ACCELERATION * dt;
    }

    if (!keys.left && !keys.right) {
        if (player.vx > 0) {
            player.vx = Math.max(
                0,
                player.vx - FRICTION * dt
            );
        }

        if (player.vx < 0) {
            player.vx = Math.min(
                0,
                player.vx + FRICTION * dt
            );
        }
    }

    player.vx = Math.max(
        -MOVE_SPEED,
        Math.min(MOVE_SPEED, player.vx)
    );

    // Jumping off a T platform dissolves the other active T platform.
    if (jumpQueued && player.grounded) {
        if (ridingPlatformId !== null) {
            const jumpedOffId = ridingPlatformId;

            for (const p of movingPlatforms) {
                if (p.id !== jumpedOffId) {
                    p.dead = true;

                    createParticles(
                        p.x + p.w / 2,
                        p.y + p.h / 2,
                        18,
                        "#d6a84b"
                    );
                }
            }

            movingPlatforms = movingPlatforms.filter(
                p => !p.dead
            );

            ridingPlatformId = null;
        }

        player.vy = -JUMP_FORCE;
        player.grounded = false;
    }

    jumpQueued = false;

    if (shootQueued && shootCooldown <= 0) {
        firePlayerShot();
    }

    shootQueued = false;

    if (platformQueued && platformCharges > 0) {
        fireMovingPlatform();
    }

    platformQueued = false;

    const previousBottom = player.y + player.radius;

    player.vy += GRAVITY * dt;

    player.x += player.vx * dt;
    handleCollisions("x");

    player.y += player.vy * dt;
    player.grounded = false;

    handleCollisions("y");

    landOnMovingPlatform(previousBottom);

    if (ridingPlatformId !== null) {
        const ride = movingPlatforms.find(
            p => p.id === ridingPlatformId
        );

        if (ride) {
            if (
                player.x + player.radius > ride.x &&
                player.x - player.radius < ride.x + ride.w
            ) {
                player.y = ride.y - player.radius;
                player.vy = ride.vy;
                player.grounded = true;
            } else {
                ridingPlatformId = null;
            }
        }
    }

    // World boundaries.
    if (player.x < player.radius) {
        player.x = player.radius;
        player.vx = 0;
    }

    if (player.x > level.worldWidth - player.radius) {
        player.x = level.worldWidth - player.radius;
        player.vx = 0;
    }

    if (player.y > level.worldHeight + 100) {
        triggerDeath();
        return;
    }

    checkSpikes();
}


// ---------------- CAMERA ----------------

function updateCamera() {
    const tx = player.x - WIDTH * 0.5;
    const ty = player.y - HEIGHT * 0.58;

    cameraX += (tx - cameraX) * 0.12;
    cameraY += (ty - cameraY) * 0.12;

    cameraX = Math.max(
        0,
        Math.min(cameraX, level.worldWidth - WIDTH)
    );

    cameraY = Math.max(
        0,
        Math.min(cameraY, level.worldHeight - HEIGHT)
    );
}


// ---------------- GOAL ----------------

function checkGoal() {
    if (
        !gameWon &&
        !dying &&
        overlaps(getPlayerBox(), level.goal)
    ) {
        loadLevel(currentLevelIndex + 1);
    }
}


// ---------------- DRAWING ----------------

function drawPlayer() {
    if (playerInvulnerability > 0 && Math.floor(playerInvulnerability * 14) % 2 === 0) return;

    ctx.beginPath();

    ctx.arc(
        player.x,
        player.y,
        player.radius,
        0,
        Math.PI * 2
    );

    ctx.fillStyle = "white";
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = "black";
    ctx.stroke();

    ctx.beginPath();

    if (isAimingUp()) {
        ctx.moveTo(player.x, player.y + 7);
        ctx.lineTo(player.x, player.y - 9);

        ctx.moveTo(player.x - 5, player.y - 4);
        ctx.lineTo(player.x, player.y - 9);
        ctx.lineTo(player.x + 5, player.y - 4);
    } else {
        const tip = player.x + facing * 9;

        ctx.moveTo(
            player.x - facing * 5,
            player.y
        );

        ctx.lineTo(tip, player.y);

        ctx.moveTo(
            tip - facing * 5,
            player.y - 5
        );

        ctx.lineTo(tip, player.y);

        ctx.lineTo(
            tip - facing * 5,
            player.y + 5
        );
    }

    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "black";
    ctx.stroke();
}

function drawPlatforms() {
    ctx.fillStyle = "black";

    for (const p of level.platforms) {
        if (p.hidden) continue;
        ctx.fillRect(p.x, p.y, p.w, p.h);
    }

    for (const p of currentGrayPlatforms) {
        ctx.fillStyle = "#aeb4bd";
        ctx.fillRect(p.x, p.y, p.w, p.h);

        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#555b63";
        ctx.strokeRect(p.x, p.y, p.w, p.h);
    }
}


function drawVisualShapes() {
    for (const s of (level.visualShapes || [])) {
        ctx.fillStyle = "black";
        ctx.strokeStyle = "black";
        ctx.lineWidth = 2;
        ctx.beginPath();

        if (s.type === "circle") {
            ctx.arc(s.x + s.w/2, s.y + s.h/2, Math.min(s.w,s.h)/2, 0, Math.PI*2);
            ctx.fill();
            ctx.stroke();
            continue;
        }

        if (s.type === "letter") {
            const t = s.thickness || 18;
            let bars = [];

            if (s.letter === "H") {
                bars = [
                    {x:s.x,y:s.y,w:t,h:s.h},
                    {x:s.x+s.w-t,y:s.y,w:t,h:s.h},
                    {x:s.x+t,y:s.y+s.h/2-t/2,w:s.w-2*t,h:t}
                ];
            } else if (s.letter === "L") {
                bars = [
                    {x:s.x,y:s.y,w:t,h:s.h},
                    {x:s.x,y:s.y+s.h-t,w:s.w,h:t}
                ];
            } else if (s.letter === "T") {
                bars = [
                    {x:s.x,y:s.y,w:s.w,h:t},
                    {x:s.x+s.w/2-t/2,y:s.y,w:t,h:s.h}
                ];
            } else if (s.letter === "E") {
                bars = [
                    {x:s.x,y:s.y,w:t,h:s.h},
                    {x:s.x,y:s.y,w:s.w,h:t},
                    {x:s.x,y:s.y+s.h/2-t/2,w:s.w*0.82,h:t},
                    {x:s.x,y:s.y+s.h-t,w:s.w,h:t}
                ];
            } else if (s.letter === "I") {
                bars = [
                    {x:s.x,y:s.y,w:s.w,h:t},
                    {x:s.x+s.w/2-t/2,y:s.y,w:t,h:s.h},
                    {x:s.x,y:s.y+s.h-t,w:s.w,h:t}
                ];
            } else if (s.letter === "S") {
                bars = [
                    {x:s.x,y:s.y,w:s.w,h:t},
                    {x:s.x,y:s.y+s.h/2-t/2,w:s.w*0.82,h:t},
                    {x:s.x,y:s.y+s.h-t,w:s.w,h:t},
                    {x:s.x+s.w-t,y:s.y+t,w:t,h:s.h/2-t},
                    {x:s.x,y:s.y+s.h/2,w:t,h:s.h/2-t}
                ];
            } else if (s.letter === "Z") {
                bars = [
                    {x:s.x,y:s.y,w:s.w,h:t},
                    {x:s.x+s.w-t,y:s.y+t,w:t,h:s.h-2*t},
                    {x:s.x,y:s.y+s.h-t,w:s.w,h:t},
                    {x:s.x+s.w*0.25,y:s.y+s.h*0.38,w:s.w*0.5,h:t}
                ];
            } else if (s.letter === "U") {
                bars = [
                    {x:s.x,y:s.y,w:t,h:s.h},
                    {x:s.x+s.w-t,y:s.y,w:t,h:s.h},
                    {x:s.x,y:s.y+s.h-t,w:s.w,h:t}
                ];
            }

            for (const b of bars) ctx.fillRect(b.x,b.y,b.w,b.h);
            continue;
        }

        let points;

        if (s.type === "triangle") {
            points = [
                {x:s.x+s.w/2,y:s.y},
                {x:s.x+s.w,y:s.y+s.h},
                {x:s.x,y:s.y+s.h}
            ];
        } else if (s.type === "diamond") {
            points = [
                {x:s.x+s.w/2,y:s.y},
                {x:s.x+s.w,y:s.y+s.h/2},
                {x:s.x+s.w/2,y:s.y+s.h},
                {x:s.x,y:s.y+s.h/2}
            ];
        } else if (s.type === "hexagon") {
            points = [
                {x:s.x+s.w*.25,y:s.y},
                {x:s.x+s.w*.75,y:s.y},
                {x:s.x+s.w,y:s.y+s.h*.5},
                {x:s.x+s.w*.75,y:s.y+s.h},
                {x:s.x+s.w*.25,y:s.y+s.h},
                {x:s.x,y:s.y+s.h*.5}
            ];
        }

        if (points) {
            ctx.moveTo(points[0].x,points[0].y);

            for (let i=1;i<points.length;i++) {
                ctx.lineTo(points[i].x,points[i].y);
            }

            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
    }
}

function drawGoal() {
    const g = level.goal;

    ctx.fillStyle = "black";
    ctx.fillRect(g.x, g.y, g.width, g.height);

    ctx.fillStyle = "white";
    ctx.fillRect(
        g.x + 8,
        g.y + 8,
        g.width - 16,
        g.height - 16
    );
}

function drawPlayerShots() {
    for (const s of playerShots) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);

        ctx.fillStyle = "#ed2929";
        ctx.fill();

        ctx.lineWidth = 2;
        ctx.strokeStyle = "black";
        ctx.stroke();
    }
}

function drawEnemyShots() {
    for (const s of enemyShots) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);

        ctx.fillStyle = "#2588ed";
        ctx.fill();

        ctx.lineWidth = 2;
        ctx.strokeStyle = "black";
        ctx.stroke();
    }
}

function drawHUD() {
    ctx.fillStyle = "black";
    ctx.font = "bold 16px Arial";
    ctx.fillText(`${level.name}   (${currentLevelIndex + 1}/${LEVELS.length})`, 20, 30);

    ctx.font = "11px Arial";
    ctx.fillText("ARROWS: MOVE     UP: JUMP / AIM UP     E: SHOOT     T: PLATFORM     R: RESTART", 20, 48);
    ctx.fillText("RED: +1 PLATFORM     BLUE: +2 HEALTH     GREEN: +2 PLATFORMS     BLUE BULLETS: SHOOT TO DESTROY", 20, 65);

    ctx.font = "bold 13px Arial";
    ctx.fillText(`HEALTH: ${playerHealth}     T-PLATFORMS: ${platformCharges}     ACTIVE: ${movingPlatforms.length}`, 20, 86);
}


// ---------------- GAME LOOP ----------------

let lastTime = 0;

function gameLoop(timestamp) {
    const dt = lastTime === 0
        ? 0
        : Math.min((timestamp - lastTime) / 1000, 0.033);

    lastTime = timestamp;

    if (!gameWon) {
        if (dying) {
            deathTimer -= dt;

            if (deathTimer <= 0) {
                restartLevel();
            }
        } else {
            updateMovingPlatforms(dt);
            updatePlayer(dt);

            if (!dying) {
                updateEnemies(dt);
                updateCombat(dt);

                if (!dying) {
                    updateCamera();
                    checkGoal();
                }
            }
        }
    }

    updateParticles(dt);

    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    ctx.save();
    ctx.translate(-cameraX, -cameraY);

    drawPlatforms();
    drawVisualShapes();
    drawMovingPlatforms();
    drawSpikes();
    drawGoal();
    drawEnemies();

    if (!dying) {
        drawPlayerShots();
        drawEnemyShots();
        drawPlayer();
    }

    drawParticles();

    ctx.restore();

    drawHUD();

    requestAnimationFrame(gameLoop);
}


// ---------------- START ----------------

loadLevel(0);
requestAnimationFrame(gameLoop);

// ==========================================
// MOUSE AIM + HOLD E TO AUTO-SHOOT PATCH
// Paste at the VERY BOTTOM of game.js
// ==========================================

let shootHeld = false;

let mouseScreenX = WIDTH / 2;
let mouseScreenY = HEIGHT / 2;

// Track mouse position on the canvas.
canvas.addEventListener("mousemove", e => {
    const rect = canvas.getBoundingClientRect();

    mouseScreenX =
        (e.clientX - rect.left) * (WIDTH / rect.width);

    mouseScreenY =
        (e.clientY - rect.top) * (HEIGHT / rect.height);
});

// Hold E to shoot.
window.addEventListener("keydown", e => {
    if (e.key.toLowerCase() === "e") {
        shootHeld = true;
    }
});

window.addEventListener("keyup", e => {
    if (e.key.toLowerCase() === "e") {
        shootHeld = false;
    }
});

// Stop shooting if the window loses focus.
window.addEventListener("blur", () => {
    shootHeld = false;
});

// Calculate direction from player to mouse.
function getAimDirection() {
    const targetX = mouseScreenX + cameraX;
    const targetY = mouseScreenY + cameraY;

    let dx = targetX - player.x;
    let dy = targetY - player.y;

    const distance = Math.hypot(dx, dy);

    if (distance < 1) {
        return { x: facing, y: 0 };
    }

    return {
        x: dx / distance,
        y: dy / distance
    };
}

// Make existing upward-aim checks follow the mouse.
isAimingUp = function() {
    return getAimDirection().y < -0.35;
};

// Replace the old shooting function.
firePlayerShot = function() {
    const direction = getAimDirection();

    const spawnDistance = player.radius + 8;

    playerShots.push({
        x: player.x + direction.x * spawnDistance,
        y: player.y + direction.y * spawnDistance,

        vx: direction.x * PLAYER_SHOT_SPEED,
        vy: direction.y * PLAYER_SHOT_SPEED,

        radius: 5,
        dead: false
    });

    shootCooldown = PLAYER_SHOT_COOLDOWN;
};

// Preserve all existing player movement.
// Add automatic shooting after the original movement update.
const originalUpdatePlayer = updatePlayer;

updatePlayer = function(dt) {
    originalUpdatePlayer(dt);

    if (shootHeld && !dying && shootCooldown <= 0) {
        firePlayerShot();
    }
};

// Replace the player drawing so the arrow points
// directly toward the mouse.
drawPlayer = function() {
    if (
        playerInvulnerability > 0 &&
        Math.floor(playerInvulnerability * 14) % 2 === 0
    ) {
        return;
    }

    // Player body.
    ctx.beginPath();
    ctx.arc(
        player.x,
        player.y,
        player.radius,
        0,
        Math.PI * 2
    );

    ctx.fillStyle = "white";
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = "black";
    ctx.stroke();

    // Aim direction.
    const direction = getAimDirection();

    const startX = player.x + direction.x * 5;
    const startY = player.y + direction.y * 5;

    const tipX = player.x + direction.x * 13;
    const tipY = player.y + direction.y * 13;

    const arrowSize = 5;

    const perpX = -direction.y;
    const perpY = direction.x;

    // Arrow shaft.
    ctx.beginPath();

    ctx.moveTo(startX, startY);
    ctx.lineTo(tipX, tipY);

    // Arrowhead.
    ctx.moveTo(
        tipX - direction.x * arrowSize +
        perpX * arrowSize,
        tipY - direction.y * arrowSize +
        perpY * arrowSize
    );

    ctx.lineTo(tipX, tipY);

    ctx.lineTo(
        tipX - direction.x * arrowSize -
        perpX * arrowSize,
        tipY - direction.y * arrowSize -
        perpY * arrowSize
    );

    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "black";
    ctx.stroke();
};

// Add an updated control instruction to the HUD.
const originalDrawHUD = drawHUD;

drawHUD = function() {
    originalDrawHUD();

    ctx.fillStyle = "black";
    ctx.font = "bold 12px Arial";
    ctx.fillText(
        "HOLD E: AUTO-SHOOT AT MOUSE",
        20,
        103
    );
};

console.log("Mouse aiming and automatic shooting enabled!");

// ================================================
// ROCKET JUMP + T-PLATFORM CRUSH COLLISION PATCH
// Paste at the VERY BOTTOM of game.js
// ================================================

// ROCKET JUMP SETTINGS
const ROCKET_LAUNCH_FORCE = 1050;
const ROCKET_HORIZONTAL_FORCE = 280;
const ROCKET_GROUND_RANGE = 300;

let rocketLaunchCooldown = 0;

// Find solid ground in the direction of the shot.
function findRocketGround(direction) {
    for (let distance = 12; distance <= ROCKET_GROUND_RANGE; distance += 6) {
        const x = player.x + direction.x * distance;
        const y = player.y + direction.y * distance;

        for (const p of [...level.platforms, ...currentGrayPlatforms]) {
            if (circleRect(x, y, 7, p)) {
                return { x, y, platform: p };
            }
        }
    }

    return null;
}

// Replace shooting with rocket-jump detection.
firePlayerShot = function() {
    const direction = getAimDirection();

    // Downward aim activates rocket jump ONLY when
    // there is actual solid ground underneath the shot.
    if (
        direction.y > 0.55 &&
        rocketLaunchCooldown <= 0
    ) {
        const ground = findRocketGround(direction);

        if (ground) {
            // Launch the player upward.
            player.vy = -ROCKET_LAUNCH_FORCE;

            // Give a little horizontal recoil.
            player.vx += -direction.x * ROCKET_HORIZONTAL_FORCE;

            player.grounded = false;
            ridingPlatformId = null;

            // Prevent immediate repeated rocket launches.
            rocketLaunchCooldown = 0.45;

            // Blast effect at the ground impact point.
            createParticles(
                ground.x,
                ground.y,
                35,
                "#ff8c21"
            );

            createParticles(
                ground.x,
                ground.y,
                20,
                "white"
            );

            // Create the downward projectile.
            playerShots.push({
                x: player.x + direction.x * 22,
                y: player.y + direction.y * 22,
                vx: direction.x * PLAYER_SHOT_SPEED,
                vy: direction.y * PLAYER_SHOT_SPEED,
                radius: 7,
                dead: false,
                rocketBlast: true
            });

            shootCooldown = PLAYER_SHOT_COOLDOWN;
            return;
        }
    }

    // Normal mouse-directed shooting.
    const spawnDistance = player.radius + 8;

    playerShots.push({
        x: player.x + direction.x * spawnDistance,
        y: player.y + direction.y * spawnDistance,
        vx: direction.x * PLAYER_SHOT_SPEED,
        vy: direction.y * PLAYER_SHOT_SPEED,
        radius: 5,
        dead: false
    });

    shootCooldown = PLAYER_SHOT_COOLDOWN;
};

// Update rocket cooldown.
const previousRocketUpdatePlayer = updatePlayer;

updatePlayer = function(dt) {
    rocketLaunchCooldown = Math.max(
        0,
        rocketLaunchCooldown - dt
    );

    previousRocketUpdatePlayer(dt);
};

// Make rocket shots visually different.
const previousDrawPlayerShots = drawPlayerShots;

drawPlayerShots = function() {
    previousDrawPlayerShots();

    for (const s of playerShots) {
        if (!s.rocketBlast || s.dead) continue;

        ctx.beginPath();
        ctx.arc(s.x, s.y, 9, 0, Math.PI * 2);

        ctx.fillStyle = "#ff8c21";
        ctx.fill();

        ctx.lineWidth = 2;
        ctx.strokeStyle = "black";
        ctx.stroke();
    }
};


// ================================================
// T-PLATFORM WALL COLLISION
// ================================================

// Preserve the existing platform update.
const previousMovingPlatformUpdate = updateMovingPlatforms;

updateMovingPlatforms = function(dt) {
    previousMovingPlatformUpdate(dt);

    for (const p of movingPlatforms) {
        if (p.dead) continue;

        // Check whether the T-platform hit a solid surface.
        let obstacle = null;

        for (const wall of level.platforms) {
            if (overlaps(p, wall)) {
                obstacle = wall;
                break;
            }
        }

        if (!obstacle) continue;

        // Determine the area where a player could be crushed.
        const left = Math.max(p.x, obstacle.x);
        const right = Math.min(
            p.x + p.w,
            obstacle.x + obstacle.w
        );

        const top = Math.min(p.y, obstacle.y);
        const bottom = Math.max(
            p.y + p.h,
            obstacle.y + obstacle.h
        );

        const crushZone = {
            x: left,
            y: top,
            w: right - left,
            h: bottom - top
        };

        // Give the player a little collision tolerance.
        const expandedCrushZone = {
            x: crushZone.x - player.radius,
            y: crushZone.y - player.radius,
            w: crushZone.w + player.radius * 2,
            h: crushZone.h + player.radius * 2
        };

        const playerCrushed =
            overlaps(getPlayerBox(), expandedCrushZone);

        // Explode the T-platform when it hits a wall.
        p.dead = true;

        createParticles(
            p.x + p.w / 2,
            p.y + p.h / 2,
            35,
            "#d6a84b"
        );

        // If the player was trapped, trigger death.
        if (playerCrushed) {
            triggerDeath();
        }

        if (ridingPlatformId === p.id) {
            ridingPlatformId = null;
            player.grounded = false;
        }
    }

    movingPlatforms = movingPlatforms.filter(p => !p.dead);
};

console.log("Rocket jump and T-platform collision patch enabled!");
