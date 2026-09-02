import { Input } from './input.js';
import { AnimatedSprite } from './animatedSprite.js';
import { TILE_PX, TILE_SIZE, SPAWN, dualGridAtlasAt, setTerrain } from './world.js';

const stage = document.getElementById('stage');
const canvas = document.getElementById('gameCanvas');
const screenCtx = canvas.getContext('2d');
const canvasViewportPercentage = 1; // fill the smaller screen dimension

// art px -> world units, and the base on-screen block size. Declared here because the
// render buffer's dimensions are derived from it.
const spriteScale = 3;

// Pixel-perfect rendering. The world is drawn once into a low-resolution buffer at one
// pixel per art pixel, then scaled up to the screen in a single whole-number nearest-
// neighbour blit — so every art pixel is a uniform block and never lands on a fraction.
// A 1px overscan border gives the sub-pixel camera room to shift the whole image each
// frame without exposing an empty edge, which keeps slow motion smooth instead of
// snapping a whole pixel at a time.
const ART_VIEW = 222;                                 // art pixels across the square view
const BUFFER_BORDER = 1;                              // overscan, in art pixels
const BUFFER_SIZE = ART_VIEW + BUFFER_BORDER * 2;     // 224
const HALF_VIEW_WORLD = (ART_VIEW * spriteScale) / 2; // world-space half view = 333

const sceneCanvas = document.createElement('canvas');
sceneCanvas.width = BUFFER_SIZE;
sceneCanvas.height = BUFFER_SIZE;
// `context` is the BUFFER context, so every existing world-draw call targets the buffer
// unchanged; the screen only ever receives the final scaled blit.
const context = sceneCanvas.getContext('2d');

let screenScale = spriteScale; // device px per art px; recomputed in adjustCanvasSize

// Difficulty menu, drawn into the buffer at art-pixel scale so it sits on the same pixel
// grid as the game and upscales identically — the text is sized in art pixels, not CSS.
// Centre of the visible region in buffer coordinates (border + half the view).
const MENU_CENTER = BUFFER_BORDER + ART_VIEW / 2;
// The 3x3 font renders cleanest at multiples of 3 art pixels (its pixel grid); off-grid
// sizes blur, which is magnified by the buffer upscale. Keep every text size on that grid.
const MENU_TITLE_PX = 15;   // art pixels tall
const MENU_LABEL_PX = 12;
const MENU_BTN_W = 102;
const MENU_BTN_H = 20;
const MENU_BTN_GAP = 6;
const MENU_TITLE_Y = 24;         // buffer y of the title
const MENU_PREVIEW_Y = 66;       // centre of the live sprite preview
const MENU_PREVIEW_SCALE = 3;    // whole-number scale (matches the game) so each source
                                 // pixel is a uniform block; 2.5 made some pixels uneven
const MENU_BTN_Y0 = 110;         // centre of the first difficulty button
const MENU_CONFIRM_W = 102;
const MENU_CONFIRM_H = 24;
const MENU_CONFIRM_Y = 198;      // centre of the confirm button
const MENU_PINK = 'rgb(255, 53, 94)';

const MENU_BUTTONS = [
    { label: 'EASY',   color: '#ffb595' },
    { label: 'MEDIUM', color: '#ba826a' },
    { label: 'HARD',   color: '#7a5440' }
];

let selectedDifficulty = 0; // easy preselected; the confirm button commits it
let previewSprite;          // idle sprite shown in the menu, tinted by the selection

function menuButtonCenterY(index) {
    return MENU_BTN_Y0 + index * (MENU_BTN_H + MENU_BTN_GAP);
}

// On-canvas weapon-swap button, drawn in the buffer's bottom-right corner during play.
// Coordinates are the visible region's bottom-right (border + view) minus a margin.
const WPN_BTN_W = 34;
const WPN_BTN_H = 16;
const WPN_BTN_MARGIN = 7;
const WPN_LABEL_PX = 9;
const WPN_BTN_X = BUFFER_BORDER + ART_VIEW - WPN_BTN_MARGIN - WPN_BTN_W; // left edge
const WPN_BTN_Y = BUFFER_BORDER + ART_VIEW - WPN_BTN_MARGIN - WPN_BTN_H; // top edge

let lastTimeStamp = 0;

let localUserPosition = { x: SPAWN.x, y: SPAWN.y };
let localAnimatedSprite;
let localPlayerState = {
    lastDirectionX: 1
};

function loadImage(src) {
    const image = new Image();
    image.src = src;
    return image;
}

// Sprite sheets are 64x80 => 4 columns x 5 rows of 16x16 frames, 4 frames per row.
// Rows top-to-bottom: North, North-East, East, South-East, South.
// West directions reuse the East-side rows, flipped horizontally.
const playerIdleImage = loadImage('./assets/Base_Idle_8D.png');
const playerRunImage = loadImage('./assets/Base_Walk_8D.png');

// Jump sheet is 16x80 => 1 column x 5 rows of 16x16 frames — a single held frame per
// direction, with the same row order as idle and walk.
const playerJumpImage = loadImage('./assets/Base_Jump.png');

