import { Input } from './input.js';

window.addEventListener('load', async () => {
    const supabaseUrl = 'https://gqbeyhseepsnhxjblxzh.supabase.co';
    const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxYmV5aHNlZXBzbmh4amJseHpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI3Njk5NDksImV4cCI6MjA1ODM0NTk0OX0.c-3qmp9WTVOEVMlJnSS4b128roCBHd978t3lGebWq4s';
    const supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey);

    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    let lastUpdate = Date.now();
    let isConnected = false;
    
    // Generate a random color for the local player that will be synced to others
    const playerColor = `hsl(${Math.random() * 360}, 70%, 50%)`;
    
    let localPlayer = { 
        id: crypto.randomUUID(), 
        x: canvas.width / 2,
        y: canvas.height / 2,
        radius: 15,
        color: playerColor, // Use the synced color
        speed: 3,
        lastUpdate: Date.now()
    };
    let players = {};

    const channel = supabase.channel('players', {
        config: {
            broadcast: { self: true },
            presence: { key: localPlayer.id }
        }
    });

    // Handle presence sync
    channel.on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const currentPlayers = {};
        
        Object.keys(state).forEach(userId => {
            const presenceArray = state[userId];
            if (presenceArray && presenceArray.length > 0) {
                currentPlayers[userId] = {
                    ...presenceArray[0],
                    renderX: presenceArray[0].x || 0,
                    renderY: presenceArray[0].y || 0,
                    targetX: presenceArray[0].x || 0,
                    targetY: presenceArray[0].y || 0,
                    lastUpdate: presenceArray[0].lastUpdate || Date.now(),
                    color: presenceArray[0].color || playerColor // Use the received color
                };
            }
        });
        
        Object.keys(currentPlayers).forEach(playerId => {
            if (!players[playerId]) {
                // New player - initialize with received color
                players[playerId] = {
                    ...currentPlayers[playerId],
                    renderX: currentPlayers[playerId].x,
                    renderY: currentPlayers[playerId].y,
                    color: currentPlayers[playerId].color // Keep the synced color
                };
            } else {
                // Existing player - update target position and color
                players[playerId].targetX = currentPlayers[playerId].x;
                players[playerId].targetY = currentPlayers[playerId].y;
                players[playerId].lastUpdate = currentPlayers[playerId].lastUpdate;
                players[playerId].color = currentPlayers[playerId].color; // Maintain color sync
            }
        });
        
        Object.keys(players).forEach(playerId => {
            if (!currentPlayers[playerId]) {
                delete players[playerId];
            }
        });
    });

    channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
        leftPresences.forEach(presence => {
            if (presence.key) {
                delete players[presence.key];
            }
        });
    });

    channel.on('broadcast', { event: 'player-position' }, (payload) => {
        const { senderId, x, y, color, lastUpdate } = payload.payload;
        if (senderId !== localPlayer.id) {
            if (!players[senderId]) {
                players[senderId] = {
                    renderX: x,
                    renderY: y,
                    targetX: x,
                    targetY: y,
                    lastUpdate: lastUpdate,
                    color: color, // Use the received color
                    radius: 15
                };
            } else {
                // Update target position and maintain the received color
                players[senderId].targetX = x;
                players[senderId].targetY = y;
                players[senderId].lastUpdate = lastUpdate;
                players[senderId].color = color; // Keep color in sync
            }
        }
    });

    channel.subscribe(async (status) => {
        isConnected = status === 'SUBSCRIBED';
        if (isConnected) {
            await channel.track({ 
                x: localPlayer.x, 
                y: localPlayer.y,
                color: localPlayer.color, // Send our color
                radius: localPlayer.radius,
                lastUpdate: localPlayer.lastUpdate
            });
        }
    });

    function loop() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();

        // Handle local player movement
        let moved = false;
        if (input.getJoystickValues().x != 0) {
            localPlayer.x += (input.getJoystickValues().x * localPlayer.speed);
            moved = true;
        }
        if (input.getJoystickValues().y != 0) {
            localPlayer.y += (input.getJoystickValues().y * localPlayer.speed);
            moved = true;
        }

        const now = Date.now();
        if (moved && now - lastUpdate > 100) {
            lastUpdate = now;
            localPlayer.lastUpdate = now;
            
            if (isConnected) {
                channel.track({ 
                    x: localPlayer.x, 
                    y: localPlayer.y,
                    color: localPlayer.color, // Send our color
                    radius: localPlayer.radius,
                    lastUpdate: now
                });
                
                channel.send({
                    type: 'broadcast',
                    event: 'player-position',
                    payload: {
                        senderId: localPlayer.id,
                        x: localPlayer.x,
                        y: localPlayer.y,
                        color: localPlayer.color, // Send our color
                        radius: localPlayer.radius,
                        lastUpdate: now
                    }
                });
            }
        }

        // Update camera to follow local player
        camera.x = lerp(camera.x, -localPlayer.x + canvas.width / 2, cameraFollowSpeed);
        camera.y = lerp(camera.y, -localPlayer.y + canvas.height / 2, cameraFollowSpeed);

        // Draw grid
        drawGrid(-(camera.x + canvas.width / 2), -(camera.y + canvas.height / 2));

        // Apply camera transform
        ctx.translate(camera.x, camera.y);

        // Draw all players
        Object.keys(players).forEach(id => {
            const player = players[id];
            if (id !== localPlayer.id) {
                // Smooth interpolation
                player.renderX = lerp(player.renderX, player.targetX, 0.1);
                player.renderY = lerp(player.renderY, player.targetY, 0.1);

                // Draw player with synced color
                ctx.beginPath();
                ctx.arc(player.renderX, player.renderY, player.radius, 0, Math.PI * 2);
                ctx.fillStyle = player.color; // Use the synced color
                ctx.fill();
                
                // Draw player name
                ctx.fillStyle = 'black';
                ctx.font = '12px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(id.substring(0, 6), player.renderX, player.renderY - player.radius - 5);
            }
        });

        // Draw local player
        ctx.beginPath();
        ctx.arc(localPlayer.x, localPlayer.y, localPlayer.radius, 0, Math.PI * 2);
        ctx.fillStyle = localPlayer.color;
        ctx.fill();
        ctx.fillStyle = 'black';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(localPlayer.id.substring(0, 6), localPlayer.x, localPlayer.y - localPlayer.radius - 5);

        ctx.restore();
        window.requestAnimationFrame(loop);
    }

    let input = new Input(canvas);
    input.addEventListeners();

    let camera = { x: 0, y: 0 };
    let cameraFollowSpeed = 0.05;

    loop();

    window.addEventListener('beforeunload', async () => {
        if (channel) {
            await channel.track(null);
            await channel.unsubscribe();
        }
    });

    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });

    function lerp(start, end, t) {
        return start + (end - start) * t;
    }
    
    function drawGrid(offsetX, offsetY) {
        const gridSize = 50;
        ctx.strokeStyle = "#cccccc";
        ctx.lineWidth = 0.5;
    
        const startX = Math.floor(offsetX / gridSize) * gridSize - offsetX;
        const startY = Math.floor(offsetY / gridSize) * gridSize - offsetY;
    
        for (let x = startX; x < canvas.width; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }
    
        for (let y = startY; y < canvas.height; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }
    }
});