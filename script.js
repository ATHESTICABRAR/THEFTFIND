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

// Roles config
const ROLES = ['THEFT', 'POLICE', 'DETECTIVE', 'INVESTIGATOR'];

// Scenarios
const SCENARIOS = [
    {
        title: "The Royal Diamond",
        desc: "An expensive diamond has disappeared from the Royal Museum at midnight. The security cameras were disabled for exactly 2 minutes.",
        clues: [
            "You found a piece of black fabric near the broken glass.",
            "The camera logs show someone with admin access disabled them.",
            "There were muddy footprints leading to the roof.",
            "You heard someone running in the east corridor.",
            "The glass was cut with a professional laser tool.",
            "A suspicious white van was seen leaving the alley."
        ],
        theftClue: "You need to convince them you were in the west wing checking the electrical panel when the cameras went out."
    }
];

function navTo(screenId) {
    screens.forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

function showLobbySetup() {
    myName = document.getElementById('player-name').value.trim();
    if (!myName) return alert("Enter your name first!");
    navTo('screen-setup');
}

// --- LOBBY POPUPS ---
function showCreateRoomPopup() {
    document.getElementById('overlay-create').classList.add('active');
    // Generate a random room name suggestion
    document.getElementById('create-room-name').value = "ROOM-" + Math.random().toString(36).substring(2, 6).toUpperCase();
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
        presetDiv.innerText = "1 🥷 THEFT\n3 🕵️ INVESTIGATOR";
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
    if (!nameInput) return alert("Please enter a Room Name!");
    
    roomCode = nameInput;
    gameState.password = document.getElementById('create-room-pass').value.trim();
    
    let total = parseInt(document.getElementById('total-players').value) || 4;
    
    if (total === 4) {
        gameState.roleConfig = { THEFT: 1, POLICE: 0, DETECTIVE: 0, INVESTIGATOR: 3 };
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
        if (gameState.totalMaxPlayers < 7) {
            return alert("Your custom roles sum to " + gameState.totalMaxPlayers + ". Please adjust them to match your total players, or pick 4-6 players.");
        }
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
            broadcast({ type: 'GOTO_SCENARIO' });
            navTo('screen-scenario');
            gameState.readyCount = 0;
        }
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

    let scenario = SCENARIOS[0];
    
    // Distribute clues
    let usedClues = [...scenario.clues].sort(() => Math.random() - 0.5);
    
    gameState.players.forEach(p => {
        let pClue = p.role === 'THEFT' ? scenario.theftClue : usedClues.pop() || "You didn't notice anything useful.";
        
        let msg = {
            type: 'START',
            role: p.role,
            scenarioTitle: scenario.title,
            scenarioDesc: scenario.desc,
            clue: pClue
        };

        if (p.host) {
            setupRoleScreen(msg);
        } else {
            p.conn.send(msg);
        }
    });

    gameState.phase = 'ROLE';
    gameState.readyCount = 0;
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
    } else if (data.type === 'GOTO_SCENARIO') {
        navTo('screen-scenario');
    } else if (data.type === 'GOTO_DISCUSSION') {
        startDiscussionClient(data.time || 90);
    } else if (data.type === 'GOTO_VOTE') {
        setupVoteScreen(data.alivePlayers);
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
    document.getElementById('role-desc').innerText = myRole === 'THEFT' ? "You are the criminal. Blend in!" : "Find the THEFT.";
    document.getElementById('role-icon').innerText = myRole === 'THEFT' ? "🥷" : (myRole==='POLICE'?"👮":(myRole==='DETECTIVE'?"🔍":"🕵️"));
    
    // Store data for typewriter effect later
    document.getElementById('scenario-title').innerText = data.scenarioTitle;
    document.getElementById('scenario-desc').dataset.text = data.scenarioDesc;
    document.getElementById('player-clue').dataset.text = data.clue;
    
    document.getElementById('role-card').classList.remove('is-flipped');
    document.getElementById('role-ready-btn').classList.add('hidden');
    navTo('screen-role');
}

function typeWriter(elementId, speed = 30) {
    let el = document.getElementById(elementId);
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
        document.getElementById('role-ready-btn').classList.remove('hidden');
    }
}