// Death sheets are 64x32 => 4 columns x 2 rows of 16x16 frames, 8 frames played end to end.
const deathImages = [
    loadImage('./assets/Base_Death_Kneel.png'),
    loadImage('./assets/Base_Death_Roll.png')
];

// Solid black 16x16 ellipse, drawn translucent rather than tinted — it's the ground
// marker, not part of the character, so the colour picker must not reach it.
const shadowImage = loadImage('./assets/shadow.png');

// 4x4 sheet of dual-grid terrain tiles, also outside the tint targets
const terrainTiles = loadImage('./assets/DualGrid_TileSet_Grass.png');

// Weapon overlay sheet: 2 columns x 3 rows of 16x16 = 6 weapons. Drawn on top of the
// player, and NOT tinted — weapons are held items, not part of the body.
const weaponsImage = loadImage('./assets/Weapons.png');
const WEAPON_COLS = 2;
const WEAPON_COUNT = 6;
// The weapon points the way the player is facing. The art points east, so it's rotated
// to the facing direction; the pivot is the grip (near the hands) and reach pushes the
// weapon out along the facing. All in world units — tweak to line the art up.
const WEAPON_PIVOT_X = 0;   // grip offset from the body centre
const WEAPON_PIVOT_Y = 8;   // grip vertical offset (roughly the hands)
const WEAPON_REACH = 6;     // how far the weapon centre sits out along the facing
let currentWeapon = -1;     // -1 = none; the button cycles none -> 0..5 -> none

// Persisted facing direction (unit vector). Updates while moving and holds when idle, so
// the weapon keeps pointing where the player last faced. Starts south, matching the
// initial sprite row.
let facingX = 0;
let facingY = 1;

// The character fills its frame right down to the bottom edge, so shifting it up by
// half a frame puts its feet on the ground position — where the shadow is centred.
const spriteFootOffset = 16 * spriteScale * 0.5;

// Every sheet the player is drawn from gets a tinted offscreen copy. The sprites are
// drawn from these canvases, so re-tinting in place recolors the player instantly and
// keeps the sheet-swap identity checks in drawAnimatedSpritePlayer working.
const playerIdleSheet = document.createElement('canvas');
const playerRunSheet = document.createElement('canvas');
const playerJumpSheet = document.createElement('canvas');
const deathSheets = deathImages.map(() => document.createElement('canvas'));

const tintTargets = [
    { source: playerIdleImage, target: playerIdleSheet },
    { source: playerRunImage, target: playerRunSheet },
    { source: playerJumpImage, target: playerJumpSheet },
    ...deathImages.map((source, i) => ({ source, target: deathSheets[i] }))
];

const playerHitRadius = 24; // frame is 16px drawn at spriteScale => 48px, so half of that
const respawnDelay = 3; // seconds to hold the last death frame before respawning

// On respawn the player pulses between semi-transparent and opaque before settling
const respawnFlashDuration = 1.2; // seconds
const respawnFlashPulses = 3;
const respawnFlashMinAlpha = 0.25;

// Jump (visual-only vertical offset; the ground position is unchanged, so the
// sprite is drawn at y + jumpOffsetY while everything else still uses y)
const GRAVITY = 1800;           // px/s^2
const JUMP_FIXED_VEL = -400;    // px/s upward — high arc, same on every jump
const JUMP_FIXED_IMPULSE = 90;  // px/s forward launch in the flick direction
const JUMP_COOLDOWN = 0.8;      // seconds between jumps
const SHADOW_OPACITY = 0.35;    // shadow.png is solid black, so this is what softens it

// Peak visual height of a jump (v^2 / 2g) — used to scale the shadow by how far off
// the ground the character is.
const JUMP_APEX_HEIGHT = (JUMP_FIXED_VEL * JUMP_FIXED_VEL) / (2 * GRAVITY);
const SHADOW_MIN_JUMP_SCALE = 0.5;  // shadow's stretch span at the apex, vs grounded
const SHADOW_DEATH_SCALE_X = 1.8;   // widen to sit under the lying-down body
const SHADOW_DEATH_DELAY_FRAMES = 2; // death frames spent still standing before the widen

let isAlive = true;
let deathAnimatedSprite = null;
let respawnTimer = 0;
let respawnFlashTimer = 0;

let jumpAnimatedSprite;
let isGrounded = true;
let jumpVelocityY = 0;
let jumpOffsetY = 0;
let jumpCooldownTimer = 0;
let jumpImpulse = { x: 0, y: 0 };

let input = new Input(canvas);
input.addEventListeners();

let inputSmoothing = { x: 0, y: 0 };
let moveDirection = { x: 0, y: 0 };
let inputResponsiveness = 6;
let localUserSpeed = 150;

let camera = { x: 0, y: 0 };
let cameraFollowSpeed = 3;

