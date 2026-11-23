const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));

const rooms = new Map();
const MAX = 20;
const clean = s => String(s || "").trim().replace(/[<>]/g, "").slice(0, 14);
const code = () => Math.random().toString(36).slice(2, 6).toUpperCase();

function publicRoom(r) {
  return { code:r.code, players:[...r.players.values()].map(p=>({
    id:p.id, name:p.name, color:p.color, alive:p.alive
  })), started:r.started, phase:r.phase, max:MAX };
}
function sendRoom(r) { io.to(r.code).emit("room", publicRoom(r)); }
function leave(socket) {
  const c=socket.data.room; if(!c) return;
  const r=rooms.get(c); socket.leave(c); socket.data.room=null;
  if(r) {
    r.players.delete(socket.id);
    if(!r.players.size) rooms.delete(c);
    else { if(r.host===socket.id) r.host=[...r.players.keys()][0]; sendRoom(r); }
  }
}
io.on("connection", socket => {
  socket.on("create", ({name}) => {
    leave(socket);
    let c=code(); while(rooms.has(c)) c=code();
    const r={code:c,host:socket.id,players:new Map(),started:false,phase:"lobby",votes:{}};
    rooms.set(c,r); r.players.set(socket.id,{id:socket.id,name:clean(name)||"Player",color:0,alive:true});
    socket.join(c); socket.data.room=c; socket.emit("joined",{code:c,host:true}); sendRoom(r);
  });
  socket.on("join", ({name,code:c}) => {
    leave(socket); c=String(c||"").toUpperCase().trim();
    const r=rooms.get(c);
    if(!r) return socket.emit("notice","방 코드를 확인해 주세요.");
    if(r.started) return socket.emit("notice","이미 게임이 시작된 방이에요.");
    if(r.players.size>=MAX) return socket.emit("notice","방이 꽉 찼어요. (최대 20명)");
    r.players.set(socket.id,{id:socket.id,name:clean(name)||"Player",color:r.players.size%12,alive:true});
    socket.join(c); socket.data.room=c; socket.emit("joined",{code:c,host:false}); sendRoom(r);
  });
  socket.on("start",()=>{
    const r=rooms.get(socket.data.room); if(!r||r.host!==socket.id||r.started) return;
    if(r.players.size<4) return socket.emit("notice","게임 시작에는 최소 4명이 필요해요.");
    const ps=[...r.players.values()];
    ps.forEach(p=>{p.role="crew";p.alive=true;p.tasks=0;});
    const shuffled=[...ps].sort(()=>Math.random()-.5);
    shuffled.slice(0,Math.max(1,Math.floor(ps.length/5))).forEach(p=>p.role="impostor");
    r.started=true;r.phase="playing";r.votes={};
    for(const p of ps) io.to(p.id).emit("privateRole",{role:p.role});
    sendRoom(r);
  });
  socket.on("task",()=>{
    const r=rooms.get(socket.data.room),p=r?.players.get(socket.id);
    if(!r||r.phase!=="playing"||!p||!p.alive||p.role!=="crew") return;
    p.tasks=Math.min(3,p.tasks+1);
    if([...r.players.values()].filter(x=>x.role==="crew").every(x=>x.tasks>=3)) r.phase="crewWin";
    sendRoom(r);
  });
  socket.on("meeting",()=>{
    const r=rooms.get(socket.data.room),p=r?.players.get(socket.id);
    if(!r||r.phase!=="playing"||!p?.alive) return;
    r.phase="meeting";r.votes={}; sendRoom(r);
  });
  socket.on("vote",({target})=>{
    const r=rooms.get(socket.data.room),p=r?.players.get(socket.id);
    if(!r||r.phase!=="meeting"||!p?.alive||r.votes[socket.id]) return;
    if(target!=="skip"&&!r.players.has(target)) return;
    r.votes[socket.id]=target;
    const alive=[...r.players.values()].filter(x=>x.alive);
    if(alive.every(x=>r.votes[x.id])) {
      const counts={}; Object.values(r.votes).forEach(v=>{if(v!=="skip")counts[v]=(counts[v]||0)+1;});
      const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
      if(top.length && (!top[1]||top[0][1]>top[1][1])) {
        const out=r.players.get(top[0][0]); if(out) out.alive=false;
      }
      const aliveNow=[...r.players.values()].filter(x=>x.alive);
      const im=aliveNow.filter(x=>x.role==="impostor").length;
      const crew=aliveNow.length-im;
      r.phase=im===0?"crewWin":im>=crew?"impostorWin":"playing";
      r.votes={};
    }
    sendRoom(r);
  });
  socket.on("disconnect",()=>leave(socket));
});
const port=process.env.PORT||3000;
server.listen(port,()=>console.log("Classmate SUS running on "+port));