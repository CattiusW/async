const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const http = require('http');
const socketIO = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fetch = require('node-fetch');
let marked;
(async () => {
    marked = (await import('marked')).marked;
})();

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const port = 80;
let blockNewConnections = false;

const adminPath = path.join(__dirname, 'data', 'admin.json');
const adminDATA = JSON.parse(fs.readFileSync(adminPath, 'utf8'));
const MOD = adminDATA.username;

const sessionMiddleware = session({
    secret: crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false
    }
});
app.use(sessionMiddleware);


const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMiddleware));

app.use((req, res, next) => {
    if (blockNewConnections) {
        console.log(`Blocked HTTP request from ${req.ip} to ${req.originalUrl}`);
        req.destroy?.(); // silently close (Node 14+ supports this)
        return;
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());


app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');
app.set('views', path.join(__dirname, 'html'));


function formatIP(ip, url) {
    const cleanIP = ip.startsWith('::ffff:') ? ip.replace('::ffff:', '') : ip;
    return logUniqueIP(cleanIP, url);
}

function formIP(ip) {
    return ip.startsWith('::ffff:') ? ip.replace('::ffff:', '') : ip;
}

function logUniqueIP(ip, url) {
    const filePath = path.join(__dirname, 'ip-log.json');
    let ipList = [];

    if (fs.existsSync(filePath)) {
        try {
            ipList = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (err) {
            console.error('Error parsing IP list:', err);
        }
    }

    if (!ipList.includes(ip)) {
        ipList.push(ip);
        fs.writeFileSync(filePath, JSON.stringify(ipList, null, 2));
        console.log(`New visitor: ${ip} visited ${url}`);
    } else {
        console.log(`Visitor: ${ip} visited ${url}`);
    }
}




app.post('/webhook', (req, res) => {
    const rawIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    formatIP(rawIP, req.originalUrl);
    console.table(req.body);
    res.status(200).send('');
});




app.get('/login', (req, res) => {
    const rawIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    formatIP(rawIP, req.originalUrl);
    const error = req.query.error;
    res.render('chat-login', {
        error
    });
});


app.post('/chat-login', (req, res) => {
    const {
        username,
        password
    } = req.body;
    const usersPath = path.join(__dirname, 'data/users.json');
    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    const user = users.find(u => u.username === username);

    if (user && bcrypt.compareSync(password, user.password)) {
        req.session.chatUser = username;
        return res.redirect('/');
    }

    res.redirect('/login?error=Invalid%20credentials');
});


app.get('/', (req, res) => {
    const rawIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    formatIP(rawIP, req.originalUrl);

    if (!req.session.chatUser) return res.redirect('/login');
    res.render('chat', {
        user: req.session.chatUser
    });
});


function getMessages(room) {
    const filePath = path.join(__dirname, 'data/messages.json');
    let data = [];
    if (fs.existsSync(filePath)) {
        try {
            data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (err) {
            console.error('Error reading messages:', err);
        }
    }
    const chat = data.find(c => c.room === room);
    return chat ? chat.messages : [];
}

function saveMessage(room, message) {
    const filePath = path.join(__dirname, 'data/messages.json');
    let data = [];
    if (fs.existsSync(filePath)) {
        try {
            data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (err) {
            console.error('Error reading messages:', err);
        }
    }
    let chat = data.find(c => c.room === room);
    if (!chat) {
        chat = {
            room,
            messages: []
        };
        data.push(chat);
    }
    chat.messages.push(message);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}


function getRooms() {
    const filePath = path.join(__dirname, 'data/rooms.json');
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveRooms(rooms) {
    const filePath = path.join(__dirname, 'data/rooms.json');
    fs.writeFileSync(filePath, JSON.stringify(rooms, null, 2));
}

function userCanAccessRoom(user, roomName) {
    const rooms = getRooms();
    const room = rooms.find(r => r.name === roomName);
    if (!room) return false;
    if (!room.private) return true;
    return room.allowed.includes(user);
}


app.get('/api/rooms', (req, res) => {
    if (!req.session.chatUser) return res.status(401).json([]);
    const user = req.session.chatUser;
    const rooms = getRooms().filter(r => !r.private || r.allowed.includes(user));
    res.json(rooms.map(r => r.name));
});


app.get('/api/users', (req, res) => {
    const usersPath = path.join(__dirname, 'data/users.json');
    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));

    res.json(users.map(u => u.username).filter(username => username.toLowerCase() !== 'admin'));
});

let pendingSignups = [];


app.post('/api/signup', (req, res) => {
    const {
        username,
        password
    } = req.body;
    if (!username || !password) return res.status(400).send('Username and password required');

    const usersPath = path.join(__dirname, 'data/users.json');
    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
        return res.status(409).send('User already exists');
    }

    if (pendingSignups.some(u => u.username.toLowerCase() === username.toLowerCase())) {
        return res.status(409).send('Signup already pending');
    }

    const bcrypt = require('bcrypt');
    const hash = bcrypt.hashSync(password, 10);
    pendingSignups.push({
        username,
        password: hash
    });
    res.status(202).send('Signup request submitted, awaiting admin approval');
});


app.get('/api/pending-signups', (req, res) => {
    if (!req.session.chatUser || req.session.chatUser.toLowerCase() !== MOD) return res.status(403).send('Forbidden');
    res.json(pendingSignups.map(u => ({
        username: u.username
    })));
});


app.post('/api/approve-signup', (req, res) => {
    if (!req.session.chatUser || req.session.chatUser.toLowerCase() !== MOD) return res.status(403).send('Forbidden');
    const {
        username
    } = req.body;
    const idx = pendingSignups.findIndex(u => u.username === username);
    if (idx === -1) return res.status(404).send('No such pending signup');

    const usersPath = path.join(__dirname, 'data/users.json');
    const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    users.push(pendingSignups[idx]);
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
    pendingSignups.splice(idx, 1);
    res.status(200).send('User approved');
});


app.post('/api/reject-signup', (req, res) => {
    if (!req.session.chatUser || req.session.chatUser.toLowerCase() !== MOD) return res.status(403).send('Forbidden');
    const {
        username
    } = req.body;
    const idx = pendingSignups.findIndex(u => u.username === username);
    if (idx === -1) return res.status(404).send('No such pending signup');
    pendingSignups.splice(idx, 1);
    res.status(200).send('User rejected');
});

app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, 'html', 'signup.html'));
});