// Tapping the character kills it; tapping the ground carves that tile to dirt.
input.onQuickPress = (x, y) => {
    // Menu: hit-test the buttons in buffer (art) space. The camera is 0 in the menu, so a
    // backing pixel maps to art with just the scale and border.
    if (gameState === 'menu') {
        const artX = x / screenScale + BUFFER_BORDER;
        const artY = y / screenScale + BUFFER_BORDER;

        // Confirm button commits the current selection and enters the game.
        if (Math.abs(artX - MENU_CENTER) <= MENU_CONFIRM_W / 2 &&
            Math.abs(artY - MENU_CONFIRM_Y) <= MENU_CONFIRM_H / 2) {
            startGame(MENU_BUTTONS[selectedDifficulty].color);
            return;
        }

        // Difficulty buttons only change the selection and re-tint the preview.
        for (let i = 0; i < MENU_BUTTONS.length; i++) {
            if (Math.abs(artX - MENU_CENTER) <= MENU_BTN_W / 2 &&
                Math.abs(artY - menuButtonCenterY(i)) <= MENU_BTN_H / 2) {
                selectedDifficulty = i;
                applyPlayerColor(MENU_BUTTONS[i].color);
                return;
            }
        }
        return;
    }

    // The weapon button is fixed UI in buffer space; a backing pixel maps to art with the
    // scale and border (the sub-pixel camera offset is under a pixel, negligible here).
    const uiX = x / screenScale + BUFFER_BORDER;
    const uiY = y / screenScale + BUFFER_BORDER;
    if (uiX >= WPN_BTN_X && uiX <= WPN_BTN_X + WPN_BTN_W &&
        uiY >= WPN_BTN_Y && uiY <= WPN_BTN_Y + WPN_BTN_H) {
        cycleWeapon();
        return;
    }

    // x,y are canvas backing pixels; scale to world units, then into world space.
    const worldX = x * spriteScale / screenScale - camera.x;
    const worldY = y * spriteScale / screenScale - camera.y;

    if (isAlive) {
        // Test against where the sprite is actually drawn — its body sits above the
        // ground position, and rides the arc while airborne
        const spriteCenterY = localUserPosition.y - spriteFootOffset + jumpOffsetY;
        if (getSquaredDistance(localUserPosition.x, spriteCenterY, worldX, worldY) <= playerHitRadius * playerHitRadius) {
            killPlayer();
            return;
        }
    }

    // Otherwise turn the tapped terrain cell to dirt.
    setTerrain(Math.floor(worldX / TILE_SIZE), Math.floor(worldY / TILE_SIZE), 0);
};

// Flicking the joystick jumps in the flicked direction
input.onFlick = (directionX, directionY) => {
    triggerJump(directionX, directionY);
};

// Touch pinch is already off via touch-action on the body, and the viewport meta
// covers the zoom iOS does when you focus a text field. Trackpad pinch is the one
// gap: it arrives as ctrl/cmd + wheel, which touch-action doesn't govern.
window.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey) event.preventDefault();
}, { passive: false });

// Refit and re-centre on any viewport change. A ResizeObserver catches everything the
// resize event can miss — rotations that fire before the dimensions settle, mobile
// URL-bar show/hide, zoom — and fires once when observation starts for the initial sizing.
if (window.ResizeObserver) {
    new ResizeObserver(adjustCanvasSize).observe(document.documentElement);
} else {
    window.addEventListener('resize', adjustCanvasSize);
    window.addEventListener('orientationchange', adjustCanvasSize);
}

let gameState = 'menu'; // 'menu' until a difficulty is picked, then 'playing'

window.addEventListener('load', async () => {
    adjustCanvasSize();

    // The sheets have to be decoded before they can be tinted into the offscreen canvases
    await Promise.all([
        ...tintTargets.map(({ source }) => source.decode()),
        terrainTiles.decode(),
        weaponsImage.decode()
    ].map(promise => promise.catch(() => {})));

    // The pixel font has to be ready before the menu draws its text.
    if (document.fonts && document.fonts.load) {
        await document.fonts.load(`${MENU_TITLE_PX}px "3x3"`).catch(() => {});
    }

    localAnimatedSprite = new AnimatedSprite(playerIdleSheet, 4, 5, 5, 4, spriteScale, 333, 333, .2, false, true, true);

    // Left stopped: the single frame is held for the whole jump, only the row changes
    jumpAnimatedSprite = new AnimatedSprite(playerJumpSheet, 1, 5, 5, 1, spriteScale, 333, 333, 1, false, false, false);

    // Menu preview: the idle sprite facing the camera (row 5 = South), drawn from the same
    // tinted sheet, so re-tinting on a difficulty pick recolours it live.
    previewSprite = new AnimatedSprite(playerIdleSheet, 4, 5, 5, 4, MENU_PREVIEW_SCALE, MENU_CENTER, MENU_PREVIEW_Y, 0.2, false, true, true);

    // Easy is preselected, so tint everything with it up front.
    applyPlayerColor(MENU_BUTTONS[selectedDifficulty].color);

    // The loop starts in the menu state and renders the difficulty screen until a pick.
    window.requestAnimationFrame(update);
});

// Leaves the menu for the picked difficulty: sets the player colour, reveals the weapon
// button, and snaps the camera onto the player so the first frame is already centred.
function startGame(color) {
    applyPlayerColor(color);
    gameState = 'playing';
    camera.x = -localUserPosition.x + HALF_VIEW_WORLD;
    camera.y = -localUserPosition.y + HALF_VIEW_WORLD;
}

