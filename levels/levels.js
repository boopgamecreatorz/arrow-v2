// Eight longer platformer levels with varied, SOLID geometric terrain.
// Shape collision is approximated with thin horizontal slices so the existing
// rectangle-based physics can stand on circles, triangles, diamonds and letters.

function shapePolygon(type, x, y, w, h) {
    if (type === "triangle") {
        return [{x:x+w/2,y},{x:x+w,y:y+h},{x,y:y+h}];
    }
    if (type === "diamond") {
        return [{x:x+w/2,y},{x:x+w,y:y+h/2},{x:x+w/2,y:y+h},{x,y:y+h/2}];
    }
    if (type === "hexagon") {
        return [
            {x:x+w*0.25,y},{x:x+w*0.75,y},
            {x:x+w,y:y+h*0.5},{x:x+w*0.75,y:y+h},
            {x:x+w*0.25,y:y+h},{x,y:y+h*0.5}
        ];
    }
    return null;
}

function polygonIntervalsAtY(points, scanY) {
    const xs = [];
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        if ((a.y <= scanY && b.y > scanY) || (b.y <= scanY && a.y > scanY)) {
            const t = (scanY - a.y) / (b.y - a.y);
            xs.push(a.x + t * (b.x - a.x));
        }
    }
    xs.sort((a,b) => a-b);
    const intervals = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
        if (xs[i+1] - xs[i] > 2) intervals.push([xs[i], xs[i+1]]);
    }
    return intervals;
}

function addShapeTerrain(shape, platforms) {
    const {type, x, y, w, h} = shape;
    const slice = 7;

    if (type === "letter") {
        const t = shape.thickness || 18;
        let bars = [];
        if (shape.letter === "H") {
            bars = [
                {x, y, w:t, h},
                {x:x+w-t, y, w:t, h},
                {x:x+t, y:y+h/2-t/2, w:w-2*t, h:t}
            ];
        } else if (shape.letter === "L") {
            bars = [
                {x, y, w:t, h},
                {x, y:y+h-t, w, h:t}
            ];
        } else if (shape.letter === "T") {
            bars = [
                {x, y, w, h:t},
                {x:x+w/2-t/2, y, w:t, h}
            ];
        } else if (shape.letter === "E") {
            bars = [
                {x, y, w:t, h},
                {x, y, w, h:t},
                {x, y:y+h/2-t/2, w:w*0.82, h:t},
                {x, y:y+h-t, w, h:t}
            ];
        } else if (shape.letter === "I") {
            bars = [
                {x, y, w, h:t},
                {x:x+w/2-t/2, y, w:t, h},
                {x, y:y+h-t, w, h:t}
            ];
        } else if (shape.letter === "S") {
            bars = [
                {x, y, w, h:t},
                {x, y:y+h/2-t/2, w:w*0.82, h:t},
                {x, y:y+h-t, w, h:t},
                {x:x+w-t, y:y+t, w:t, h:h/2-t},
                {x, y:y+h/2, w:t, h:h/2-t}
            ];
        } else if (shape.letter === "Z") {
            bars = [
                {x, y, w, h:t},
                {x:x+w-t, y:y+t, w:t, h:h-2*t},
                {x, y:y+h-t, w, h:t},
                {x:x+w*0.25, y:y+h*0.38, w:w*0.5, h:t}
            ];
        } else if (shape.letter === "U") {
            bars = [
                {x, y, w:t, h},
                {x:x+w-t, y, w:t, h},
                {x, y:y+h-t, w, h:t}
            ];
        }
        for (const b of bars) platforms.push({...b, hidden:true, shapeTerrain:true});
        return;
    }

    const points = shapePolygon(type, x, y, w, h);
    for (let yy = y; yy < y+h; yy += slice) {
        const bandH = Math.min(slice, y+h-yy);
        let intervals = [];

        if (type === "circle") {
            const cy = y+h/2;
            const rx = w/2;
            const ry = h/2;
            const normalized = (yy + bandH/2 - cy) / ry;
            const half = rx * Math.sqrt(Math.max(0, 1-normalized*normalized));
            intervals = [[x+w/2-half, x+w/2+half]];
        } else if (points) {
            intervals = polygonIntervalsAtY(points, yy + bandH/2);
        }

        for (const [left,right] of intervals) {
            platforms.push({
                x:left, y:yy, w:Math.max(2,right-left), h:bandH,
                hidden:true, shapeTerrain:true
            });
        }
    }
}