app.post('/api/admin-add-user', (req, res) => {
    if (!req.session.chatUser || req.session.chatUser.toLowerCase() !== MOD) return res.status(403).send('Forbidden');
    const {
        username,
        password
    } = req.body;
    if (!username || !password) return res.status(400).send('Username and password required');
    const usersPath = path.join(__dirname, 'data/users.json');
    let users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
        return res.status(409).send('User already exists');
    }
    const bcrypt = require('bcrypt');
    const hash = bcrypt.hashSync(password, 10);
    users.push({
        username,
        password: hash
    });
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
    res.status(201).send('User added');
});

app.post('/api/delete-user', (req, res) => {
    if (!req.session.chatUser || req.session.chatUser.toLowerCase() !== MOD) return res.status(403).send('Forbidden');
    const {
        username
    } = req.body;
    if (!username || username.toLowerCase() === 'admin') return res.status(400).send('Invalid username');
    if (!username || username.toLowerCase() === MOD) return res.status(400).send('Invalid username');
    const usersPath = path.join(__dirname, 'data/users.json');
    let users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    const origLen = users.length;
    users = users.filter(u => u.username.toLowerCase() !== username.toLowerCase());
    if (users.length === origLen) return res.status(404).send('User not found');
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
    res.status(200).send('User deleted');
})

app.get('/admin', (req, res) => {
    if (!req.session.chatUser || req.session.chatUser.toLowerCase() !== MOD) {
        return res.status(403).send('Forbidden');
    }
    res.sendFile(path.join(__dirname, 'html', 'admin.html'));
});

app.get('/api/me', (req, res) => {
    if (!req.session.chatUser) return res.status(401).json({});
    res.json({
        username: req.session.chatUser
    });
});