// Draws the difficulty menu into the buffer at art-pixel scale, so it scales with the
// canvas exactly like the game does. Text positions are rounded to whole art pixels to
// keep the pixel font aligned to the grid.
function drawMenu() {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, BUFFER_SIZE, BUFFER_SIZE);

    context.fillStyle = '#0a0a0a';
    context.fillRect(0, 0, BUFFER_SIZE, BUFFER_SIZE);

    context.textAlign = 'center';
    context.textBaseline = 'middle';

    context.fillStyle = MENU_PINK;
    context.font = `${MENU_TITLE_PX}px "3x3", monospace`;
    context.fillText('DIFFICULTY', Math.round(MENU_CENTER), Math.round(MENU_TITLE_Y));

    // Live sprite preview, tinted with the current selection.
    if (previewSprite) {
        previewSprite.x = MENU_CENTER;
        previewSprite.y = MENU_PREVIEW_Y;
        previewSprite.drawSprite(context);
    }

    // Difficulty buttons. The selected one gets a thicker pink border and bright label;
    // the rest are dimmed, so the current pick reads at a glance.
    MENU_BUTTONS.forEach((button, index) => {
        const cy = menuButtonCenterY(index);
        const x = Math.round(MENU_CENTER - MENU_BTN_W / 2);
        const y = Math.round(cy - MENU_BTN_H / 2);
        const selected = index === selectedDifficulty;

        const border = selected ? 3 : 2;
        context.fillStyle = selected ? MENU_PINK : '#000';
        context.fillRect(x - border, y - border, MENU_BTN_W + 2 * border, MENU_BTN_H + 2 * border);
        context.fillStyle = selected ? '#241016' : '#161616';
        context.fillRect(x, y, MENU_BTN_W, MENU_BTN_H);

        context.fillStyle = selected ? MENU_PINK : 'rgb(120, 120, 120)';
        context.font = `${MENU_LABEL_PX}px "3x3", monospace`;
        context.fillText(button.label, Math.round(MENU_CENTER), Math.round(cy));
    });

    // Confirm button: pink-filled with dark text, so it reads as the action that commits.
    const confirmX = Math.round(MENU_CENTER - MENU_CONFIRM_W / 2);
    const confirmY = Math.round(MENU_CONFIRM_Y - MENU_CONFIRM_H / 2);
    context.fillStyle = '#000';
    context.fillRect(confirmX - 2, confirmY - 2, MENU_CONFIRM_W + 4, MENU_CONFIRM_H + 4);
    context.fillStyle = MENU_PINK;
    context.fillRect(confirmX, confirmY, MENU_CONFIRM_W, MENU_CONFIRM_H);
    context.fillStyle = '#0a0a0a';
    context.font = `${MENU_LABEL_PX}px "3x3", monospace`;
    context.fillText('NEXT', Math.round(MENU_CENTER), Math.round(MENU_CONFIRM_Y));
}

// Whole-number scale keeps art pixels crisp; the sub-pixel remainder shifts the whole
// image for smooth motion, and the overscan border means the shift never uncovers an
// empty edge. The menu passes 0,0 (no camera).
function blitBufferToScreen(fracX, fracY) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    screenCtx.imageSmoothingEnabled = false;
    screenCtx.clearRect(0, 0, canvas.width, canvas.height);
    screenCtx.drawImage(
        sceneCanvas,
        (fracX - BUFFER_BORDER) * screenScale,
        (fracY - BUFFER_BORDER) * screenScale,
        BUFFER_SIZE * screenScale,
        BUFFER_SIZE * screenScale
    );
}

// Cycles none -> weapon 0..5 -> none.
// Cycles none -> weapon 0..5 -> none.
function cycleWeapon() {
    currentWeapon = currentWeapon + 1 >= WEAPON_COUNT ? -1 : currentWeapon + 1;
}

// Draws the on-canvas weapon button into the buffer with an identity transform, so it
// sits fixed in the corner rather than moving with the world.
function drawWeaponButton() {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.imageSmoothingEnabled = false;

    context.fillStyle = '#000';
    context.fillRect(WPN_BTN_X - 2, WPN_BTN_Y - 2, WPN_BTN_W + 4, WPN_BTN_H + 4);
    context.fillStyle = '#161616';
    context.fillRect(WPN_BTN_X, WPN_BTN_Y, WPN_BTN_W, WPN_BTN_H);

    context.fillStyle = 'rgb(255, 53, 94)';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `${WPN_LABEL_PX}px "3x3", monospace`;
    context.fillText('WPN', Math.round(WPN_BTN_X + WPN_BTN_W / 2), Math.round(WPN_BTN_Y + WPN_BTN_H / 2));
}

