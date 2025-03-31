import { Input } from './input.js';

window.addEventListener('load', () => {
// Create a Supabase client to handle real-time data synchronization
const supabaseClient = supabase.createClient(
    'https://gqbeyhseepsnhxjblxzh.supabase.co', // Supabase project URL
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxYmV5aHNlZXBzbmh4amJseHpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI3Njk5NDksImV4cCI6MjA1ODM0NTk0OX0.c-3qmp9WTVOEVMlJnSS4b128roCBHd978t3lGebWq4s' // Supabase API key
);

// Get the canvas and set up the rendering context
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Adjust canvas size to match the window size
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Define the local player object
const myPlayer = {
    id: Math.random().toString(36).substring(2, 9), // Generate a random unique ID
    x: canvas.width / 2,   // Initial X position (center of screen)
    y: canvas.height / 2,  // Initial Y position (center of screen)
    targetX: canvas.width / 2,  // Target position for smooth interpolation
    targetY: canvas.height / 2,
    radius: 15,  // Player size
    color: `hsl(${Math.random() * 360}, 70%, 50%)`, // Random color for differentiation
    speed: 3  // Player movement speed
};

// Object to store all players (both local and remote)
const players = {};

// Track the last update time for game logic (can be used for animations or network sync)
let lastUpdate = 0;

// Set up a real-time communication channel through Supabase
const channel = supabaseClient.channel("game_room", {
    config: { presence: { key: myPlayer.id } } // Use the player's unique ID as the presence key
});

// When the player joins the channel, send their initial position and color
channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") await channel.track({
        x: myPlayer.x,
        y: myPlayer.y,
        color: myPlayer.color
    });
});

// Handle real-time updates for players joining, moving, or leaving
channel.on("presence", { event: "sync" }, () => {
    const state = channel.presenceState(); // Get the current state of all players

    // Iterate through all players in the state and update their positions
    Object.entries(state).forEach(([id, data]) => {
        if (!players[id]) {
            // If a new player appears, add them with initial values
            players[id] = {
                x: data[0].x,
                y: data[0].y,
                targetX: data[0].x,
                targetY: data[0].y,
                color: data[0].color
            };
        } else {
            // Update existing players' target positions for smooth interpolation
            players[id].targetX = data[0].x;
            players[id].targetY = data[0].y;
        }
    });

    // Remove players who have left the game
    Object.keys(players).forEach(id => { if (!state[id]) delete players[id]; });
});

// Add the local player to the `players` object so it's included in the game
players[myPlayer.id] = myPlayer;

// Initialize player input handling
let input = new Input(canvas);
input.addEventListeners();

// Camera object to track the player's position smoothly
let camera = { x: 0, y: 0 };
let cameraFollowSpeed = 0.05;

// Start the game loop
gameLoop();

// Clean up when the player leaves the page
window.addEventListener('beforeunload', () => channel.untrack());

// Handle window resizing to keep the canvas fullscreen
window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});


function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.save();

    let moved = false;
    if (input.getJoystickValues().x != 0) {myPlayer.x += (input.getJoystickValues().x * myPlayer.speed); moved = true;}
    if (input.getJoystickValues().y != 0) {myPlayer.y += (input.getJoystickValues().y * myPlayer.speed); moved = true;}

    // If the player has moved and 100ms have passed since the last update, send the new position to the server
    if (moved && Date.now() - lastUpdate > 100) {
        lastUpdate = Date.now();

        // Set the player's target position to their current position (so they don't suddenly jump)
        myPlayer.targetX = myPlayer.x;
        myPlayer.targetY = myPlayer.y;

        // Track the player's position and color to the server (sends data for presence in the game room)
        channel.track({ x: myPlayer.x, y: myPlayer.y, color: myPlayer.color });
    }

    // Update all other players' positions using smooth interpolation (lerp)
    Object.entries(players).forEach(([id, player]) => {
        // Use linear interpolation (lerp) to smoothly move players towards their target positions
        player.x = lerp(player.x, player.targetX, 0.05);
        player.y = lerp(player.y, player.targetY, 0.05);
    });

    // If the local player's data is in the players object, update the camera to follow them
    if (players[myPlayer.id]) {
        // Get the smoothed position of the local player (after interpolation)
        let smoothedX = players[myPlayer.id].x;
        let smoothedY = players[myPlayer.id].y;

        // Update the camera's position to follow the local player using lerp for smooth movement
        camera.x = lerp(camera.x, -smoothedX + canvas.width / 2, cameraFollowSpeed);
        camera.y = lerp(camera.y, -smoothedY + canvas.height / 2, cameraFollowSpeed);
    }

    // Draw the grid on the canvas, offsetting it by the camera's current position
    drawGrid(-(camera.x + canvas.width / 2), -(camera.y + canvas.height / 2));

    // Apply the camera's transformation to the context (i.e., move the "view" to follow the camera)
    ctx.translate(camera.x, camera.y);

    // Render all players (including the local player) on the canvas
    Object.entries(players).forEach(([id, player]) => {
        ctx.beginPath();
        ctx.arc(player.x, player.y, myPlayer.radius, 0, Math.PI * 2);
        ctx.fillStyle = player.color;
        ctx.fill();
        ctx.fillStyle = 'black';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(id.substring(0, 6), player.x, player.y - myPlayer.radius - 5);
    });

    ctx.restore();

    requestAnimationFrame(gameLoop);
}

function lerp(start, end, t) {
    return start + (end - start) * t;
}

function drawGrid(offsetX, offsetY) {
    let gridSize = 50; // Size of each grid cell
    ctx.strokeStyle = "#cccccc"; // Light grey color
    ctx.lineWidth = 0.5;

    // Find the top-left corner of the grid relative to the camera
    let startX = Math.floor(offsetX / gridSize) * gridSize - offsetX;
    let startY = Math.floor(offsetY / gridSize) * gridSize - offsetY;

    // Draw vertical grid lines
    for (let x = startX; x < canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }

    // Draw horizontal grid lines
    for (let y = startY; y < canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }
}

});