function readyForScenario() {
    if (isHost) handleHostData({peer: peer.id}, {type:'READY_ROLE'});
    else hostConnection.send({type:'READY_ROLE'});
    
    document.getElementById('role-ready-btn').innerText = "WAITING...";
    document.getElementById('role-ready-btn').disabled = true;
    
    // Trigger typewriter effect for the next screen
    setTimeout(() => {
        typeWriter('scenario-desc', 20);
        setTimeout(() => typeWriter('player-clue', 30), 1000);
    }, 500);
}

function readyForDiscussion() {
    if (isHost) handleHostData({peer: peer.id}, {type:'READY_DISCUSSION'});
    else hostConnection.send({type:'READY_DISCUSSION'});
    
    event.target.innerText = "WAITING...";
    event.target.disabled = true;
}

// --- DISCUSSION ---
let discTimer;
function startDiscussionHost() {
    broadcast({ type: 'GOTO_DISCUSSION', time: 90 });
    startDiscussionClient(90);
    document.getElementById('host-discussion-controls').classList.remove('hidden');
}

function startDiscussionClient(time) {
    navTo('screen-discussion');
    let t = time;
    document.getElementById('timer-display').innerText = t;
    
    let ul = document.getElementById('discussion-player-list');
    ul.innerHTML = ''; // For simplicity, we won't live-update status here unless needed

    clearInterval(discTimer);
    discTimer = setInterval(() => {
        t--;
        document.getElementById('timer-display').innerText = t;
        if (t <= 0) {
            clearInterval(discTimer);
            if(isHost) endDiscussionEarly();
        }
    }, 1000);
}

function endDiscussionEarly() {
    clearInterval(discTimer);
    let alive = gameState.players.filter(p=>p.isAlive).map(p=>({id:p.id, name:p.name}));
    broadcast({ type: 'GOTO_VOTE', alivePlayers: alive });
    setupVoteScreen(alive);
    gameState.votes = {};
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
            let res = { type:'END', winner:'INVESTIGATORS', elimName: elimPlayer?elimPlayer.name:'No one', elimRole: elimPlayer?elimPlayer.role:'' };
            broadcast(res);
            showEndScreen(res);
            // Save to Mongo
            DatabaseService.saveMatchResult({
                roomCode: roomCode,
                winner: 'INVESTIGATORS',
                elimName: elimPlayer?elimPlayer.name:'No one',
                players: gameState.players,
                winningTeam: 'INVESTIGATORS'
            });
        } else if (theftsAlive >= innocentsAlive) {
            let res = { type:'END', winner:'THEFTS', elimName: elimPlayer?elimPlayer.name:'No one', elimRole: elimPlayer?elimPlayer.role:'' };
            broadcast(res);
            showEndScreen(res);
            // Save to Mongo
            DatabaseService.saveMatchResult({
                roomCode: roomCode,
                winner: 'THEFTS',
                elimName: elimPlayer?elimPlayer.name:'No one',
                players: gameState.players,
                winningTeam: 'THEFTS'
            });
        } else {
            let res = { type:'RESULT', name: elimPlayer?elimPlayer.name:'No one', role: elimPlayer?elimPlayer.role:'Unknown' };
            broadcast(res);
            showResultScreen(res);
        }
    }
}

function showResultScreen(data) {
    navTo('screen-result');
    document.getElementById('eliminated-name').innerText = `${data.name} was voted out.`;
    document.getElementById('eliminated-role-reveal').innerText = `They were ${data.role === 'THEFT' ? 'the THEFT!' : 'an innocent.'}`;
    
    if (isHost) {
        document.getElementById('next-round-btn').classList.remove('hidden');
        document.getElementById('waiting-host-result').classList.add('hidden');
    }
}

function hostNextPhase() {
    startDiscussionHost();
}

function showEndScreen(data) {
    navTo('screen-end');
    let title = data.winner === 'THEFTS' ? 'THEFT ESCAPES' : 'THEFT CAUGHT';
    document.getElementById('end-title').innerText = title;
    
    let desc = data.winner === 'THEFTS' ? 'The innocent were outsmarted.' : 'Great job investigators!';
    document.getElementById('end-desc').innerText = desc;
}

function returnToLobby() {
    if(peer) peer.destroy();
    window.location.reload();
}