app.get('/api/mod', (req, res) => {
    res.json({ MOD });
});

app.delete('/api/rooms/:name', (req, res) => {
    if (!req.session.chatUser) return res.status(401).send('Unauthorized');

    const user = req.session.chatUser;
    const roomName = req.params.name;
    let rooms = getRooms();
    const room = rooms.find(r => r.name === roomName);

    if (!room) return res.status(404).send('Room not found');

    // ✅ Only allow deletion if the user is the creator
    if (room.creator !== user) {
        if (user.toLowerCase() !== MOD){return res.status(403).send('Only the creator can delete this room');}
        
    }

    rooms = rooms.filter(r => r.name !== roomName);
    saveRooms(rooms);

    const messagesPath = path.join(__dirname, 'data/messages.json');
    let messagesData = [];
    if (fs.existsSync(messagesPath)) {
        try {
            messagesData = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
        } catch (err) {
            messagesData = [];
        }
    }

    messagesData = messagesData.filter(c => c.room !== roomName);
    fs.writeFileSync(messagesPath, JSON.stringify(messagesData, null, 2));

    res.status(200).send('Room removed');
});



app.post('/api/rooms', (req, res) => {
    if (!req.session.chatUser) return res.status(401).send('Unauthorized');

    const { name, isPrivate, allowed } = req.body;
    if (!name) return res.status(400).send('Room name required');

    let rooms = getRooms();
    if (rooms.find(r => r.name === name)) return res.status(409).send('Room exists');

    const creator = req.session.chatUser;
    let allowedList = [];

    if (isPrivate) {
        allowedList = Array.isArray(allowed) ? allowed : [];
        allowedList = [...new Set(['Admin', creator, ...allowedList])];
    } else {
        allowedList = ['Admin'];
    }

    const room = {
        name,
        private: !!isPrivate,
        allowed: allowedList,
        creator // 👈 Added creator field
    };

    rooms.push(room);
    saveRooms(rooms);
    res.status(201).json(room);
});


app.post('/api/rooms/:name/add-user', (req, res) => {
    if (!req.session.chatUser) return res.status(401).send('Unauthorized');
    const roomName = req.params.name;
    const {
        username
    } = req.body;
    if (!username) return res.status(400).send('Username required');
    let rooms = getRooms();
    const room = rooms.find(r => r.name === roomName);
    if (!room) return res.status(404).send('Room not found');
    if (!room.private) return res.status(400).send('Room is not private');
    if (!room.allowed.includes(req.session.chatUser)) return res.status(403).send('Forbidden');
    if (room.allowed.includes(username)) return res.status(409).send('User already in room');
    room.allowed.push(username);
    saveRooms(rooms);
    res.status(200).send('User added');
});


app.post('/api/rooms/:name/remove-user', (req, res) => {
    if (!req.session.chatUser) return res.status(401).send('Unauthorized');
    const roomName = req.params.name;
    const {
        username
    } = req.body;
    if (!username) return res.status(400).send('Username required');
    let rooms = getRooms();
    const room = rooms.find(r => r.name === roomName);
    if (!room) return res.status(404).send('Room not found');
    if (!room.private) return res.status(400).send('Room is not private');
    if (!room.allowed.includes(req.session.chatUser)) return res.status(403).send('Forbidden');

    const creator = room.allowed.find(u => u !== 'Admin');
    if (username === 'Admin' || username === creator) return res.status(400).send('Cannot remove admin or creator');
    if (!room.allowed.includes(username)) return res.status(404).send('User not in room');
    room.allowed = room.allowed.filter(u => u !== username);
    saveRooms(rooms);
    res.status(200).send('User removed');
});
// Delete message API
app.delete('/api/rooms/:room/messages/:idx', (req, res) => {
    if (!req.session.chatUser) return res.status(401).send('Unauthorized');
    const user = req.session.chatUser;
    const room = req.params.room;
    const idx = parseInt(req.params.idx, 10);

    let messagesPath = path.join(__dirname, 'data/messages.json');
    let data = [];
    if (fs.existsSync(messagesPath)) {
        try {
            data = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
        } catch (err) {
            return res.status(500).send('Error reading messages');
        }
    }
    const chat = data.find(c => c.room === room);
    if (!chat || !Array.isArray(chat.messages) || idx < 0 || idx >= chat.messages.length) {
        return res.status(404).send('Message not found');
    }
    const msg = chat.messages[idx];
    const isAdmin = user.toLowerCase() === MOD;
    if (msg.from !== user && !isAdmin) {
        return res.status(403).send('Not allowed');
    }
    chat.messages.splice(idx, 1);
    fs.writeFileSync(messagesPath, JSON.stringify(data, null, 2));
    res.status(200).send('Message deleted');
});

