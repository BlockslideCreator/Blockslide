const socket = io();

const GRID_SIZE = 25;
const CELL_SIZE = 500 / GRID_SIZE;

let currentRoom = null;
let roomData = null;
let keyCooldown = {};

// ===== AUTH =====
function createAccount() {
    if(username1.value.length < 3) { authMsg.innerText = "First username must be ≥3"; return; }
    if(username2.value.length < 8) { authMsg.innerText = "Second username must be ≥8"; return; }
    socket.emit("createAccount", { username1: username1.value, username2: username2.value });
}

function login() {
    if(username1.value.length < 3) { authMsg.innerText = "First username must be ≥3"; return; }
    if(username2.value.length < 8) { authMsg.innerText = "Second username must be ≥8"; return; }
    socket.emit("login", { username1: username1.value, username2: username2.value });
}

socket.on("accountError", msg => authMsg.innerText = msg);
socket.on("accountSuccess", () => authMsg.innerText = "Account created!");
socket.on("loginSuccess", () => {
    auth.style.display = "none";
    serverMenu.style.display = "block";
});

// ===== SERVER MENU =====
function createServer() { socket.emit("createServer"); }
function joinServer() { socket.emit("joinServer", serverCodeInput.value); }

socket.on("serverCreated", code => {
    serverMsg.innerText = "Server Code: " + code;
    currentRoom = { code };
});
socket.on("serverError", msg => serverMsg.innerText = msg);

// ===== LOBBY / GAME =====
socket.on("updateLobby", room => {
    currentRoom = room;
    roomData = room;
    if(currentRoom.code) serverCode.innerText = "Server Code: " + currentRoom.code;
    serverMenu.style.display = "none";
    gameUI.style.display = "flex";
    renderLobby();
});

socket.on("gameStarted", room => {
    currentRoom = room;
    roomData = room;
    renderGame();
});

socket.on("updateGame", room => {
    roomData = room;
    renderGame();
});

socket.on("gameEnded", room => {
    roomData = room;

    let results = Object.values(room.players)
        .map(p => ({username1:p.username1,color:p.color,score:room.grid.flat().filter(c=>c===p.color).length}))
        .sort((a,b)=>b.score-a.score);

    let html = "<ol>";
    results.forEach(p=>html+=`<li><span style="color:${p.color}">■</span> ${p.username1}: ${p.score}</li>`);
    html += "</ol>";

    endGameResults.innerHTML = html;
    endGamePopup.style.display="block";

    // Reset grid for next round
    room.grid = Array.from({length:GRID_SIZE},()=>Array(GRID_SIZE).fill(null));
    renderLobby();
});

function startGame(){ socket.emit("startGame"); }
function leaveServer(){ socket.emit("leaveServer"); location.reload(); }

// ===== MOVEMENT =====
document.addEventListener("keydown", e=>{
    if(!keyCooldown[e.key]){ socket.emit("move", e.key); keyCooldown[e.key]=true; }
});
document.addEventListener("keyup", e=>{ keyCooldown[e.key]=false; });

// ===== RENDER =====
function renderLobby(){
    playerList.innerHTML="";
    leaderboardList.innerHTML="";
    for(let id in roomData.players){
        const p = roomData.players[id];
        const div = document.createElement("div");
        div.innerHTML=`<span style="color:${p.color}">■</span> ${p.username1}` + (roomData.host===id ? " (host)":"");
        if(roomData.host===socket.id) div.onclick=()=>showPopup(p.username2,id);
        playerList.appendChild(div);
    }
    startBtn.style.display=(roomData.host===socket.id)?"block":"none";
}

function renderGame(){
    const canvas = gameCanvas;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0,0,500,500);

    let scores = {};
    for(let y=0;y<GRID_SIZE;y++){
        for(let x=0;x<GRID_SIZE;x++){
            const color=roomData.grid[y][x];
            if(color){
                ctx.fillStyle=color;
                ctx.fillRect(x*CELL_SIZE,y*CELL_SIZE,CELL_SIZE,CELL_SIZE);
                scores[color]=(scores[color]||0)+1;
            }
        }
    }

    for(let id in roomData.players){
        const p = roomData.players[id];
        if(!p.inGame) continue;
        ctx.fillStyle=p.color;
        ctx.fillRect(p.x*CELL_SIZE,p.y*CELL_SIZE,CELL_SIZE,CELL_SIZE);
        ctx.strokeStyle="black";
        ctx.strokeRect(p.x*CELL_SIZE,p.y*CELL_SIZE,CELL_SIZE,CELL_SIZE);
    }

    renderLeaderboard(scores);
    gameTimer.innerText="Time: "+roomData.timer;
}

function renderLeaderboard(scores){
    leaderboardList.innerHTML="";
    let arr = Object.values(roomData.players).map(p=>({
        username1:p.username1,
        color:p.color,
        score:scores[p.color]||0
    }));
    arr.sort((a,b)=>b.score-a.score); // highest first
    arr.forEach(p=>{
        const div = document.createElement("div");
        div.innerHTML=`<span style="color:${p.color}">■</span> ${p.username1}: ${p.score}`;
        leaderboardList.appendChild(div);
    });
}

// ===== POPUP =====
function showPopup(username2,id){
    popup.innerHTML="Username2: "+username2+
        `<br><button onclick='transferHost("${id}")'>Make Host</button>`+
        "<br><button onclick='closePopup()'>Close</button>";
    popup.style.display="block";
}
function closePopup(){ popup.style.display="none"; }
function transferHost(id){ socket.emit("transferHost",id); closePopup(); }

function closeEndGame(){ endGamePopup.style.display="none"; }