// Breakable grid clusters are defined as rectangles here, then split by
// game.js into small individually destructible tiles.
function addBreakableGrid(grayPlatforms, x, y, cols, rows, tileW = 22, tileH = 18, tileGap = 3) {
    grayPlatforms.push({
        x, y,
        w: cols * tileW + (cols - 1) * tileGap,
        h: rows * tileH + (rows - 1) * tileGap,
        tileW, tileH, tileGap
    });
}

function buildLevel(config) {
    const platforms = [];
    const spikes = [];
    const enemies = [];
    const grayPlatforms = [];
    const visualShapes = [];
    const {name, worldWidth, worldHeight, floorYs, startSide, goalSide, difficulty} = config;

    const floorPlatformsByFloor = [];
    const patterns = config.floorPatterns || ["wave", "zigzag", "S", "stairs", "block-step"];

    floorYs.forEach((baseY, floorIndex) => {
        const pattern = patterns[floorIndex % patterns.length];
        const count = config.pathCount || Math.max(7, Math.round((worldWidth - 100) / 205) + 1);
        const startX = 24;
        const endX = worldWidth - 154;
        const stepX = (endX - startX) / (count - 1);
        const pathPlatforms = [];

        const patternOffsets = {
            wave:       [0, -38, -72, -38, 0, 38, 72, 38, 0, -38, -72, -38, 0],
            zigzag:     [0, -66, 0, -66, 0, -66, 0, -66, 0, -66, 0, -66, 0],
            S:          [0, -42, -88, -52, 12, 66, 92, 48, -12, -66, -86, -40, 0],
            stairs:     [0, -22, -44, -66, -88, -66, -44, -22, 0, 22, 44, 22, 0],
            "block-step":[0, 0, -78, -78, 0, 0, -78, -78, 0, 0, -78, -78, 0],
            U:          [0, -48, -84, -40, 28, 72, 28, -40, -84, -48, 0, 42, 0],
            arch:       [0, -30, -62, -92, -62, -30, 0, 30, 62, 30, 0, -30, 0]
        };
        const offsets = patternOffsets[pattern] || patternOffsets.wave;

        for (let i = 0; i < count; i++) {
            const x = startX + i * stepX;
            const w = 112 + ((i + floorIndex * 2) % 3) * 9;
            const offset = offsets[i % offsets.length];
            const platform = {
                x,
                y: baseY + offset,
                w,
                h: 22 + ((i + floorIndex) % 2) * 4,
                floorPattern: pattern
            };
            platforms.push(platform);
            pathPlatforms.push(platform);
        }
        floorPlatformsByFloor.push(pathPlatforms);

        const blockCount = 2 + Math.min(2, Math.floor(floorIndex / 2));
        for (let j = 0; j < blockCount; j++) {
            const anchor = pathPlatforms[Math.min(count - 2, 1 + j * Math.max(1, Math.floor((count - 3) / blockCount)))];
            const blockW = 72 + ((j + floorIndex) % 3) * 18;
            const blockH = 20 + ((j * 2 + floorIndex) % 3) * 12;
            platforms.push({
                x: Math.min(worldWidth - blockW - 20, anchor.x + anchor.w + 24),
                y: anchor.y - 88 - blockH,
                w: blockW,
                h: blockH
            });
        }

        // Dense individual gray tiles in grids above and between routes.
        const gridAnchors = [
            Math.max(0, Math.floor(count * 0.22)),
            Math.max(1, Math.floor(count * 0.52)),
            Math.min(count - 2, Math.floor(count * 0.76))
        ];
        gridAnchors.forEach((idx, gridIndex) => {
            const anchor = pathPlatforms[idx];
            const cols = 5 + ((floorIndex + gridIndex) % 4);
            const rows = 3 + ((floorIndex + gridIndex) % 2);
            const gx = Math.min(worldWidth - (cols * 25) - 24, anchor.x + 8);
            const gy = anchor.y - 112 - ((gridIndex % 2) * 42);
            addBreakableGrid(grayPlatforms, gx, gy, cols, rows, 18, 16, 3);
        });

        for (let mini = 0; mini < 2; mini++) {
            const anchor = pathPlatforms[Math.min(count - 2, 2 + mini * Math.max(1, Math.floor(count / 3)))];
            const gx = Math.min(worldWidth - 190, anchor.x + 26);
            const gy = anchor.y - 205 - mini * 26;
            addBreakableGrid(grayPlatforms, gx, gy, 6, 3, 17, 15, 3);
        }

        const spikeCount = Math.min(difficulty.spikes + Math.floor(floorIndex / 2), 5);
        for (let s = 0; s < spikeCount; s++) {
            const boardIndex = Math.min(count - 2, 2 + s * Math.max(1, Math.floor((count - 4) / Math.max(1, spikeCount))));
            const board = pathPlatforms[boardIndex];
            spikes.push({
                x: board.x + board.w * 0.45,
                y: board.y - 24,
                w: 34 + (s % 2) * 8,
                h: 24
            });
        }

        const enemyCount = difficulty.enemies + Math.floor(floorIndex / 3);
        for (let e = 0; e < enemyCount; e++) {
            const boardIndex = Math.min(count - 2, 2 + e * Math.max(1, Math.floor((count - 4) / Math.max(1, enemyCount))));
            const board = pathPlatforms[boardIndex];
            const x = board.x + board.w / 2 - 12;
            const enemyRoll = (e + floorIndex + difficulty.specialOffset) % 4;
            const enemyType = enemyRoll === 0 ? "green" : enemyRoll === 1 ? "blue" : "red";
            enemies.push({
                type: enemyType,
                x,
                y: board.y - 25,
                size: 24,
                patrolMin: Math.max(35, x - 70),
                patrolMax: Math.min(worldWidth - 35, x + 94),
                speed: (enemyType === "blue" ? 0 : 76) + difficulty.enemySpeed + floorIndex * 4,
                fireRate: enemyType === "blue" ? 3.8 + floorIndex * 0.15 : Math.max(0.75, 1.25 - difficulty.fireBoost - floorIndex * 0.035),
                shotSpeed: 165,
                burstCount: enemyType === "blue" ? 5 : 0
            });
        }
    });

    for (let floor = 0; floor < floorYs.length-1; floor++) {
        const lowerY = floorYs[floor];
        const upperY = floorYs[floor+1];
        const climbRight = floor%2===0;
        const steps = Math.ceil((lowerY-upperY)/92);
        const ledgeWidth = 145;

        for (let step = 1; step <= steps; step++) {
            const y = lowerY-step*((lowerY-upperY)/(steps+1));
            const x = climbRight
                ? (step%2===1 ? worldWidth-190 : worldWidth-365)
                : (step%2===1 ? 45 : 220);
            platforms.push({x,y,w:ledgeWidth,h:18});
        }
    }

    // Breakable stepping lattices between floors.
    for (let floor = 0; floor < floorYs.length - 1; floor++) {
        const lowerY = floorYs[floor];
        const upperY = floorYs[floor + 1];
        const climbRight = floor % 2 === 0;
        const midY = (lowerY + upperY) / 2;
        const baseX = climbRight ? worldWidth - 560 : 285;

        addBreakableGrid(grayPlatforms, Math.max(24, Math.min(worldWidth - 210, baseX)), midY + 48, 5 + (floor % 2), 2);
        addBreakableGrid(grayPlatforms, Math.max(24, Math.min(worldWidth - 210, baseX + 112)), midY - 24, 4 + (floor % 3), 2);
        addBreakableGrid(grayPlatforms, Math.max(24, Math.min(worldWidth - 210, baseX + 28)), midY - 112, 5, 2);
    }

    for (const spec of (config.shapes || [])) {
        const floorY = floorYs[spec.floor || 0];
        const shape = {
            ...spec,
            x:spec.x,
            y:floorY-Math.min(spec.rise || 90, 100)
        };
        visualShapes.push(shape);
        addShapeTerrain(shape, platforms);
    }

    const finalY = floorYs[floorYs.length-1];
    const goalX = goalSide==="right" ? worldWidth-72 : 24;

    return {
        name, worldWidth, worldHeight,
        start:{x:startSide==="left"?65:worldWidth-65,y:floorYs[0]-18},
        goal:{x:goalX,y:finalY-92,width:38,height:92},
        platforms, spikes, enemies, grayPlatforms, visualShapes
    };
}

