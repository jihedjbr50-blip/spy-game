const socket = io();
let myId = "";
let allPlayers = [];
let chosenRoom = "";
let globalRoomsData = {}; // لحفظ بيانات الغرف كلها للمعاينة الشاشات الخارجية

// التحديث الأول لحالة الغرف كلها عند فتح المتصفح
socket.on('init_rooms_status', (rooms) => {
    for (let r in rooms) {
        globalRoomsData[r] = rooms[r].players.map(p => p.name);
    }
    previewRoomPlayers();
});

// استقبال التحديثات الفورية للغرف من السيرفر
socket.on('rooms_status_update', (roomsStatus) => {
    globalRoomsData = roomsStatus;
    previewRoomPlayers();
});

// عرض أسماء اللاعبين المتواجدين في الغرفة المحددة بالـ Select قبل الدخول
function previewRoomPlayers() {
    const selected = document.getElementById('room-select').value;
    const previewSpan = document.getElementById('preview-players-names');
    
    if (globalRoomsData[selected] && globalRoomsData[selected].length > 0) {
        previewSpan.innerText = globalRoomsData[selected].join(' ، ');
    } else {
        previewSpan.innerText = "فارغة (لا يوجد أحد)";
    }
}

function joinGame() {
    const name = document.getElementById('username-input').value;
    chosenRoom = document.getElementById('room-select').value;
    
    if (name.trim() !== "") {
        myId = socket.id;
        document.getElementById('lobby-title').innerText = `🏢 ${chosenRoom}`;
        socket.emit('join_room', { username: name.trim(), roomName: chosenRoom });
        switchScreen('lobby-screen');
    }
}

function leaveRoom() {
    socket.emit('leave_room');
}

socket.on('leave_success', () => {
    switchScreen('login-screen');
});

function startMatch() {
    socket.emit('start_match');
}

socket.on('update_players', (players) => {
    allPlayers = players;
    const list = document.getElementById('players-list');
    list.innerHTML = "";
    
    players.forEach(p => {
        let li = document.createElement('li');
        li.id = `player-${p.id}`;
        
        let statusText = p.alive ? '🟢 حي' : '💀 ميت';
        if (p.voted && p.alive) statusText += " | 🗳️ صوّت";

        // إظهار كم صوت كيك حصل عليه اللاعب حالياً
        let currentKickVotes = p.kickVotes ? p.kickVotes.length : 0;
        let kickStatus = currentKickVotes > 0 ? ` [⚠️ طرد: ${currentKickVotes}/3]` : '';

        // زر طلب كيك
        let kickBtn = p.id !== socket.id ? `<button style="background:#d9534f; padding:3px 8px; font-size:11px; margin-right:10px;" onclick="voteKickPlayer('${p.id}')">طرد ❌</button>` : '';

        li.innerHTML = `<span>👤 ${p.name} (${statusText})${kickStatus}</span> ${kickBtn}`;
        list.appendChild(li);
    });
});

function voteKickPlayer(id) {
    socket.emit('kick_player_vote', id);
}

socket.on('kick_vote_progress', (data) => {
    console.log(`تم التصويت لطرد ${data.targetName}، مجموع الأصوات الحالية: ${data.votesCount}/3`);
});

socket.on('you_are_kicked', () => {
    alert("🚨 تم طردك رسمياً من الغرفة بناءً على تصويت 3 لاعبين!");
    location.reload();
});

socket.on('player_voted_status', (data) => {
    let playerElement = document.getElementById(`player-${data.playerId}`);
    if (playerElement) {
        playerElement.style.border = "2px solid #ffde7d"; 
    }
});

socket.on('receive_role', (data) => {
    switchScreen('game-screen');
    document.getElementById('secret-word').innerText = data.word;
    const badge = document.getElementById('role-badge');
    if(data.role === 'spy') {
        badge.innerText = "🚨 أنت الجاسوس! تندمج ولا تكشف نفسك.";
        badge.style.color = "red";
    } else {
        badge.innerText = "👨‍✈️ أنت مواطن بريء! ابحث عن المخادع.";
        badge.style.color = "lightgreen";
    }
});

socket.on('game_state_changed', (data) => {
    if (data.state === 'DESCRIBE_STAGE') {
        document.getElementById('descriptions-board').innerHTML = "";
        let me = data.players.find(p => p.id === socket.id);
        if(me && me.alive) {
            document.getElementById('describe-section').classList.remove('hidden');
        }
    } 
    else if (data.state === 'DISCUSSION_STAGE') {
        document.getElementById('describe-section').classList.add('hidden');
        startDiscussionTimer();
    }
});

function submitDescription() {
    const desc = document.getElementById('desc-input').value;
    if(desc.trim() !== "") {
        socket.emit('submit_description', desc.trim());
        document.getElementById('describe-section').classList.add('hidden');
        document.getElementById('desc-input').value = "";
    }
}

socket.on('update_descriptions', (data) => {
    const board = document.getElementById('descriptions-board');
    let li = document.createElement('li');
    li.innerHTML = `<strong>${data.name}:</strong> <span>"${data.desc}"</span>`;
    board.appendChild(li);
});

function startDiscussionTimer() {
    document.getElementById('timer-section').classList.remove('hidden');
    let count = 60;
    const cd = document.getElementById('countdown');
    cd.innerText = count;

    let timer = setInterval(() => {
        count--;
        cd.innerText = count;
        if(count <= 0) {
            clearInterval(timer);
            document.getElementById('timer-section').classList.add('hidden');
            showVotingPanel();
        }
    }, 1000);
}

function showVotingPanel() {
    let me = allPlayers.find(p => p.id === socket.id);
    if (me && !me.alive) return; 

    const panel = document.getElementById('voting-section');
    const container = document.getElementById('voting-buttons');
    container.innerHTML = "";
    panel.classList.remove('hidden');

    allPlayers.forEach(p => {
        if (p.id !== socket.id && p.alive) {
            let btn = document.createElement('button');
            btn.className = "vote-btn";
            btn.innerText = p.name;
            btn.onclick = () => {
                socket.emit('submit_vote', p.id);
                panel.classList.add('hidden');
            };
            container.appendChild(btn);
        }
    });
}

socket.on('round_result', (data) => {
    switchScreen('result-screen');
    document.getElementById('result-log').innerText = data.message;
    
    if (data.gameResult === 'CITIZENS_WIN') {
        document.getElementById('result-title').innerText = "🏆 فاز المواطنون!";
    } else if (data.gameResult === 'SPIES_WIN') {
        document.getElementById('result-title').innerText = "🎭 فاز الجواسيس!";
    } else {
        document.getElementById('result-title').innerText = "🔄 جولة انتهت واللعبة مستمرة...";
    }

    document.getElementById('reveal-citizen').innerText = data.correctWords.citizens;
    document.getElementById('reveal-spy').innerText = data.correctWords.spies;
    allPlayers = data.players;
});

function backToLobby() {
    switchScreen('lobby-screen');
}

function switchScreen(screenId) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.add('hidden');
    document.getElementById('result-screen').classList.add('hidden');
    document.getElementById(screenId).classList.remove('hidden');
}

socket.on('error_message', (msg) => alert(msg));