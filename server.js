const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

// هيكل البيانات لدعم الغرف
let rooms = {
    "الغرفة 1": { players: [], gameStarted: false, descriptions: {}, votes: {}, currentWords: {} },
    "الغرفة 2": { players: [], gameStarted: false, descriptions: {}, votes: {}, currentWords: {} },
    "الغرفة 3": { players: [], gameStarted: false, descriptions: {}, votes: {}, currentWords: {} },
    "الغرفة 4": { players: [], gameStarted: false, descriptions: {}, votes: {}, currentWords: {} },
    "الغرفة 5": { players: [], gameStarted: false, descriptions: {}, votes: {}, currentWords: {} }
};

// بنك تصنيفات ضخم لتوليد الكلمات عشوائياً في لحظة بدء الجيم
const categoryBank = {
    "فواكه": ["تفاحة", "كمثرى", "موز", "برتقال", "مانجو", "خوخ", "مشمش", "فراولة"],
    "وسائل نقل": ["طائرة", "قطار", "سيارة", "حافلة", "دراجة نارية", "سفينة", "مروحية"],
    "مشروبات": ["قهوة", "شاي", "عصير ليمون", "حليب", "مياه غازية", "شوكولاتة ساخنة"],
    "حيوانات مفترسة": ["أسد", "نمر", "فهد", "ذئب", "ضبع", "نمر مرقط"],
    "أجهزة إلكترونية": ["هاتف ذكي", "حاسوب محمول", "جهاز لوحي", "تلفاز ذكي", "ساعة ذكية"],
    "أدوات مكتبية": ["قلم حبر", "قلم رصاص", "دفتر ملاحظات", "ممحاة", "مسطرة", "مقص"],
    "خضروات": ["بطاطس", "طماطم", "جزر", "خيار", "بصل", "ثوم", "باذنجان"]
};

// دالة لتوليد كلمتين متقاربتين تلقائياً في لحظة بدء اللعبة
function generateDynamicWords() {
    // 1. اختيار تصنيف عشوائي
    const categories = Object.keys(categoryBank);
    const randomCategory = categories[Math.floor(Math.random() * categories.length)];
    const wordList = categoryBank[randomCategory];

    // 2. خلط كلمات التصنيف واختيار كلمتين عشوائيتين منه لضمان التقارب
    const shuffledWords = [...wordList].sort(() => 0.5 - Math.random());
    
    return {
        citizens: shuffledWords[0],
        spies: shuffledWords[1]
    };
}

function broadcastRoomStatus() {
    let status = {};
    for (let r in rooms) {
        status[r] = rooms[r].players.map(p => p.name);
    }
    io.emit('rooms_status_update', status);
}