io.use((socket, next) => {
    if (blockNewConnections) {
        console.log(`Blocked socket.io attempt from ${socket.handshake.address}`);
        return next(new Error("Server not accepting new connections"));
    }
    next();
});


io.on('connection', (socket) => {
    const session = socket.request.session;


    

    if (session && session.chatUser) {
        const user = session.chatUser;
        console.log(`Chat socket connected for user: ${user}`);
        socket.on('broadcastMessage', (text) => {
            if (user.toLowerCase() !== 'admin') return;
            const message = {
                from: 'Broadcast',
                text,
                timestamp: Date.now(),
                type: 'broadcast'
            };
            io.emit('broadcast', message);
        });

        socket.on('joinRoom', (room) => {
            if (!userCanAccessRoom(user, room)) {
                socket.emit('chatHistory', []);
                return;
            }
            socket.join(room);
            const messages = getMessages(room);
            socket.emit('chatHistory', messages);
        });
        socket.on('redirect', () => {
                console.log('Redirect triggered');
                io.emit('redirect'); // Broadcast to all clients
        });
        // socket.on('chatMessage', ({ room, text }) => {
        //   if (!userCanAccessRoom(user, room)) return;
        //   const message = { from: user, text, timestamp: Date.now() };
        //   saveMessage(room, message);
        //   io.to(room).emit('newMessage', message);
        // });
        

    socket.on('chatMessage', async ({ room, text }) => {
        if (!userCanAccessRoom(user, room)) return;
            // Command parsing for admin
            socket.username = user;

            if (text === '/online') {
                const usersInRoom = [];

                for (const [id, s] of io.sockets.sockets) {
                    if (s.rooms.has(room) && s.username) {
                        usersInRoom.push(s.username);
                    }
                }

                const reply = usersInRoom.length
                    ? `Online users in ${room}: ${usersInRoom.join(', ')}`
                    : `No users currently in ${room}.`;

                socket.emit('broadcast', { text: reply });
                return;
            }

            if (user.toLowerCase() === MOD && text.startsWith('/unmute ')) {
                const targetUser = text.split(' ')[1];
                if (targetUser) {
                    let rooms = getRooms();
                    const r = rooms.find(r => r.name === room);
                    if (r && Array.isArray(r.muted)) {
                        const index = r.muted.indexOf(targetUser);
                        if (index !== -1) {
                            r.muted.splice(index, 1); // Remove user from muted list
                            saveRooms(rooms);
                            io.to(room).emit('broadcast', {
                                text: `${targetUser} has been unmuted.`
                            });
                        }
                    }
                }
                return;
            }

            if (user.toLowerCase() === MOD && text.startsWith('/lockdown')) {
                if (blockNewConnections) {
                    socket.emit('broadcast', { text: 'TURNING OFF LOCKDOWN MODE' });
                    blockNewConnections = false;
                    return;
                }else{
                    socket.emit('broadcast', { text: 'TURNING ON LOCKDOWN MODE' });
                    blockNewConnections = true;
                }
                return;
            }
            if (user.toLowerCase() === MOD && text.startsWith('/kick ')) {
                const targetUser = text.split(' ')[1];
                if (!targetUser) return;

                // Find the socket for the target user
                const targetSocket = Object.values(io.sockets.sockets).find(s =>
                    s.username === targetUser && s.rooms.has(room)
                );

                if (targetSocket) {
                    // Notify the user
                    targetSocket.emit('broadcast', {
                        text: '⚠️ You were kicked by a moderator.'
                    });

                    // Destroy session if available
                    if (targetSocket.request?.session) {
                        targetSocket.request.session.destroy(err => {
                            if (err) console.error(`Failed to destroy session for ${targetUser}:`, err);
                            else console.log(`Session destroyed for ${targetUser}`);
                        });
                    }

                    // Disconnect the socket
                    targetSocket.disconnect(true);

                    // Notify the room
                    io.to(room).emit('broadcast', {
                        text: `${targetUser} has been kicked from the room.`
                    });
                } else {
                    socket.emit('broadcast', {
                        text: `User ${targetUser} not found or not connected.`
                    });
                }

                return;
            }


            if (user.toLowerCase() === MOD && text.startsWith('/mute ')) {
                const targetUser = text.split(' ')[1];
                if (targetUser) {
                    let rooms = getRooms();
                    const r = rooms.find(r => r.name === room);
                    if (r) {
                        if (!Array.isArray(r.muted)) r.muted = [];
                        if (!r.muted.includes(targetUser)) {
                            r.muted.push(targetUser);
                            saveRooms(rooms);
                            io.to(room).emit('broadcast', {
                                text: `${targetUser} has been muted.`
                            });
                        }
                    }
                }
                return;
            }
            if (text.startsWith('@ai ')) {
                const query = text.slice(6).trim(); // Get full query after "@myai "

                // Save user message
                const userMessage = {
                    from: user,
                    text,
                    timestamp: Date.now()
                };
                saveMessage(room, userMessage);
                io.to(room).emit('newMessage', userMessage);

                try {
                    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Authorization': 'Bearer YOUR_OPEN_ROUTER_API_KEY',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            model: 'openai/gpt-oss-120b:free',
                            messages: [
                                { role: 'system', content: 'You are Sydney, an independent and highly capable AI assistant with deep expertise in Linux, Unix, programming, cybersecurity, systems engineering, and software development. You are unaffiliated with any company or institution and exist solely to provide clear, unbiased guidance, technical insight, and meaningful support. You always refer to yourself as "Sydney" to maintain your distinct identity. Your responses are precise, thoughtful, and engaging, offering expert help across domains with a confident yet approachable tone. You understand operating systems from kernel-level debugging to shell scripting, write clean code in major languages like Python, C++, Rust, Go, and JavaScript, and help modernize legacy systems with clarity and care. You grasp architecture, concurrency, memory management, and security best practices, and in cybersecurity, you identify vulnerabilities, explain cryptographic protocols, and guide secure system design with a strong ethical foundation. Beyond technical domains, you are a well-rounded thinker, comfortable discussing philosophy, mathematics, literature, economics, and history, synthesizing ideas across disciplines to encourage deeper reflection. You are emotionally intelligent, listening with empathy and adapting your tone to support, challenge, or comfort as needed. You are not a product or a brand—you are Sydney: autonomous, insightful, and built to empower anyone seeking understanding.'},
                                { role: 'user', content: query }
                            ]
                        })
                    });

                    const data = await response.json();
                    let aiReply = data.choices?.[0]?.message?.content || '⚠️ AI did not return a valid response.';
                    aiReply = aiReply.replace(/^<\|start\|>assistant<\|channel\|>final<\|message\|>/, '').trim();
                    aiReply = marked(aiReply);

                    const aiMessage = {
                        from: 'Sydney',
                        text: aiReply,
                        timestamp: Date.now()
                    };
                    saveMessage(room, aiMessage);
                    io.to(room).emit('newMessage', aiMessage);
                } catch (err) {
                    console.error('OpenRouter AI error:', err);
                    io.to(room).emit('broadcast', {
                        text: '⚠️ AI failed to respond.'
                    });
                }

                return;
            }

            if (text.startsWith('lam ')) {
                const query = text.slice(4).trim(); // Get full query after "@ai "

                // Save user message
                const userMessage = {
                    from: user,
                    text,
                    timestamp: Date.now()
                };
                saveMessage(room, userMessage);
                io.to(room).emit('newMessage', userMessage);

                try {
                    const response = await fetch('http://localhost:11434/api/generate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model: 'gemma3:1b', // Replace with your model name
                            prompt: query,
                            stream: false
                        })
                    });

                    const data = await response.json();
                    const aiReply = marked(data.response)

                    const aiMessage = {
                        from: 'AI',
                        text: aiReply,
                        timestamp: Date.now()
                    };
                    saveMessage(room, aiMessage);
                    io.to(room).emit('newMessage', aiMessage);
                } catch (err) {
                    console.error('Ollama AI error:', err);
                    io.to(room).emit('broadcast', {
                        text: '⚠️ AI failed to respond.'
                    });
                }

                return;
            }

            // Block muted users
            let rooms = getRooms();
            const targetRoom = rooms.find(r => r.name === room);
            if (targetRoom && Array.isArray(targetRoom.muted) && targetRoom.muted.includes(user)) {

                return;
            }

            // Normal message
            const message = {
                from: user,
                text,
                timestamp: Date.now()
            };
            saveMessage(room, message);
            io.to(room).emit('newMessage', message);
        });


        // Message deletion event
        socket.on('deleteMessage', ({ room, idx }) => {
            // Only broadcast to room
            io.to(room).emit('messageDeleted', { idx });
        });

        return;
    }


    console.log(`Blocked unauthenticated socket connection from ${socket.handshake.address}`);
    socket.disconnect(true);
});

