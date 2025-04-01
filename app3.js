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

    let users = {};
    let localUserPosition = { x: 0, y: 0 };
    const localUserId = crypto.randomUUID();

    // Channel for presence and broadcast
    const channel = supabase.channel('user_tracking', {
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

    let input = new Input(canvas);
    input.addEventListeners();

    let camera = { x: 0, y: 0 };
    let cameraFollowSpeed = 0.05;

    const drawnPositions = {};
    
    // Start the animation loop
    update();
  
    // Simple animation loop to log users' mouse positions
    function update() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();

         // Handle local player movement
        let moved = false;
        if (input.getJoystickValues().x != 0) {
            localUserPosition.x += (input.getJoystickValues().x * 3);
            moved = true;
        }
        if (input.getJoystickValues().y != 0) {
            localUserPosition.y += (input.getJoystickValues().y * 3);
            moved = true;
        }

        const now = Date.now();
        if (moved && now - lastUpdate > 250) {
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
        ctx.translate(camera.x, camera.y);

        //draw other users
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
        ctx.restore();

        requestAnimationFrame(update);
    }

    function drawUser(userPosition, userId){
        ctx.beginPath();
        ctx.arc(userPosition.x, userPosition.y, 10, 0, Math.PI * 2);
        ctx.fillStyle = 'black';
        ctx.fill();
        ctx.fillStyle = 'black';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(userId.substring(0, 6), userPosition.x, userPosition.y - 10 - 5);
    }

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