// THEFTFIND - Core Logic & Multiplayer

// --- DATABASE SERVICE ABSTRACTION ---
// --- DATABASE SERVICE ABSTRACTION ---
const API_URL = 'http://localhost:5000/api';

const DatabaseService = {
    // Fetch player profile from MongoDB
    getPlayerStats: async (playerName) => {
        try {
            const res = await fetch(`${API_URL}/stats/${playerName}`);
            return await res.json();
        } catch (e) {
            console.error("DB Error: Could not fetch stats", e);
            return null;
        }
    },
    
    // Save game stats to MongoDB
    saveMatchResult: async (matchData) => {
        try {
            await fetch(`${API_URL}/match/result`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(matchData)
            });
            console.log("DB: Match result saved to MongoDB");
        } catch (e) {
            console.error("DB Error: Could not save match result", e);
        }
    }
};

const screens = document.querySelectorAll('.screen');
let myName = '';
let myRole = '';
let isHost = false;
let isLocalGame = false;
let peer = null;
let roomCode = '';
let connections = []; // For host
let hostConnection = null; // For client

// Game State (Host only)
let gameState = {
    players: [], // { id, name, role, isAlive, connection }
    phase: 'LOBBY',
    votes: {}, // peerId -> votedPeerId
    readyCount: 0
};

// Local Game State
let localCurrentPlayerIndex = 0;
let usedCluesCache = [];

// Roles config
const ROLES = ['THEFT', 'POLICE', 'DETECTIVE', 'INVESTIGATOR'];

// Word Categories
const WORD_CATEGORIES = {
    "FOOD": [
        ["APPLE", "ORANGE"], ["BURGER", "PIZZA"], ["COFFEE", "TEA"], ["CAKE", "PIE"],
        ["SUSHI", "RAMEN"], ["PANCAKE", "WAFFLE"], ["CHICKEN", "TURKEY"], ["SOUP", "STEW"],
        ["BUTTER", "CHEESE"], ["FRIES", "CHIPS"], ["TACO", "BURRITO"], ["ICE CREAM", "GELATO"],
        ["HONEY", "SYRUP"], ["BACON", "SAUSAGE"], ["MILK", "YOGURT"]
    ],
    "SUMMER": [
        ["BEACH", "POOL"], ["SUNGLASSES", "GOGGLES"], ["SANDAL", "SLIPPER"], ["SUN", "MOON"],
        ["TENT", "CABIN"], ["SURFBOARD", "SKATEBOARD"], ["ISLAND", "PENINSULA"], ["SHORTS", "SWIMSUIT"],
        ["TOWEL", "BLANKET"], ["OCEAN", "LAKE"], ["CAMPING", "HIKING"], ["MOSQUITO", "FLY"],
        ["BARBECUE", "PICNIC"], ["WATERMELON", "PINEAPPLE"]
    ],
    "WINTER": [
        ["SNOW", "ICE"], ["JACKET", "SWEATER"], ["GLOVES", "MITTENS"], ["SKI", "SNOWBOARD"],
        ["FIREPLACE", "HEATER"], ["BLIZZARD", "STORM"], ["SCARF", "BEANIE"], ["PENGUIN", "POLAR BEAR"],
        ["SLED", "CARRIAGE"], ["ICE SKATE", "ROLLER BLADE"], ["FROST", "DEW"], ["HOT CHOCOLATE", "COFFEE"]
    ],
    "FESTIVAL": [
        ["FIREWORKS", "SPARKLERS"], ["PARADE", "MARCH"], ["MUSIC", "DANCE"], ["CONCERT", "SHOW"],
        ["COSTUME", "MASK"], ["STAGE", "THEATER"], ["BALLOON", "KITE"], ["PARTY", "CELEBRATION"],
        ["TENT", "CANOPY"], ["SPEAKER", "MICROPHONE"], ["TICKET", "WRISTBAND"], ["CROWD", "AUDIENCE"]
    ]
};

