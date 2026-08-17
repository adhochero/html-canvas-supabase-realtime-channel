// world.js — Terrain data and the dual-grid lookup used to render it.
//
// TERRAIN is a logical grid of terrain ids (1 = grass, 0 = dirt) and never renders
// directly. The DISPLAY grid is offset by half a tile: each display cell samples the
// four TERRAIN cells meeting at its centre and picks one of 16 atlas tiles, so
// grass/dirt boundaries blend instead of stair-stepping.
//
// Terrain is purely visual — everything is walkable. Out of bounds reads as dirt, so
// the grass field sits in an endless dirt plane rather than ending at a hard cut.

export const TILE_PX = 16;   // source tile size in the atlas
export const TILE_SIZE = 48; // rendered size in world units (TILE_PX at the sprite scale)

export const WORLD_COLS = 32;
export const WORLD_ROWS = 24;

// Starts as all grass; tapping a cell carves it to dirt at runtime.
export const TERRAIN = Array.from({ length: WORLD_ROWS }, () => new Array(WORLD_COLS).fill(1));

export const SPAWN = {
    x: Math.floor(WORLD_COLS / 2) * TILE_SIZE + TILE_SIZE / 2,
    y: Math.floor(WORLD_ROWS / 2) * TILE_SIZE + TILE_SIZE / 2
};

// The 4 corner terrains of a display cell (TL,TR,BL,BR — grass=1) form a 4-bit mask
// (bit0=TL, bit1=TR, bit2=BL, bit3=BR). This maps each of the 16 masks to a [col,row]
// in DualGrid_TileSet_Grass.png (a 4x4 sheet).
export const DUAL_GRID_ATLAS = [
    /* 0000 */ [0, 3], // all dirt
    /* 0001 TL */ [3, 3],
    /* 0010 TR */ [0, 2],
    /* 0011 TL+TR (top) */ [1, 2],
    /* 0100 BL */ [0, 0],
    /* 0101 TL+BL (left) */ [3, 2],
    /* 0110 TR+BL */ [2, 3],
    /* 0111 TL+TR+BL (inner top-left) */ [3, 1],
    /* 1000 BR */ [1, 3],
    /* 1001 TL+BR */ [0, 1],
    /* 1010 TR+BR (right) */ [1, 0],
    /* 1011 TL+TR+BR (inner top-right) */ [2, 2],
    /* 1100 BL+BR (bottom) */ [3, 0],
    /* 1101 TL+BL+BR (inner bottom-left) */ [2, 0],
    /* 1110 TR+BL+BR (inner bottom-right) */ [1, 1],
    /* 1111 all grass */ [2, 1]
];

// Terrain id at a world cell; out of bounds reads as dirt so the world edge fades to
// dirt rather than a hard cut.
export function getTerrain(col, row) {
    if (row < 0 || row >= WORLD_ROWS || col < 0 || col >= WORLD_COLS) return 0;
    return TERRAIN[row][col];
}

// Set a terrain cell (in-bounds only). Returns true if it actually changed something.
export function setTerrain(col, row, value) {
    if (row < 0 || row >= WORLD_ROWS || col < 0 || col >= WORLD_COLS) return false;
    if (TERRAIN[row][col] === value) return false;
    TERRAIN[row][col] = value;
    return true;
}

// The atlas [col,row] for the display cell centred on the terrain corner at
// (col, row) — it samples world (col-1,row-1)=TL through (col,row)=BR.
export function dualGridAtlasAt(col, row) {
    const tl = getTerrain(col - 1, row - 1) === 1 ? 1 : 0;
    const tr = getTerrain(col,     row - 1) === 1 ? 1 : 0;
    const bl = getTerrain(col - 1, row)     === 1 ? 1 : 0;
    const br = getTerrain(col,     row)     === 1 ? 1 : 0;
    return DUAL_GRID_ATLAS[tl | (tr << 1) | (bl << 2) | (br << 3)];
}