io.on('connection', (socket) => {
    let currentRoomName = null;

    socket.emit('init_rooms_status', rooms);
    broadcastRoomStatus();

    // 1. دخول لاعب لغرفة
    socket.on('join_room', ({ username, roomName }) => {
        if (!rooms[roomName]) return;
        
        const room = rooms[roomName];
        if (room.gameStarted) {
            socket.emit('error_message', 'اللعبة بدأت في هذه الغرفة بالفعل!');
            return;
        }

        currentRoomName = roomName;
        socket.join(roomName);

        room.players.push({ id: socket.id, name: username, role: 'citizen', word: '', alive: true, voted: false, kickVotes: [] });
        
        io.to(roomName).emit('update_players', room.players);
        broadcastRoomStatus();
    });

    // 2. مغادرة الغرفة
    socket.on('leave_room', () => {
        if (currentRoomName && rooms[currentRoomName]) {
            const room = rooms[currentRoomName];
            room.players = room.players.filter(p => p.id !== socket.id);
            
            socket.leave(currentRoomName);
            io.to(currentRoomName).emit('update_players', room.players);
            
            currentRoomName = null;
            broadcastRoomStatus();
            socket.emit('leave_success');
        }
    });

    // 3. نظام التصويت على الكيك (3 أصوات)
    socket.on('kick_player_vote', (playerIdToKick) => {
        const room = rooms[currentRoomName];
        if (!room) return;

        const targetPlayer = room.players.find(p => p.id === playerIdToKick);
        if (targetPlayer) {
            if (!targetPlayer.kickVotes.includes(socket.id)) {
                targetPlayer.kickVotes.push(socket.id);
                let currentVotesCount = targetPlayer.kickVotes.length;
                
                io.to(currentRoomName).emit('kick_vote_progress', { targetName: targetPlayer.name, votesCount: currentVotesCount });

                if (currentVotesCount >= 3) {
                    room.players = room.players.filter(p => p.id !== playerIdToKick);
                    io.to(playerIdToKick).emit('you_are_kicked');
                    io.to(currentRoomName).emit('update_players', room.players);

                    if (room.gameStarted) {
                        delete room.descriptions[playerIdToKick];
                        delete room.votes[playerIdToKick];
                        checkGameRulesAfterKick(currentRoomName);
                    }
                    broadcastRoomStatus();
                }
            } else {
                socket.emit('error_message', 'لقد قمت بالتصويت لطرد هذا اللاعب مسبقاً!');
            }
        }
    });

    // 4. بدء اللعبة بالتعديلات الجديدة (الحد الأدنى 4، والكلمات تُنشأ الآن فجأة)
    socket.on('start_match', () => {
        const room = rooms[currentRoomName];
        if (!room || room.players.length < 4) { // تحديث شرط الحد الأدنى إلى 4 لاعبين
            socket.emit('error_message', 'لا يمكن البدء، الحد الأدنى الحالي هو 4 لاعبين!');
            return;
        }

        room.gameStarted = true;
        room.descriptions = {};
        room.votes = {};
        room.players.forEach(p => { p.alive = true; p.voted = false; p.kickVotes = []; });

        // تعديل شروط توزيع الجواسيس بناءً على طلبك الجديد:
        let numSpies = 1;
        if (room.players.length >= 4 && room.players.length <= 7) numSpies = 1;
        else if (room.players.length >= 8 && room.players.length <= 12) numSpies = 2;
        else if (room.players.length >= 13) numSpies = 3;

        let shuffled = [...room.players].sort(() => 0.5 - Math.random());
        let spyIds = shuffled.slice(0, numSpies).map(p => p.id);

        // هنا السحر! إنشاء الكلمتين في نفس هذه اللحظة عشوائياً وديناميكياً
        room.currentWords = generateDynamicWords();

        room.players.forEach(player => {
            if (spyIds.includes(player.id)) {
                player.role = 'spy';
                player.word = room.currentWords.spies;
            } else {
                player.role = 'citizen';
                player.word = room.currentWords.citizens;
            }
            io.to(player.id).emit('receive_role', { word: player.word, role: player.role });
        });

        io.to(currentRoomName).emit('game_state_changed', { state: 'DESCRIBE_STAGE', players: room.players });
    });

    // 5. استقبال الأوصاف
    socket.on('submit_description', (descText) => {
        const room = rooms[currentRoomName];
        if (!room) return;

        let player = room.players.find(p => p.id === socket.id);
        if (player && player.alive) {
            room.descriptions[socket.id] = descText;
            io.to(currentRoomName).emit('update_descriptions', { name: player.name, desc: descText });

            let alivePlayers = room.players.filter(p => p.alive);
            if (Object.keys(room.descriptions).length === alivePlayers.length) {
                io.to(currentRoomName).emit('game_state_changed', { state: 'DISCUSSION_STAGE' });
            }
        }
    });

    // 6. استقبال التصويت
    socket.on('submit_vote', (targetId) => {
        const room = rooms[currentRoomName];
        if (!room) return;

        let voter = room.players.find(p => p.id === socket.id);
        if (voter && voter.alive && !voter.voted) {
            voter.voted = true;
            room.votes[socket.id] = targetId;
            io.to(currentRoomName).emit('player_voted_status', { playerId: socket.id });

            let alivePlayers = room.players.filter(p => p.alive);
            if (Object.keys(room.votes).length === alivePlayers.length) {
                calculateVoteResult(currentRoomName);
            }
        }
    });

    socket.on('disconnect', () => {
        if (currentRoomName && rooms[currentRoomName]) {
            const room = rooms[currentRoomName];
            room.players = room.players.filter(p => p.id !== socket.id);
            io.to(currentRoomName).emit('update_players', room.players);
            if (room.players.length === 0) room.gameStarted = false;
            broadcastRoomStatus();
        }
    });
});

function checkGameRulesAfterKick(roomName) {
    const room = rooms[roomName];
    let aliveSpies = room.players.filter(p => p.role === 'spy' && p.alive).length;
    let aliveCitizens = room.players.filter(p => p.role === 'citizen' && p.alive).length;

    if (aliveSpies === 0) {
        io.to(roomName).emit('round_result', { message: "تم طرد الجاسوس الأخير خارج اللعبة!", gameResult: "CITIZENS_WIN", players: room.players, correctWords: room.currentWords });
        room.gameStarted = false;
    } else if (aliveCitizens <= aliveSpies && aliveCitizens > 0) {
        io.to(roomName).emit('round_result', { message: "انخفض عدد المواطنين بسبب الطرد!", gameResult: "SPIES_WIN", players: room.players, correctWords: room.currentWords });
        room.gameStarted = false;
    }
}

function calculateVoteResult(roomName) {
    const room = rooms[roomName];
    let voteCounts = {};
    Object.values(room.votes).forEach(id => voteCounts[id] = (voteCounts[id] || 0) + 1);

    let eliminatedId = Object.keys(voteCounts).reduce((a, b) => voteCounts[a] > voteCounts[b] ? a : b);
    let eliminatedPlayer = room.players.find(p => p.id === eliminatedId);
    eliminatedPlayer.alive = false;

    let msg = `تم طرد [ ${eliminatedPlayer.name} ] بـ ${voteCounts[eliminatedId]} أصوات. ` + (eliminatedPlayer.role === 'spy' ? "🔥 وكان جاسوساً!" : "😢 وكان مواطناً.");

    let aliveSpies = room.players.filter(p => p.role === 'spy' && p.alive).length;
    let aliveCitizens = room.players.filter(p => p.role === 'citizen' && p.alive).length;

    let gameResult = "CONTINUE";
    if (aliveSpies === 0) { gameResult = "CITIZENS_WIN"; room.gameStarted = false; }
    else if (aliveCitizens <= aliveSpies) { gameResult = "SPIES_WIN"; room.gameStarted = false; }

    io.to(roomName).emit('round_result', { message: msg, gameResult: gameResult, players: room.players, correctWords: room.currentWords });
    room.votes = {}; room.descriptions = {};
}

// يقرأ المنفذ الخاص بالاستضافة، وإذا لم يجده يعمل على 3000 محلياً
const PORT = process.env.PORT || 3000; 
http.listen(PORT, () => console.log(`السيرفر يعمل على منفذ ${PORT}`));