function update(timeStamp) {
    const maxDeltaTime = 0.1; // Maximum time difference between frames (in seconds)
    const deltaTime = Math.min((timeStamp - lastTimeStamp) / 1000, maxDeltaTime);
    lastTimeStamp = timeStamp;

    // Menu is drawn through the same buffer as the game, then blit with no camera offset.
    if (gameState === 'menu') {
        if (previewSprite) previewSprite.update(deltaTime);
        drawMenu();
        blitBufferToScreen(0, 0);
        window.requestAnimationFrame(update);
        return;
    }

    // A dead character ignores input until it respawns
    const inputDirection = isAlive ? input.getJoystickValues() : { x: 0, y: 0 };

    // Track facing from input; hold the last direction while idle so the weapon keeps
    // pointing where the player last faced.
    const inputMag = Math.hypot(inputDirection.x, inputDirection.y);
    if (inputMag > 0.001) {
        facingX = inputDirection.x / inputMag;
        facingY = inputDirection.y / inputMag;
    }

    // Smooth input movement using lerp
    inputSmoothing.x = lerp(inputSmoothing.x, inputDirection.x, inputResponsiveness * deltaTime);
    inputSmoothing.y = lerp(inputSmoothing.y, inputDirection.y, inputResponsiveness * deltaTime);

    applyJumpPhysics(deltaTime);

    // Movement from input, plus the forward launch while airborne
    moveDirection.x = inputSmoothing.x * localUserSpeed + jumpImpulse.x;
    moveDirection.y = inputSmoothing.y * localUserSpeed + jumpImpulse.y;

    // Handle local player movement
    if (moveDirection.x != 0) {
        localUserPosition.x += moveDirection.x * deltaTime;
    }
    if (moveDirection.y != 0) {
        localUserPosition.y += moveDirection.y * deltaTime;
    }

    // Update camera to follow local player
    camera.x = lerp(camera.x, -localUserPosition.x + HALF_VIEW_WORLD, cameraFollowSpeed * deltaTime);
    camera.y = lerp(camera.y, -localUserPosition.y + HALF_VIEW_WORLD, cameraFollowSpeed * deltaTime);


    // --- RENDER THE WORLD INTO THE LOW-RES BUFFER ---
    // Camera in art pixels; render on a whole art-pixel and defer the leftover fraction
    // to the blit, so the world never snaps a whole pixel at a time.
    const camArtX = camera.x / spriteScale;
    const camArtY = camera.y / spriteScale;
    const floorX = Math.floor(camArtX);
    const floorY = Math.floor(camArtY);
    const fracX = camArtX - floorX;
    const fracY = camArtY - floorY;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, BUFFER_SIZE, BUFFER_SIZE);
    // World units scale down to art pixels; the camera lands on a whole art-pixel plus
    // the border. Existing draw calls stay in world units and need no changes.
    context.setTransform(
        1 / spriteScale, 0, 0, 1 / spriteScale,
        floorX + BUFFER_BORDER, floorY + BUFFER_BORDER
    );
    context.imageSmoothingEnabled = false;

    // --- DRAW IN WORLD ---

    drawTerrain();

    // Shadow stays on the ground under the player at all times, and outside the
    // respawn flash so it holds steady while the character pulses
    drawShadow(localUserPosition.x, localUserPosition.y);

    if (isAlive) {
        // Draw local player, pulsing if it just respawned
        context.save();
        context.globalAlpha = getRespawnFlashAlpha(deltaTime);

        const weaponBodyY = localUserPosition.y - spriteFootOffset + jumpOffsetY;
        // Facing more north (upward) tucks the weapon behind the player; facing south
        // (downward, or level) puts it in front.
        const weaponBehind = facingY < 0;

        if (weaponBehind) drawWeapon(localUserPosition.x, weaponBodyY);

        if (isGrounded) {
            drawAnimatedSpritePlayer(
                localAnimatedSprite,
                localUserPosition.x,
                localUserPosition.y,
                inputDirection.x,
                inputDirection.y,
                localPlayerState,
                playerIdleSheet,
                playerRunSheet,
                deltaTime
            );
        } else {
            drawJumpingPlayer(
                localUserPosition.x,
                localUserPosition.y,
                inputDirection.x,
                inputDirection.y,
                localPlayerState
            );
        }

        if (!weaponBehind) drawWeapon(localUserPosition.x, weaponBodyY);

        context.restore();
    } else {
        deathAnimatedSprite.x = localUserPosition.x;
        deathAnimatedSprite.y = localUserPosition.y - spriteFootOffset;
        deathAnimatedSprite.update(deltaTime);
        deathAnimatedSprite.drawSprite(context);

        // Hold the last frame for respawnDelay, then come back alive
        if (deathAnimatedSprite.finished) {
            respawnTimer += deltaTime;
            if (respawnTimer >= respawnDelay) respawnPlayer();
        }
    }

    // Fixed-position UI on top of the world, still inside the buffer.
    drawWeaponButton();

    // --- BLIT THE BUFFER TO THE SCREEN ---
    blitBufferToScreen(fracX, fracY);

    window.requestAnimationFrame(update);
}

function adjustCanvasSize() {
    const dpr = window.devicePixelRatio || 1;
    const availCss = Math.min(window.innerWidth, window.innerHeight) * canvasViewportPercentage;

    // Largest whole number of device pixels per art pixel that fits. A whole-number
    // scale is what makes the upscale pixel-perfect; the remainder is left as margin.
    screenScale = Math.max(1, Math.floor((availCss * dpr) / ART_VIEW));

    // Backing store is exactly the device pixels shown, so nothing gets resampled: the
    // canvas shows the ART_VIEW region and the buffer's border overhangs and is clipped.
    canvas.width = ART_VIEW * screenScale;
    canvas.height = ART_VIEW * screenScale;
    screenCtx.imageSmoothingEnabled = false;

    // The stage carries the display size; the canvas fills it. The weapon button
    // anchors to the stage's corner, so it rides along.
    const cssSize = (ART_VIEW * screenScale) / dpr;
    stage.style.width = cssSize + 'px';
    stage.style.height = cssSize + 'px';

    // Keep the joystick's full-tilt drag a constant fraction of the view regardless of
    // the on-screen scale.
    input.maxJoystickRange = (100 / spriteScale) * screenScale;
}