function navTo(screenId) {
    screens.forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

function showLobbySetup() {
    myName = document.getElementById('player-name').value.trim();
    if (!myName) return alert("Enter your name first!");
    isLocalGame = false;
    navTo('screen-setup');
}

function showLocalSetup() {
    isLocalGame = true;
    gameState.players = [];
    document.getElementById('local-player-list').innerHTML = '';
    navTo('screen-local-setup');
}

function addLocalPlayer() {
    let input = document.getElementById('local-player-name');
    let name = input.value.trim();
    if (!name) return alert("Enter a name!");
    if (gameState.players.find(p => p.name === name)) return alert("Name already exists!");
    
    gameState.players.push({ id: 'local_' + gameState.players.length, name: name, isAlive: true, host: false });
    input.value = '';
    
    let ul = document.getElementById('local-player-list');
    ul.innerHTML += `<li>${name}</li>`;
}

// --- LOBBY POPUPS ---
function showCreateRoomPopup(fromLocal = false) {
    if (fromLocal && gameState.players.length < 4) {
        return alert("You need at least 4 players for a local game!");
    }
    document.getElementById('overlay-create').classList.add('active');
    
    let roomInput = document.getElementById('create-room-name');
    let passInput = document.getElementById('create-room-pass');
    
    if (isLocalGame) {
        roomInput.value = "LOCAL GAME";
        roomInput.disabled = true;
        passInput.classList.add('hidden');
        document.getElementById('total-players').value = gameState.players.length;
        document.getElementById('total-players').disabled = true;
    } else {
        roomInput.value = "ROOM-" + Math.random().toString(36).substring(2, 6).toUpperCase();
        roomInput.disabled = false;
        passInput.classList.remove('hidden');
        document.getElementById('total-players').disabled = false;
    }
    updateRoleUI(); // Initialize UI
}
function closeCreateRoomPopup() {
    document.getElementById('overlay-create').classList.remove('active');
}

function updateRoleUI() {
    let total = parseInt(document.getElementById('total-players').value) || 4;
    if (total < 4) {
        total = 4;
        document.getElementById('total-players').value = 4;
    }
    
    let presetDiv = document.getElementById('preset-roles');
    let customDiv = document.getElementById('custom-roles');
    
    if (total === 4) {
        presetDiv.classList.remove('hidden');
        customDiv.classList.add('hidden');
        presetDiv.innerText = "1 🥷 THEFT\n2 👮 POLICE\n1 🕵️ INVESTIGATOR";
    } else if (total === 5) {
        presetDiv.classList.remove('hidden');
        customDiv.classList.add('hidden');
        presetDiv.innerText = "1 🥷 THEFT\n3 👮 POLICE\n1 🕵️ INVESTIGATOR";
    } else if (total === 6) {
        presetDiv.classList.remove('hidden');
        customDiv.classList.add('hidden');
        presetDiv.innerText = "1 🥷 THEFT\n3 👮 POLICE\n1 🔍 DETECTIVE\n1 🕵️ INVESTIGATOR";
    } else {
        presetDiv.classList.add('hidden');
        customDiv.classList.remove('hidden');
    }
}

// --- PEERJS NETWORKING ---

function initPeer(id, onOpen) {
    if (peer) peer.destroy();
    peer = new Peer(id, { debug: 2 });
    peer.on('open', onOpen);
    peer.on('error', err => {
        alert("Network Error: " + err.type + "\n(This room name might already be taken)");
        navTo('screen-setup');
    });
}

function confirmCreateRoom() {
    isHost = true;
    let nameInput = document.getElementById('create-room-name').value.trim().toUpperCase().replace(/\s+/g, '-');
    if (!nameInput && !isLocalGame) return alert("Please enter a Room Name!");
    
    roomCode = nameInput;
    gameState.password = document.getElementById('create-room-pass').value.trim();
    gameState.category = document.getElementById('word-category').value;
    
    let total = parseInt(document.getElementById('total-players').value) || 4;
    
    if (total === 4) {
        gameState.roleConfig = { THEFT: 1, POLICE: 2, DETECTIVE: 0, INVESTIGATOR: 1 };
        gameState.totalMaxPlayers = 4;
    } else if (total === 5) {
        gameState.roleConfig = { THEFT: 1, POLICE: 3, DETECTIVE: 0, INVESTIGATOR: 1 };
        gameState.totalMaxPlayers = 5;
    } else if (total === 6) {
        gameState.roleConfig = { THEFT: 1, POLICE: 3, DETECTIVE: 1, INVESTIGATOR: 1 };
        gameState.totalMaxPlayers = 6;
    } else {
        // Read custom role configuration for 7+ players
        gameState.roleConfig = {
            THEFT: parseInt(document.getElementById('count-theft').value) || 0,
            POLICE: parseInt(document.getElementById('count-police').value) || 0,
            DETECTIVE: parseInt(document.getElementById('count-detective').value) || 0,
            INVESTIGATOR: parseInt(document.getElementById('count-investigator').value) || 0
        };
        gameState.totalMaxPlayers = gameState.roleConfig.THEFT + gameState.roleConfig.POLICE + gameState.roleConfig.DETECTIVE + gameState.roleConfig.INVESTIGATOR;
        if (gameState.totalMaxPlayers < 7 && !isLocalGame) { // allow sum matching for local if they bypass
            return alert("Your custom roles sum to " + gameState.totalMaxPlayers + ". Please adjust them to match your total players, or pick 4-6 players.");
        }
    }
    
    if (isLocalGame) {
        if (gameState.players.length !== gameState.totalMaxPlayers) {
            return alert(`Your custom roles sum to ${gameState.totalMaxPlayers}, but you have ${gameState.players.length} players! Adjust the roles.`);
        }
        closeCreateRoomPopup();
        startGame(); // directly start!
        return;
    }
    
    initPeer('THEFTFIND-' + roomCode, () => {
        document.getElementById('room-code-display').innerText = roomCode;
        document.getElementById('host-controls').classList.remove('hidden');
        document.getElementById('client-waiting').classList.add('hidden');
        
        // Add self to players
        gameState.players.push({ id: peer.id, name: myName, isAlive: true, host: true });
        updateLobbyUI();
        closeCreateRoomPopup();
        navTo('screen-lobby');
    });

    peer.on('connection', (conn) => {
        conn.on('data', data => handleHostData(conn, data));
        conn.on('close', () => {
            gameState.players = gameState.players.filter(p => p.id !== conn.peer);
            updateLobbyUI();
        });
    });
}

function joinRoom() {
    isHost = false;
    roomCode = document.getElementById('join-code').value.trim().toUpperCase().replace(/\s+/g, '-');
    let passInput = document.getElementById('join-password').value.trim();
    if (!roomCode) return alert("Please enter a Room Name!");

    initPeer(null, () => {
        hostConnection = peer.connect('THEFTFIND-' + roomCode);
        hostConnection.on('open', () => {
            hostConnection.send({ type: 'JOIN', name: myName, password: passInput });
        });
        hostConnection.on('data', handleClientData);
        hostConnection.on('close', () => {
            alert("Disconnected from host.");
            navTo('screen-home');
        });
    });
}

// --- HOST LOGIC ---

function handleHostData(conn, data) {
    if (data.type === 'JOIN') {
        if (gameState.phase !== 'LOBBY') {
            conn.send({ type: 'ERROR', msg: 'Game already started' });
            setTimeout(() => conn.close(), 500);
            return;
        }
        if (gameState.password && data.password !== gameState.password) {
            conn.send({ type: 'ERROR', msg: 'Incorrect Password!' });
            setTimeout(() => conn.close(), 500);
            return;
        }
        if (gameState.players.length >= gameState.totalMaxPlayers) {
            conn.send({ type: 'ERROR', msg: 'Room is full! (' + gameState.totalMaxPlayers + ' players max)' });
            setTimeout(() => conn.close(), 500);
            return;
        }

        gameState.players.push({ id: conn.peer, name: data.name, isAlive: true, conn: conn });
        updateLobbyUI();
        broadcastLobby();
        // Tell client they successfully joined
        conn.send({ type: 'JOIN_SUCCESS', room: roomCode, max: gameState.totalMaxPlayers });
    }
    else if (data.type === 'READY_ROLE') {
        gameState.readyCount++;
        if (gameState.readyCount === gameState.players.length) {
            broadcast({ type: 'GOTO_DISCUSSION' });
            startDiscussionHost();
            gameState.readyCount = 0;
        }
    }
    else if (data.type === 'ALLEGIANCE') {
        gameState.investigatorAlliances = gameState.investigatorAlliances || {};
        gameState.investigatorAlliances[conn.peer] = data.side;
    }
    else if (data.type === 'READY_DISCUSSION') {
        gameState.readyCount++;
        if (gameState.readyCount === gameState.players.length) {
            broadcast({ type: 'GOTO_DISCUSSION' });
            startDiscussionHost();
            gameState.readyCount = 0;
        }
    }
    else if (data.type === 'VOTE') {
        gameState.votes[conn.peer] = data.voteId;
        checkVotesComplete();
    }
    else if (data.type === 'SUBMIT_GUESS') {
        processTheftGuess(data.guess);
    }
}

function broadcast(data) {
    gameState.players.forEach(p => {
        if (!p.host && p.conn && p.conn.open) p.conn.send(data);
    });
}

function broadcastLobby() {
    let list = gameState.players.map(p => p.name);
    broadcast({ type: 'LOBBY_UPDATE', players: list, max: gameState.totalMaxPlayers });
}

function updateLobbyUI(list, maxOverride) {
    let pList = isHost ? gameState.players.map(p=>p.name) : list;
    let max = isHost ? gameState.totalMaxPlayers : (maxOverride || pList.length);
    document.getElementById('player-count').innerText = pList.length + '/' + max;
    let ul = document.getElementById('player-list');
    ul.innerHTML = '';
    pList.forEach(name => {
        ul.innerHTML += `<li>${name}</li>`;
    });
}

function startGame() {
    let count = gameState.players.length;
    if (count !== gameState.totalMaxPlayers) {
        return alert(`You need exactly ${gameState.totalMaxPlayers} players to start (currently ${count}).`);
    }

    // Build roles array from custom configuration
    let roles = [];
    for (let i = 0; i < gameState.roleConfig.THEFT; i++) roles.push('THEFT');
    for (let i = 0; i < gameState.roleConfig.POLICE; i++) roles.push('POLICE');
    for (let i = 0; i < gameState.roleConfig.DETECTIVE; i++) roles.push('DETECTIVE');
    for (let i = 0; i < gameState.roleConfig.INVESTIGATOR; i++) roles.push('INVESTIGATOR');
    
    // Shuffle roles randomly
    roles.sort(() => Math.random() - 0.5);
    gameState.players.forEach((p, i) => p.role = roles[i]);

    let category = gameState.category || 'FOOD';
    let catWords = WORD_CATEGORIES[category];
    let pair = catWords[Math.floor(Math.random() * catWords.length)];
    
    let majorityWord = Math.random() > 0.5 ? pair[0] : pair[1];
    let minorityWord = majorityWord === pair[0] ? pair[1] : pair[0];
    
    // Save these to game state so local pass-and-play can use them
    gameState.currentMajorityWord = majorityWord;
    gameState.currentMinorityWord = minorityWord;
    
    gameState.phase = 'ROLE';
    gameState.readyCount = 0;
    
    if (isLocalGame) {
        localCurrentPlayerIndex = 0;
        passDeviceToNext();
    } else {
        gameState.players.forEach(p => {
            let pWord = (p.role === 'THEFT') ? '???' : majorityWord;
            if (p.role === 'INVESTIGATOR') pWord = minorityWord;
            
            let msg = {
                type: 'START',
                role: p.role,
                clue: pWord
            };

            if (p.host) {
                setupRoleScreen(msg);
            } else {
                p.conn.send(msg);
            }
        });
    }
}

function passDeviceToNext() {
    if (localCurrentPlayerIndex >= gameState.players.length) {
        // Everyone saw their roles, go straight to discussion!
        startDiscussionHost();
        return;
    }
    
    let p = gameState.players[localCurrentPlayerIndex];
    document.getElementById('pass-device-name').innerText = p.name;
    navTo('screen-pass-device');
}

function confirmDevicePassed() {
    let p = gameState.players[localCurrentPlayerIndex];
    let pWord = (p.role === 'THEFT') ? '???' : gameState.currentMajorityWord;
    if (p.role === 'INVESTIGATOR') pWord = gameState.currentMinorityWord;
    
    let msg = {
        role: p.role,
        clue: pWord
    };
    setupRoleScreen(msg);
}

// --- CLIENT LOGIC ---

function handleClientData(data) {
    if (data.type === 'ERROR') {
        alert(data.msg);
        navTo('screen-setup');
    } else if (data.type === 'JOIN_SUCCESS') {
        document.getElementById('room-code-display').innerText = data.room;
        document.getElementById('host-controls').classList.add('hidden');
        document.getElementById('client-waiting').classList.remove('hidden');
        if (data.max) gameState.totalMaxPlayers = data.max;
        navTo('screen-lobby');
    } else if (data.type === 'LOBBY_UPDATE') {
        updateLobbyUI(data.players, data.max);
    } else if (data.type === 'START') {
        setupRoleScreen(data);
    } else if (data.type === 'GOTO_DISCUSSION') {
        startDiscussionClient(data.time || 90, data.order);
    } else if (data.type === 'GOTO_VOTE') {
        setupVoteScreen(data.alivePlayers);
    } else if (data.type === 'GOTO_THEFT_GUESS') {
        startTheftGuessPhase(data.elimPlayer, data.traitors);
    } else if (data.type === 'RESULT') {
        showResultScreen(data);
    } else if (data.type === 'END') {
        showEndScreen(data);
    }
}

// --- FLOW SCREENS ---

function setupRoleScreen(data) {
    myRole = data.role;
    document.getElementById('role-name').innerText = myRole;
    document.getElementById('role-icon').innerText = myRole === 'THEFT' ? "🥷" : (myRole==='POLICE'?"👮":(myRole==='DETECTIVE'?"🔍":"🕵️"));
    
    document.getElementById('player-secret-word').innerText = data.clue;
    
    document.getElementById('role-card').classList.remove('is-flipped');
    document.getElementById('role-ready-btn').classList.add('hidden');
    document.getElementById('investigator-choice').classList.add('hidden');
    navTo('screen-role');
}

function typeWriter(elementId, speed = 30) {
    let el = document.getElementById(elementId);
    if (!el || !el.dataset.text) return;
    let text = el.dataset.text;
    el.innerText = '';
    let i = 0;
    function type() {
        if (i < text.length) {
            el.innerHTML += text.charAt(i);
            i++;
            setTimeout(type, speed);
        }
    }
    type();
}

function toggleRoleCard() {
    const card = document.getElementById('role-card');
    card.classList.toggle('is-flipped');
    if (card.classList.contains('is-flipped')) {
        if (myRole === 'INVESTIGATOR') {
            document.getElementById('investigator-choice').classList.remove('hidden');
            document.getElementById('role-ready-btn').classList.add('hidden');
        } else {
            document.getElementById('role-ready-btn').classList.remove('hidden');
            document.getElementById('investigator-choice').classList.add('hidden');
        }
    }
}

function chooseAllegiance(side) {
    if (isLocalGame) {
        let p = gameState.players[localCurrentPlayerIndex];
        gameState.investigatorAlliances = gameState.investigatorAlliances || {};
        gameState.investigatorAlliances[p.id] = side;
        readyForScenario();
    } else {
        if (isHost) {
            gameState.investigatorAlliances = gameState.investigatorAlliances || {};
            gameState.investigatorAlliances[peer.id] = side;
        } else {
            hostConnection.send({ type: 'ALLEGIANCE', side: side });
        }
        document.getElementById('investigator-choice').classList.add('hidden');
        readyForScenario();
    }
}

function readyForScenario() {
    if (isLocalGame) {
        // Just move to the next player's pass screen
        localCurrentPlayerIndex++;
        passDeviceToNext();
        return;
    }
    
    if (isHost) handleHostData({peer: peer.id}, {type:'READY_ROLE'});
    else hostConnection.send({type:'READY_ROLE'});
    
    let btn = document.getElementById('role-ready-btn');
    if (btn) {
        btn.innerText = "WAITING...";
        btn.disabled = true;
    }
}

function readyForDiscussion() {
    if (isLocalGame) {
        startDiscussionHost();
        return;
    }
    
    if (isHost) handleHostData({peer: peer.id}, {type:'READY_DISCUSSION'});
    else hostConnection.send({type:'READY_DISCUSSION'});
    
    event.target.innerText = "WAITING...";
    event.target.disabled = true;
}

// --- DISCUSSION ---
let discTimer;
function startDiscussionHost() {
    let order = [...gameState.players].sort(() => Math.random() - 0.5).map(p => p.name);
    if (!isLocalGame) broadcast({ type: 'GOTO_DISCUSSION', time: 90, order: order });
    startDiscussionClient(90, order);
    document.getElementById('host-discussion-controls').classList.remove('hidden');
}

function startDiscussionClient(time, order) {
    navTo('screen-discussion');
    let t = time;
    document.getElementById('timer-display').innerText = t;
    
    let ol = document.getElementById('speaker-order-list');
    if (ol) {
        ol.innerHTML = '';
        if (order && order.length > 0) {
            order.forEach((name, idx) => {
                let li = document.createElement('li');
                li.innerHTML = idx === 0 ? `<span class="highlight-red" style="font-weight: bold;">${name} (Starts)</span>` : name;
                ol.appendChild(li);
            });
        }
    }

    clearInterval(discTimer);
    discTimer = setInterval(() => {
        t--;
        document.getElementById('timer-display').innerText = t;
        if (t <= 0) {
            clearInterval(discTimer);
            if(isHost || isLocalGame) endDiscussionEarly();
        }
    }, 1000);
}

function endDiscussionEarly() {
    clearInterval(discTimer);
    let alive = gameState.players.filter(p=>p.isAlive).map(p=>({id:p.id, name:p.name}));
    
    if (isLocalGame) {
        setupLocalVoteScreen(alive);
    } else {
        broadcast({ type: 'GOTO_VOTE', alivePlayers: alive });
        setupVoteScreen(alive);
        gameState.votes = {};
    }
}

// --- LOCAL VOTING ---
function setupLocalVoteScreen(alivePlayers) {
    navTo('screen-local-vote');
    let list = document.getElementById('local-vote-list');
    list.innerHTML = '';

    alivePlayers.forEach(p => {
        let btn = document.createElement('button');
        btn.className = 'vote-btn';
        btn.innerText = `ELIMINATE ${p.name}`;
        btn.onclick = () => {
            if (confirm(`Are you sure the group voted to eliminate ${p.name}?`)) {
                gameState.votes = {};
                // Force a fake vote from everyone to this person
                alivePlayers.forEach(ap => {
                    gameState.votes[ap.id] = p.id;
                });
                checkVotesComplete(); // Resolves just like online!
            }
        };
        list.appendChild(btn);
    });
}

// --- VOTING ---
let selectedVoteId = null;

function setupVoteScreen(alivePlayers) {
    navTo('screen-vote');
    let list = document.getElementById('vote-list');
    list.innerHTML = '';
    selectedVoteId = null;

    alivePlayers.forEach(p => {
        let btn = document.createElement('button');
        btn.className = 'vote-btn';
        btn.innerText = p.name;
        btn.onclick = () => {
            document.querySelectorAll('.vote-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedVoteId = p.id;
            
            // Send vote
            if (isHost) handleHostData({peer: peer.id}, {type:'VOTE', voteId: selectedVoteId});
            else hostConnection.send({type:'VOTE', voteId: selectedVoteId});
            
            btn.innerText = `VOTED: ${p.name}`;
            btn.disabled = true;
        };
        list.appendChild(btn);
    });
}

// --- THEFT GUESS PHASE ---
let currentTheftPlayer = null;

function startTheftGuessPhase(elimPlayer, traitors) {
    navTo('screen-theft-guess');
    currentTheftPlayer = elimPlayer;
    
    let revealDiv = document.getElementById('traitor-reveal');
    if (traitors && traitors.length > 0) {
        let names = traitors.map(t => t.name).join(", ");
        revealDiv.innerText = `TRAITOR REVEALED!\n${names} secretly allied with the THEFT!\nThey can now help the THEFT guess the word!`;
        revealDiv.classList.remove('hidden');
    } else {
        revealDiv.innerText = "No investigators allied with the THEFT. They are on their own!";
        revealDiv.classList.remove('hidden');
    }
    
    if (isLocalGame || myRole === 'THEFT') {
        document.getElementById('theft-input-area').classList.remove('hidden');
        document.getElementById('theft-waiting-area').classList.add('hidden');
    } else {
        document.getElementById('theft-input-area').classList.add('hidden');
        document.getElementById('theft-waiting-area').classList.remove('hidden');
    }
}

function submitTheftGuess() {
    let guess = document.getElementById('theft-word-guess').value.trim();
    if (!guess) return alert("Enter a guess!");
    
    if (isLocalGame) {
        processTheftGuess(guess);
    } else {
        if (isHost) processTheftGuess(guess);
        else hostConnection.send({ type: 'SUBMIT_GUESS', guess: guess });
    }
}

function processTheftGuess(guess) {
    let correct = gameState.currentMajorityWord.toUpperCase();
    let isCorrect = guess.toUpperCase() === correct;
    
    let res = {};
    if (isCorrect) {
        res = { type:'END', winner:'THEFTS', elimName: currentTheftPlayer ? currentTheftPlayer.name : 'Theft', elimRole: 'THEFT', msg: `THEFT correctly guessed "${correct}"!` };
    } else {
        res = { type:'END', winner:'INVESTIGATORS', elimName: currentTheftPlayer ? currentTheftPlayer.name : 'Theft', elimRole: 'THEFT', msg: `THEFT guessed wrong! The word was "${correct}".` };
    }
    
    if (!isLocalGame) broadcast(res);
    showEndScreen(res);
    
    DatabaseService.saveMatchResult({
        roomCode: roomCode,
        winner: isCorrect ? 'THEFTS' : 'INVESTIGATORS',
        elimName: currentTheftPlayer ? currentTheftPlayer.name : 'Theft',
        players: gameState.players,
        winningTeam: isCorrect ? 'THEFTS' : 'INVESTIGATORS'
    });
}

function checkVotesComplete() {
    let aliveCount = gameState.players.filter(p=>p.isAlive).length;
    let voteCount = Object.keys(gameState.votes).length;
    
    if (voteCount >= aliveCount) {
        // Tally
        let tally = {};
        for(let vid of Object.values(gameState.votes)) {
            tally[vid] = (tally[vid] || 0) + 1;
        }
        let maxVotes = 0;
        let eliminatedId = null;
        for(let vid in tally) {
            if(tally[vid] > maxVotes) {
                maxVotes = tally[vid];
                eliminatedId = vid;
            }
        }
        
        let elimPlayer = gameState.players.find(p=>p.id === eliminatedId);
        if (elimPlayer) elimPlayer.isAlive = false;

        // Check Win
        let theftsAlive = gameState.players.filter(p=> p.role==='THEFT' && p.isAlive).length;
        let innocentsAlive = gameState.players.filter(p=> p.role!=='THEFT' && p.isAlive).length;

        if (theftsAlive === 0) {
            // THEFT is caught! Transition to Theft Guess Phase
            // Find all traitors (Investigators who chose THEFT side)
            gameState.investigatorAlliances = gameState.investigatorAlliances || {};
            let traitors = gameState.players.filter(p => p.role === 'INVESTIGATOR' && gameState.investigatorAlliances[p.id] === 'THEFT');
            
            let data = { elimPlayer: elimPlayer, traitors: traitors };
            if (isLocalGame) {
                startTheftGuessPhase(data.elimPlayer, data.traitors);
            } else {
                broadcast({ type: 'GOTO_THEFT_GUESS', elimPlayer: data.elimPlayer, traitors: data.traitors });
                startTheftGuessPhase(data.elimPlayer, data.traitors);
            }
        } else if (theftsAlive >= innocentsAlive) {
            // THEFT Wins (survived)
            let res = { type:'END', winner:'THEFTS', elimName: elimPlayer?elimPlayer.name:'No one', elimRole: elimPlayer?elimPlayer.role:'' };
            if (!isLocalGame) broadcast(res);
            showEndScreen(res);
            DatabaseService.saveMatchResult({
                roomCode: roomCode,
                winner: 'THEFTS',
                elimName: elimPlayer?elimPlayer.name:'No one',
                players: gameState.players,
                winningTeam: 'THEFTS'
            });
        } else {
            // Someone else eliminated, game continues or resolves
            let res = { type:'RESULT', name: elimPlayer?elimPlayer.name:'No one', role: elimPlayer?elimPlayer.role:'Unknown' };
            if (!isLocalGame) broadcast(res);
            showResultScreen(res);
        }
    }
}

function showResultScreen(data) {
    navTo('screen-result');
    document.getElementById('eliminated-name').innerText = `${data.name} was voted out.`;
    document.getElementById('eliminated-role-reveal').innerText = `They were ${data.role === 'THEFT' ? 'the THEFT!' : 'an innocent.'}`;
    
    if (isHost || isLocalGame) {
        document.getElementById('next-round-btn').classList.remove('hidden');
        document.getElementById('waiting-host-result').classList.add('hidden');
    }
}

function hostNextPhase() {
    startDiscussionHost();
}

function showEndScreen(data) {
    navTo('screen-end');
    let title = data.winner === 'THEFTS' ? 'THEFT WINS' : 'THEFT CAUGHT';
    document.getElementById('end-title').innerText = title;
    
    let desc = data.msg ? data.msg : (data.winner === 'THEFTS' ? 'The innocent were outsmarted.' : 'Great job investigators!');
    document.getElementById('end-desc').innerText = desc;
}

function returnToLobby() {
    if(peer) peer.destroy();
    window.location.reload();
}