const LEVELS = [
    buildLevel({
        name:"LEVEL 1 — THE FIRST ASCENT",
        worldWidth:1550, worldHeight:1550, floorYs:[1320,860,400],
        startSide:"left", goalSide:"right",
        floorPatterns:["S", "wave", "zigzag"],
        difficulty:{gap:24,spikes:0,enemies:1,enemySpeed:0,fireBoost:0,specialOffset:1},
        shapes:[
            {type:"circle",x:330,floor:0,rise:115,w:104,h:104},
            {type:"triangle",x:760,floor:1,rise:100,w:116,h:100}
        ]
    }),
    buildLevel({
        name:"LEVEL 2 — SHAPES IN THE WAY",
        worldWidth:1700, worldHeight:1750, floorYs:[1500,1020,540],
        startSide:"left", goalSide:"right",
        floorPatterns:["U", "block-step", "arch"],
        difficulty:{gap:26,spikes:1,enemies:1,enemySpeed:8,fireBoost:0.08,specialOffset:0},
        shapes:[
            {type:"diamond",x:360,floor:0,rise:130,w:120,h:110},
            {type:"letter",letter:"L",x:850,floor:1,rise:105,w:110,h:115,thickness:20},
            {type:"circle",x:1250,floor:2,rise:105,w:100,h:100},
            {type:"letter",letter:"S",x:1390,floor:2,rise:185,w:125,h:135,thickness:21}
        ]
    }),
    buildLevel({
        name:"LEVEL 3 — THE LETTER RUN",
        worldWidth:1850, worldHeight:2050, floorYs:[1800,1340,880,420],
        startSide:"left", goalSide:"right",
        floorPatterns:["zigzag", "S", "stairs", "wave"],
        difficulty:{gap:27,spikes:1,enemies:2,enemySpeed:14,fireBoost:0.14,specialOffset:2},
        shapes:[
            {type:"letter",letter:"H",x:330,floor:0,rise:115,w:130,h:125,thickness:22},
            {type:"triangle",x:900,floor:1,rise:120,w:130,h:115},
            {type:"letter",letter:"T",x:1370,floor:2,rise:110,w:125,h:120,thickness:22}
        ]
    }),
    buildLevel({
        name:"LEVEL 4 — THE BROKEN BRIDGES",
        worldWidth:2000, worldHeight:2200, floorYs:[1940,1450,960,470],
        startSide:"left", goalSide:"right",
        floorPatterns:["arch", "U", "block-step", "S"],
        difficulty:{gap:29,spikes:2,enemies:2,enemySpeed:20,fireBoost:0.2,specialOffset:1},
        shapes:[
            {type:"hexagon",x:380,floor:0,rise:140,w:140,h:120},
            {type:"circle",x:930,floor:1,rise:120,w:125,h:125},
            {type:"diamond",x:1480,floor:2,rise:125,w:135,h:120},
            {type:"letter",letter:"E",x:760,floor:3,rise:105,w:120,h:120,thickness:20}
        ]
    }),
    buildLevel({
        name:"LEVEL 5 — THE BLACKOUT TOWER",
        worldWidth:2150, worldHeight:2350, floorYs:[2100,1600,1100,600],
        startSide:"left", goalSide:"right",
        floorPatterns:["wave", "stairs", "S", "zigzag"],
        difficulty:{gap:30,spikes:2,enemies:2,enemySpeed:25,fireBoost:0.24,specialOffset:0},
        shapes:[
            {type:"letter",letter:"I",x:330,floor:0,rise:130,w:120,h:130,thickness:22},
            {type:"triangle",x:920,floor:1,rise:135,w:145,h:125},
            {type:"letter",letter:"H",x:1500,floor:2,rise:120,w:135,h:125,thickness:22},
            {type:"circle",x:1850,floor:3,rise:110,w:115,h:115}
        ]
    }),
    buildLevel({
        name:"LEVEL 6 — THE LONG CLIMB",
        worldWidth:2300, worldHeight:2650, floorYs:[2400,1900,1400,900,400],
        startSide:"left", goalSide:"right",
        floorPatterns:["S", "arch", "U", "block-step", "wave"],
        difficulty:{gap:30,spikes:2,enemies:2,enemySpeed:30,fireBoost:0.28,specialOffset:2},
        shapes:[
            {type:"circle",x:360,floor:0,rise:125,w:120,h:120},
            {type:"diamond",x:1000,floor:1,rise:140,w:135,h:125},
            {type:"letter",letter:"T",x:1650,floor:2,rise:125,w:140,h:130,thickness:22},
            {type:"hexagon",x:650,floor:3,rise:120,w:135,h:120},
            {type:"letter",letter:"U",x:1770,floor:4,rise:130,w:135,h:130,thickness:22}
        ]
    }),
    buildLevel({
        name:"LEVEL 7 — THE GEOMETRY MAZE",
        worldWidth:2450, worldHeight:2800, floorYs:[2550,2050,1550,1050,550],
        startSide:"left", goalSide:"right",
        floorPatterns:["block-step", "S", "arch", "zigzag", "U"],
        difficulty:{gap:31,spikes:3,enemies:2,enemySpeed:34,fireBoost:0.31,specialOffset:1},
        shapes:[
            {type:"letter",letter:"E",x:350,floor:0,rise:125,w:135,h:130,thickness:22},
            {type:"triangle",x:930,floor:1,rise:145,w:150,h:135},
            {type:"circle",x:1580,floor:2,rise:135,w:130,h:130},
            {type:"letter",letter:"L",x:2050,floor:3,rise:125,w:130,h:135,thickness:22},
            {type:"letter",letter:"Z",x:1700,floor:4,rise:135,w:140,h:130,thickness:22}
        ]
    }),
    buildLevel({
        name:"LEVEL 8 — THE FINAL ASCENT",
        worldWidth:2650, worldHeight:3000, floorYs:[2750,2200,1650,1100,550],
        startSide:"left", goalSide:"right",
        floorPatterns:["U", "wave", "S", "stairs", "arch"],
        difficulty:{gap:32,spikes:3,enemies:3,enemySpeed:38,fireBoost:0.34,specialOffset:0},
        shapes:[
            {type:"hexagon",x:360,floor:0,rise:145,w:150,h:135},
            {type:"letter",letter:"H",x:980,floor:1,rise:135,w:145,h:140,thickness:23},
            {type:"diamond",x:1650,floor:2,rise:150,w:150,h:140},
            {type:"letter",letter:"T",x:2150,floor:3,rise:135,w:145,h:140,thickness:23},
            {type:"circle",x:1350,floor:4,rise:120,w:130,h:130},
            {type:"letter",letter:"S",x:2240,floor:4,rise:175,w:145,h:145,thickness:23}
        ]
    })
];