function lerp(start, end, t) {
    return start + (end - start) * t;
}

// Paints `color` over the opaque pixels of `source` into the `target` offscreen canvas.
// multiply keeps the sprite's black outlines and shading instead of flattening it to a
// solid silhouette; destination-in then re-applies the sheet's alpha so the fill is
// clipped to the character and never touches the transparent background.
function tintSheet(source, target, color) {
    const width = source.naturalWidth;
    const height = source.naturalHeight;
    if (!width || !height) return; // image not decoded yet

    target.width = width;
    target.height = height;

    const tintContext = target.getContext('2d');
    tintContext.imageSmoothingEnabled = false;

    tintContext.clearRect(0, 0, width, height);
    tintContext.globalCompositeOperation = 'source-over';
    tintContext.drawImage(source, 0, 0);

    tintContext.globalCompositeOperation = 'multiply';
    tintContext.fillStyle = color;
    tintContext.fillRect(0, 0, width, height);

    tintContext.globalCompositeOperation = 'destination-in';
    tintContext.drawImage(source, 0, 0);

    tintContext.globalCompositeOperation = 'source-over';
}

// color is any canvas fillStyle string (the difficulty buttons pass a hex).
function applyPlayerColor(color) {
    tintTargets.forEach(({ source, target }) => tintSheet(source, target, color));
}

// Starts a jump if grounded, off cooldown and alive. The arc is fixed, so every
// jump is the same height and forward launch regardless of how hard it was flicked.
function triggerJump(directionX, directionY) {
    if (!isAlive || !isGrounded || jumpCooldownTimer > 0) return false;

    jumpVelocityY = JUMP_FIXED_VEL;
    isGrounded = false;
    jumpCooldownTimer = JUMP_COOLDOWN;
    jumpImpulse.x = directionX * JUMP_FIXED_IMPULSE;
    jumpImpulse.y = directionY * JUMP_FIXED_IMPULSE;

    // Face the flick, so a jump from standing still still points the right way
    if (directionX !== 0) localPlayerState.lastDirectionX = directionX;
    const row = getDirectionRow(directionX, directionY);
    if (row !== null) jumpAnimatedSprite.currentRow = row;

    return true;
}

// Integrates the visual jump arc. jumpOffsetY is negative mid-air and returns to 0
// on landing, which is what ends the jump.
function applyJumpPhysics(deltaTime) {
    if (jumpCooldownTimer > 0) jumpCooldownTimer = Math.max(0, jumpCooldownTimer - deltaTime);
    if (isGrounded) return;

    jumpVelocityY += GRAVITY * deltaTime;
    jumpOffsetY += jumpVelocityY * deltaTime;

    if (jumpOffsetY >= 0) {
        jumpOffsetY = 0;
        jumpVelocityY = 0;
        isGrounded = true;
        jumpImpulse.x = 0;
        jumpImpulse.y = 0;
    }
}

// Weapon overlay. bodyX/bodyY is the sprite's centre (jump offset already folded in).
// The east-pointing art is rotated to the player's facing; whether it draws in front of
// or behind the player is decided by the caller from the facing's vertical component.
function drawWeapon(bodyX, bodyY) {
    if (currentWeapon < 0 || !weaponsImage.naturalWidth) return;

    const size = TILE_PX * spriteScale;
    const srcX = (currentWeapon % WEAPON_COLS) * TILE_PX;
    const srcY = Math.floor(currentWeapon / WEAPON_COLS) * TILE_PX;

    // Rotate the east-pointing art to the facing direction.
    const pivotX = bodyX + WEAPON_PIVOT_X;
    const pivotY = bodyY + WEAPON_PIVOT_Y;
    const angle = Math.atan2(facingY, facingX);

    context.save();
    context.imageSmoothingEnabled = false;
    context.translate(pivotX, pivotY);
    context.rotate(angle);
    // Facing left would otherwise leave the weapon belly-up; mirror it vertically so its
    // top stays up while still pointing along the facing.
    if (Math.cos(angle) < 0) context.scale(1, -1);
    context.translate(WEAPON_REACH, 0);
    context.drawImage(
        weaponsImage,
        srcX, srcY, TILE_PX, TILE_PX,
        -size / 2, -size / 2, size, size
    );
    context.restore();
}

// Always drawn on the ground position, never at the offset sprite position — so the
// gap between it and the feet is what reads as jump height. Shrinks as the character
// jumps away from the ground, and widens under the lying-down body on death.
function drawShadow(positionX, positionY) {
    let scaleX, scaleY;
    if (!isAlive) {
        // The death sprite stands for its first couple frames before dropping, so hold
        // the normal width until it goes horizontal, then widen.
        const deathFrame = deathAnimatedSprite
            ? (deathAnimatedSprite.currentRow - 1) * deathAnimatedSprite.totalColumns + deathAnimatedSprite.currentFrame
            : 0;
        scaleX = deathFrame < SHADOW_DEATH_DELAY_FRAMES ? 1 : SHADOW_DEATH_SCALE_X;
        scaleY = 1;
    } else {
        const jumpProgress = Math.min(1, Math.abs(jumpOffsetY) / JUMP_APEX_HEIGHT);
        scaleX = scaleY = lerp(1, SHADOW_MIN_JUMP_SCALE, jumpProgress);
    }
    drawShadowNineSlice(positionX, positionY, scaleX, scaleY);
}