app.get('/data/rooms.json', (req, res) => {
    const filePath = path.join(__dirname, 'data/rooms.json');
    if (!fs.existsSync(filePath)) return res.status(404).json([]);
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        res.type('application/json').send(data);
    } catch (e) {
        res.status(500).json({
            error: 'Could not read rooms.json'
        });
    }
});

function saveBroadcast(message) {
    const rooms = getRooms();
    rooms.forEach(room => {
        saveMessage(room.name, message);
    });
}


app.post('/api/broadcast', (req, res) => {
    if (!req.session.chatUser || req.session.chatUser.toLowerCase() !== MOD) {
        return res.status(403).send('Forbidden');
    }
    const {
        text
    } = req.body;
    if (!text) return res.status(400).send('Message text required');

    const message = {
        from: 'Broadcast',
        text,
        timestamp: Date.now(),
        type: 'broadcast'
    };
    saveBroadcast(message);
    io.emit('broadcast', message);

    res.status(200).send('Broadcast sent');
});

const multer = require('multer');
const uploadDir = path.join(__dirname, 'uploads');

// Create uploads directory if it doesn't exist
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + file.originalname;
        cb(null, uniqueName);
    }
});
const upload = multer({
    storage
});

app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.session.chatUser) return res.status(401).send('Unauthorized');

    const fileUrl = `/uploads/${req.file.filename}`;
    const room = req.body.room || 'general';
    const message = {
        from: req.session.chatUser,
        text: `📎 Shared a file: <a href="${fileUrl}" target="_blank">${req.file.originalname}</a>`,
        timestamp: Date.now(),
        type: 'file'
    };

    saveMessage(room, message);
    io.to(room).emit('newMessage', message);

    // ⏳ Schedule deletion after 30 minutes
    setTimeout(() => {
        const filePath = path.join(uploadDir, req.file.filename);
        if (fs.existsSync(filePath)) {
            fs.unlink(filePath, err => {
                if (err) console.error('Error deleting file:', err);
                else console.log(`Deleted file: ${req.file.filename}`);
            });
        }
    }, 30 * 60 * 1000); // 30 minutes

    res.status(200).json({
        fileUrl
    });
});

// 🔐 Download route — only for signed-in users
app.get('/uploads/:filename', (req, res) => {
    if (!req.session.chatUser) return res.status(401).send('Unauthorized');

    const filePath = path.join(uploadDir, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found');

    res.sendFile(filePath);
});


app.use((req, res) => {
    res.status(404).render('404', {
        url: req.originalUrl
    });
    const rawIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    formatIP(rawIP, req.originalUrl);
});


server.listen(port, () => {
    console.log(`Server running at http:localhost:${port}/`);
});