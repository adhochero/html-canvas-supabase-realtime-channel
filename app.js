import { Input } from './input.js';

const supabaseUrl = 'https://gqbeyhseepsnhxjblxzh.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxYmV5aHNlZXBzbmh4amJseHpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI3Njk5NDksImV4cCI6MjA1ODM0NTk0OX0.c-3qmp9WTVOEVMlJnSS4b128roCBHd978t3lGebWq4s';
const supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey);

let channel = null;

const canvas = document.getElementById('gameCanvas');
const context = canvas.getContext('2d');
const canvasViewportPercentage = 0.9;
const canvasResolutionWidth = 666;
const canvasResolutionHeight = 666;

let lastUpdate = Date.now();

let users = {};
let localUserPosition = { x: 0, y: 0 };
const localUserId = crypto.randomUUID();

const drawnPositions = {};

let input = new Input(canvas);
input.addEventListeners();

let inputSmoothing = { x: 0, y: 0 };
let velocity = { x: 0, y: 0 };
let moveDirection = { x: 0, y: 0 };
let inputResponsiveness = 3;
let localUserSpeed = 200;

let camera = { x: 0, y: 0 };
let cameraFollowSpeed = 0.05;

let lastTimeStamp = 0;

window.onresize = adjustCanvasSize;

window.addEventListener('load', async () => {
    initNetworking();
    adjustCanvasSize();

    // Start the animation loop
    window.requestAnimationFrame(update);     
});

function initNetworking(){
    // Channel for presence and broadcast
    channel = supabase.channel('user_tracking', {
        config: { presence: { key: 'user_id' } }
    });

    // Setup presence tracking
    channel
    .on('presence', { event: 'sync' }, () => {
        // Efficiently rebuild the users object only when absolutely needed
        const newUsers = {};
        Object.values(channel.presenceState()).forEach(presences => {
            presences.forEach(presence => {
                newUsers[presence.user_id] = {
                    // Preserve existing data if available, only update if missing
                    user_position: users[presence.user_id]?.user_position 
                                || presence.user_position 
                                || { x: 0, y: 0 }
                };
            });
        });
        users = newUsers; // Atomic swap
    })
    .on('presence', { event: 'join' }, ({ newPresences }) => {
        // Only add truly new users (not already tracked)
        newPresences.forEach(presence => {
            if (!users[presence.user_id]) {
                users[presence.user_id] = {
                    user_position: presence.user_position || { x: 0, y: 0 }
                };
            }
        });
    })
    .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        // Immediate cleanup
        leftPresences.forEach(presence => {
            delete users[presence.user_id];
        });
    });

    // Handle broadcast messages
    channel.on('broadcast', { event: 'user_move' }, ({ payload }) => {
        if (payload.user_id !== localUserId) {  // Don't update our own position from broadcasts
            users[payload.user_id] = {
                user_position: payload.user_position
            };
        }
    });

    // Subscribe to the channel
    channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
            channel.track({
                user_id: localUserId,
                user_position: localUserPosition,
            });
        }
    });
}

function update(timeStamp) {
    const maxDeltaTime = 0.1; // Maximum time difference between frames (in seconds)
    const deltaTime = Math.min((timeStamp - lastTimeStamp) / 1000, maxDeltaTime);
    lastTimeStamp = timeStamp;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.beginPath();
    context.imageSmoothingEnabled = false;

    const inputDirection = input.getJoystickValues();

    // Smooth input movement using lerp
    inputSmoothing.x = lerp(inputSmoothing.x, inputDirection.x, inputResponsiveness * deltaTime);
    inputSmoothing.y = lerp(inputSmoothing.y, inputDirection.y, inputResponsiveness * deltaTime);

    // Apply velocity falloff
    velocity.x = lerp(velocity.x, 0, inputResponsiveness * deltaTime);
    velocity.y = lerp(velocity.y, 0, inputResponsiveness * deltaTime);

    // Combine velocity and input movement
    moveDirection.x = velocity.x + (inputSmoothing.x * localUserSpeed);
    moveDirection.y = velocity.y + (inputSmoothing.y * localUserSpeed);

    // Handle local player movement
    let moved = false;
    if (moveDirection.x != 0) {
        localUserPosition.x += moveDirection.x * deltaTime;
        moved = true;
    }
    if (moveDirection.y != 0) {
        localUserPosition.y += moveDirection.y * deltaTime;
        moved = true;
    }

    // thottle my network updates
    const now = Date.now();
    if (moved && now - lastUpdate > 200) {
        lastUpdate = now;

        // Update our presence
        channel.track({
            user_id: localUserId,
            user_position: localUserPosition,
        });

        // Broadcast user position to others
        channel.send({
            type: 'broadcast',
            event: 'user_move',
            payload: {
                user_id: localUserId,
                user_position: localUserPosition,
            },
        });
    }

    // Update camera to follow local player
    camera.x = lerp(camera.x, -localUserPosition.x + canvas.width / 2, cameraFollowSpeed);
    camera.y = lerp(camera.y, -localUserPosition.y + canvas.height / 2, cameraFollowSpeed);

    // Draw grid
    drawGrid(-(camera.x + canvas.width / 2), -(camera.y + canvas.height / 2));

    // Apply camera transform
    context.translate(camera.x, camera.y);

    // Draw other users
    Object.entries(users).forEach(([id, data]) => {
        if(id === localUserId) return;

            // Initialize the drawn position if it doesn't exist
            if (!drawnPositions[id]) {
                drawnPositions[id] = {
                    x: data.user_position.x,
                    y: data.user_position.y
                };
            }

        // Apply lerp to smooth the movement
        drawnPositions[id].x = lerp(drawnPositions[id].x, data.user_position.x, 0.03);
        drawnPositions[id].y = lerp(drawnPositions[id].y, data.user_position.y, 0.03);

        drawUser(drawnPositions[id], id);
    });

    drawUser(localUserPosition, localUserId);
    context.restore();

    window.requestAnimationFrame(update);
}

function drawUser(userPosition, userId){
    context.beginPath();
    context.arc(userPosition.x, userPosition.y, 10, 0, Math.PI * 2);
    context.fillStyle = 'black';
    context.fill();
    context.fillStyle = 'black';
    context.font = 'bold 12px Arial';
    context.textAlign = 'center';
    context.fillText(userId.substring(0, 6), userPosition.x, userPosition.y - 10 - 5);
}

function adjustCanvasSize() {
    let scaleX = window.innerWidth / canvasResolutionWidth;
    let scaleY = window.innerHeight / canvasResolutionHeight;
    let scale = Math.min(scaleX, scaleY) * canvasViewportPercentage;

    // Set the internal resolution (render size)
    canvas.width = canvasResolutionWidth;
    canvas.height = canvasResolutionHeight;

    // Set the display size (CSS pixels)
    canvas.style.width = canvasResolutionWidth * scale + 'px';
    canvas.style.height = canvasResolutionHeight * scale + 'px';
}

function lerp(start, end, t) {
    return start + (end - start) * t;
}

function drawGrid(offsetX, offsetY) {
    const gridSize = 50;
    context.strokeStyle = "#cccccc";
    context.lineWidth = 0.5;

    const startX = Math.floor(offsetX / gridSize) * gridSize - offsetX;
    const startY = Math.floor(offsetY / gridSize) * gridSize - offsetY;

    for (let x = startX; x < canvas.width; x += gridSize) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, canvas.height);
        context.stroke();
    }

    for (let y = startY; y < canvas.height; y += gridSize) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(canvas.width, y);
        context.stroke();
    }
}