// 9-slice blit of shadow.png: the 1px corners always render at native pixel scale, the
// top/bottom edges stretch horizontally only, the left/right edges vertically only, and
// the centre in both. scaleX/scaleY scale just the stretchable spans, so scaling the
// shadow never distorts the pixel-art border. Slice edges are rounded to whole device
// pixels so the nine pieces abut with no seams or gaps.
function drawShadowNineSlice(centerX, centerY, scaleX, scaleY) {
    if (!shadowImage.naturalWidth) return; // not decoded yet

    const sw = shadowImage.naturalWidth;   // 10
    const sh = shadowImage.naturalHeight;  // 4
    const corner = 1;                      // source corner size in px

    const dCorner = corner * spriteScale;
    const dMidW = (sw - 2 * corner) * spriteScale * scaleX;
    const dMidH = (sh - 2 * corner) * spriteScale * scaleY;

    const x0 = centerX - (dCorner * 2 + dMidW) / 2;
    const y0 = centerY - (dCorner * 2 + dMidH) / 2;

    // Source and destination slice boundaries (3 columns x 3 rows).
    const sx = [0, corner, sw - corner, sw];
    const sy = [0, corner, sh - corner, sh];
    const dx = [x0, x0 + dCorner, x0 + dCorner + dMidW, x0 + 2 * dCorner + dMidW].map(Math.round);
    const dy = [y0, y0 + dCorner, y0 + dCorner + dMidH, y0 + 2 * dCorner + dMidH].map(Math.round);

    context.save();
    context.globalAlpha = SHADOW_OPACITY;
    context.imageSmoothingEnabled = false;
    for (let col = 0; col < 3; col++) {
        for (let row = 0; row < 3; row++) {
            const dw = dx[col + 1] - dx[col];
            const dh = dy[row + 1] - dy[row];
            if (dw <= 0 || dh <= 0) continue;
            context.drawImage(
                shadowImage,
                sx[col], sy[row], sx[col + 1] - sx[col], sy[row + 1] - sy[row],
                dx[col], dy[row], dw, dh
            );
        }
    }
    context.restore();
}

// Airborne draw: one held frame for the whole jump. Steering mid-air still re-faces
// the sprite; with no input it keeps the row set at takeoff.
function drawJumpingPlayer(positionX, positionY, directionX, directionY, playerState) {
    jumpAnimatedSprite.x = positionX;
    jumpAnimatedSprite.y = positionY - spriteFootOffset + jumpOffsetY;

    if (directionX !== 0) playerState.lastDirectionX = directionX;
    const row = getDirectionRow(directionX, directionY);
    if (row !== null) jumpAnimatedSprite.currentRow = row;

    context.save();
    if (playerState.lastDirectionX < 0) {
        context.translate(jumpAnimatedSprite.x * 2, 0);
        context.scale(-1, 1);
    }
    jumpAnimatedSprite.drawSprite(context);
    context.restore();
}

function getSquaredDistance(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return dx * dx + dy * dy;
}

// Sheet row for a heading. Idle, walk and jump all share this row order:
// 1=North, 2=North-East, 3=East, 4=South-East, 5=South. West-facing angles reuse
// the East-side rows and rely on the caller's horizontal flip.
// Returns null when there's no meaningful direction, so the caller keeps its last row.
function getDirectionRow(directionX, directionY) {
    const epsilon = 0.01;
    if (Math.abs(directionX) <= epsilon && Math.abs(directionY) <= epsilon) return null;

    let degrees = Math.atan2(directionY, directionX) * (180 / Math.PI);
    if (degrees < 0) degrees += 360;

    if (degrees >= 337.5 || degrees < 22.5)        return 3; // East
    else if (degrees >= 22.5 && degrees < 67.5)    return 4; // South-East
    else if (degrees >= 67.5 && degrees < 112.5)   return 5; // South
    else if (degrees >= 112.5 && degrees < 157.5)  return 4; // South-West (flipped South-East)
    else if (degrees >= 157.5 && degrees < 202.5)  return 3; // West (flipped East)
    else if (degrees >= 202.5 && degrees < 247.5)  return 2; // North-West (flipped North-East)
    else if (degrees >= 247.5 && degrees < 292.5)  return 1; // North
    return 2; // North-East
}

// Cosine wave so the pulse eases rather than strobes. It both starts and lands on
// 1.0, so the player fades back in and finishes fully opaque.
function getRespawnFlashAlpha(deltaTime) {
    if (respawnFlashTimer <= 0) return 1;

    respawnFlashTimer = Math.max(0, respawnFlashTimer - deltaTime);

    const progress = 1 - respawnFlashTimer / respawnFlashDuration;
    const wave = (Math.cos(progress * respawnFlashPulses * Math.PI * 2) + 1) / 2;
    return lerp(respawnFlashMinAlpha, 1, wave);
}

// Picking uniformly at random every death gives long identical streaks — with two
// animations an 8-in-a-row turns up about once every 256 deaths, which just reads as
// broken. This deals every animation once before any repeats, so the most that can
// ever play back to back is two (the tail of one bag into the head of the next).
let deathBag = [];

function nextDeathSheet() {
    if (deathBag.length === 0) {
        deathBag = deathSheets.map((_, index) => index);
        for (let i = deathBag.length - 1; i > 0; i--) { // Fisher-Yates
            const j = Math.floor(Math.random() * (i + 1));
            [deathBag[i], deathBag[j]] = [deathBag[j], deathBag[i]];
        }
    }
    return deathSheets[deathBag.pop()];
}

function killPlayer() {
    isAlive = false;
    respawnTimer = 0;
    respawnFlashTimer = 0; // dying mid-pulse cancels it

    // Play one of the death animations, once, holding the last frame
    const sheet = nextDeathSheet();
    deathAnimatedSprite = new AnimatedSprite(
        sheet, 4, 2, 1, 4, spriteScale,
        localUserPosition.x, localUserPosition.y,
        0.12, true, false, false
    );
    deathAnimatedSprite.start();

    // Kill any leftover momentum so the corpse doesn't drift, and drop it out of
    // any jump in progress so the death plays on the ground
    inputSmoothing.x = 0;
    inputSmoothing.y = 0;
    isGrounded = true;
    jumpOffsetY = 0;
    jumpVelocityY = 0;
    jumpImpulse.x = 0;
    jumpImpulse.y = 0;
}

function respawnPlayer() {
    isAlive = true;
    deathAnimatedSprite = null;
    respawnTimer = 0;
    respawnFlashTimer = respawnFlashDuration;

    localAnimatedSprite.setSpriteSheet(playerIdleSheet, 4, 5, 5, 4, 0.2);
    localAnimatedSprite.isPlaying = true;
    localAnimatedSprite.finished = false;
    localPlayerState.lastDirectionX = 1;
}

// Draws the dual-grid display cells covering the viewport. Display cells sit half a
// tile off the terrain grid, so cell (col,row) is centred on the terrain corner at
// (col, row) * TILE_SIZE. Out-of-bounds terrain reads as dirt, so this keeps filling
// the screen however far the player wanders off the island.
function drawTerrain() {
    if (!terrainTiles.naturalWidth) return; // not decoded yet

    const left = -camera.x;
    const top = -camera.y;
    const half = TILE_SIZE / 2;
    // World units the buffer covers; pad a tile each side so the sub-pixel shift and the
    // overscan border can never reveal an unfilled cell.
    const viewWorld = BUFFER_SIZE * spriteScale;

    const startCol = Math.floor((left - half - TILE_SIZE) / TILE_SIZE);
    const endCol = Math.ceil((left + viewWorld + half + TILE_SIZE) / TILE_SIZE);
    const startRow = Math.floor((top - half - TILE_SIZE) / TILE_SIZE);
    const endRow = Math.ceil((top + viewWorld + half + TILE_SIZE) / TILE_SIZE);

    for (let row = startRow; row <= endRow; row++) {
        for (let col = startCol; col <= endCol; col++) {
            const [atlasCol, atlasRow] = dualGridAtlasAt(col, row);
            context.drawImage(
                terrainTiles,
                atlasCol * TILE_PX, atlasRow * TILE_PX, TILE_PX, TILE_PX,
                col * TILE_SIZE - half, row * TILE_SIZE - half, TILE_SIZE, TILE_SIZE
            );
        }
    }
}

function drawAnimatedSpritePlayer(
    animatedSprite,
    positionX,
    positionY,
    directionX,
    directionY,
    playerState,
    idleImage,
    runImage,
    deltaTime
){
    context.save(); // Save current state
    animatedSprite.x = positionX;
    animatedSprite.y = positionY - spriteFootOffset;
    if(directionX !== 0) playerState.lastDirectionX = directionX;

    // horizontal flip for reverse direction
    if (playerState.lastDirectionX < 0) {
        context.translate(animatedSprite.x * 2, 0);
        context.scale(-1, 1);
    }

    const epsilon = 0.01; // or 0.001 depending on how precise you want it
    let isMoving = Math.abs(directionX) > epsilon || Math.abs(directionY) > epsilon;

    // change spritesheet for state (both sheets are 4 cols x 5 rows, 4 frames per row)
    if (isMoving && animatedSprite.spriteSheet !== runImage) {
        animatedSprite.setSpriteSheet(runImage, 4, 5, animatedSprite.currentRow, 4, 0.12);
    } else if (!isMoving && animatedSprite.spriteSheet !== idleImage) {
        animatedSprite.setSpriteSheet(idleImage, 4, 5, animatedSprite.currentRow, 4, 0.2);
    }

    // change spritesheet row by angle of movement
    const row = getDirectionRow(directionX, directionY);
    if (row !== null) animatedSprite.currentRow = row;

    animatedSprite.update(deltaTime);
    animatedSprite.drawSprite(context);
    context.restore(); // Restore canvas to unchanged state
}
