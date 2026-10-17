import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || '/data/chat.db';
const html = fs.readFileSync(path.join(import.meta.dirname, 'index.html'));
const NAME_RE = /^[\w.-]{2,20}$/;

const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(
  name TEXT PRIMARY KEY COLLATE NOCASE, token TEXT NOT NULL, last_seen INTEGER);
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
  sender TEXT NOT NULL, chat TEXT NOT NULL, text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_chat ON messages(chat, id);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bans(name TEXT PRIMARY KEY COLLATE NOCASE, reason TEXT, ts INTEGER, by TEXT);
CREATE TABLE IF NOT EXISTS device_pins(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL COLLATE NOCASE, code TEXT NOT NULL, used INTEGER DEFAULT 0, created INTEGER NOT NULL, expires INTEGER NOT NULL, used_by TEXT);
`);
db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('password','anjir445566')").run();
db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('retention','48')").run();
db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('spam_max','6')").run();
db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('spam_window','10000')").run();
db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('typing_throttle','1500')").run();
db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('admin_ttl','600000')").run();

const q = {
  user: db.prepare('SELECT name, token FROM users WHERE name=?'),
  addUser: db.prepare('INSERT INTO users(name, token, last_seen) VALUES(?,?,?)'),
  seen: db.prepare('UPDATE users SET last_seen=? WHERE name=?'),
  users: db.prepare('SELECT name, last_seen FROM users ORDER BY name'),
  add: db.prepare('INSERT INTO messages(ts, sender, chat, text) VALUES(?,?,?,?)'),
  hist: db.prepare('SELECT id, ts, sender, chat, text FROM messages WHERE chat=? ORDER BY id DESC LIMIT 500'),
  lastPer: db.prepare(`
    SELECT m.id, m.ts, m.sender, m.chat, m.text FROM messages m
    JOIN (SELECT MAX(id) mid FROM messages
          WHERE chat='general' OR instr('|'||chat||'|', '|'||?||'|')>0
          GROUP BY chat) x ON m.id = x.mid`),
  getSetting: db.prepare('SELECT value FROM settings WHERE key=?'),
  setSetting: db.prepare(`INSERT INTO settings(key,value) VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`),
  expire: db.prepare('DELETE FROM messages WHERE ts < ?'),
  banGet: db.prepare('SELECT * FROM bans WHERE name=?'),
  banAdd: db.prepare('INSERT OR IGNORE INTO bans(name,reason,ts,by) VALUES(?,?,?,?)'),
  banDel: db.prepare('DELETE FROM bans WHERE name=?'),
  bansAll: db.prepare('SELECT name,reason,ts,by FROM bans ORDER BY ts DESC'),
  allMsgs: db.prepare('SELECT id,ts,sender,chat,text FROM messages ORDER BY id ASC'),
  delAllMsgs: db.prepare('DELETE FROM messages'),
  pinNew: db.prepare('INSERT INTO device_pins(name,code,used,created,expires) VALUES(?,?,0,?,?)'),
  pinGet: db.prepare('SELECT * FROM device_pins WHERE code=? AND used=0 AND expires>?'),
  pinUse: db.prepare('UPDATE device_pins SET used=1,used_by=? WHERE id=?'),
};
const getSetting = k => q.getSetting.get(k)?.value;
const num = (v, d)=>{const n=Math.floor(Number(v));return Number.isFinite(n)&&n>=0?n:d};
const retMin = () => {const n=Math.floor(Number(getSetting('retention')));return Number.isFinite(n)&&n>=1?n:48};
const spamMax = () => num(getSetting('spam_max'),6);
const spamWin = () => num(getSetting('spam_window'),10000);
const typThrottle = () => num(getSetting('typing_throttle'),1500);
const adminTTL = () => num(getSetting('admin_ttl'),600000);

function json(res,obj,code=200){const b=Buffer.from(JSON.stringify(obj));res.writeHead(code,{'content-type':'application/json','content-length':b.length,'cache-control':'no-store'});res.end(b);}

const server = http.createServer((req,res)=>{
  if(req.url==='/healthz'){res.writeHead(200);return res.end('ok');}
  if(req.url==='/favicon.ico'){res.writeHead(204);return res.end();}
  if(req.url.startsWith('/export/all')){
    const url=new URL(req.url,'http://x');const pw=url.searchParams.get('pw');
    if(pw!==getSetting('password')) return json(res,{error:'unauthorized'},401);
    const rows=q.allMsgs.all();const data={exportedAt:Date.now(),count:rows.length,retentionMin:retMin(),rows};
    const b=Buffer.from(JSON.stringify(data,null,2));
    res.writeHead(200,{'content-type':'application/json; charset=utf-8','content-disposition':`attachment; filename="echidna-chat-export-all-${new Date().toISOString().replace(/[:.]/g,'-')}.json"`,'content-length':b.length,'cache-control':'no-store'});
    return res.end(b);
  }
  if(req.url.startsWith('/export/chat')){
    const url=new URL(req.url,'http://x');const pw=url.searchParams.get('pw');const chat=url.searchParams.get('chat')||'general';
    if(pw!==getSetting('password')) return json(res,{error:'unauthorized'},401);
    const key=(chat==='general')?'general':chat;const rows=db.prepare('SELECT id,ts,sender,chat,text FROM messages WHERE chat=? ORDER BY id ASC').all(key);
    const data={exportedAt:Date.now(),chat:key,count:rows.length,retentionMin:retMin(),rows};
    const b=Buffer.from(JSON.stringify(data,null,2));
    res.writeHead(200,{'content-type':'application/json; charset=utf-8','content-disposition':`attachment; filename="echidna-chat-${key.replace(/\|/g,'_')}-${new Date().toISOString().replace(/[:.]/g,'-')}.json"`,'content-length':b.length,'cache-control':'no-store'});
    return res.end(b);
  }
  if(req.url.startsWith('/export/chat.txt')){
    const url=new URL(req.url,'http://x');const pw=url.searchParams.get('pw');const chat=url.searchParams.get('chat')||'general';
    if(pw!==getSetting('password')) return json(res,{error:'unauthorized'},401);
    const key=(chat==='general')?'general':chat;const rows=db.prepare('SELECT id,ts,sender,chat,text FROM messages WHERE chat=? ORDER BY id ASC').all(key);
    let out=`# Echidna System - Export Chat\n# Chat: ${key}\n# Exported: ${new Date().toISOString()}\n# Retention (min): ${retMin()}\n# Count: ${rows.length}\n\n`;
    for(const m of rows){out += `[${new Date(m.ts).toISOString()}] ${m.sender}: ${m.text.replace(/\r\n/g,'\n')}\n`;}
    const b=Buffer.from(out,'utf8');
    res.writeHead(200,{'content-type':'text/plain; charset=utf-8','content-disposition':`attachment; filename="echidna-chat-${key.replace(/\|/g,'_')}-${new Date().toISOString().replace(/[:.]/g,'-')}.txt"`,'content-length':b.length,'cache-control':'no-store'});
    return res.end(b);
  }
  if(req.url.startsWith('/api/device/pin')){
    const url=new URL(req.url,'http://x');
    if(req.method==='POST'||req.url.includes('?gen')){
      let body='';req.on('data',c=>body+=c);req.on('end',()=>{
        try{
          const j=body?JSON.parse(body):{};const name=(j.name||'').trim();
          if(!name||!NAME_RE.test(name)) return json(res,{ok:false,error:'name'},400);
          const code=Math.floor(100000+Math.random()*900000).toString();
          const now=Date.now();const exp=now+10*60*1000;
          q.pinNew.run(name,code,now,exp);
          return json(res,{ok:true,name,code,expires:exp});
        }catch{return json(res,{ok:false,error:'bad'},400);}
      });return;
    }
    return json(res,{ok:false},400);
  }
  if(req.url.startsWith('/api/device/verify')){
    const url=new URL(req.url,'http://x');
    if(req.method==='POST'){
      let body='';req.on('data',c=>body+=c);req.on('end',()=>{
        try{
          const j=body?JSON.parse(body):{};const code=(j.code||'').trim();
          const p=q.pinGet.get(code, Date.now());
          if(!p) return json(res,{ok:false,error:'invalid'});
          const u=q.user.get(p.name);
          if(!u) return json(res,{ok:false,error:'nouser'});
          q.pinUse.run('web',p.id);
          return json(res,{ok:true,name:p.name,token:u.token});
        }catch{return json(res,{ok:false,error:'bad'},400);}
      });return;
    }
    return json(res,{ok:false},400);
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);return res.end();}
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'});res.end(html);
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16*1024 });
const clients = new Map();
const send = (ws,o)=>ws.readyState===1&&ws.send(JSON.stringify(o));
const toUser = (n,o)=>clients.get(n)?.forEach(w=>send(w,o));
const broadcast = (o,except)=>wss.clients.forEach(w=>w.name&&w!==except&&send(w,o));
const chatKey = (me,to)=>(to==='general'?'general':[me,to].sort().join('|'));
const resolve = to=>(to==='general'?'general':(typeof to==='string'?q.user.get(to)?.name:undefined));
const isBanned = n=>{if(!n)return false;return !!q.banGet.get(n);};

function join(ws,d){
  if(ws.name)return;
  const {name,token}=d;
  if(typeof name!=='string'||!NAME_RE.test(name)||typeof token!=='string'||token.length<8||token.length>64) return send(ws,{t:'err',text:'Nama tidak valid (2-20 karakter: huruf/angka/._-)'});
  if(isBanned(name)) return send(ws,{t:'err',text:'Akun ini diblokir'});
  if(d.pw!==getSetting('password')) return send(ws,{t:'err',text:'Password salah'});
  const u=q.user.get(name);
  if(u&&u.token!==token) return send(ws,{t:'err',text:'Nama sudah dipakai orang lain'});
  if(!u) q.addUser.run(name,token,Date.now());
  ws.name=u?u.name:name;
  ws.spam={c:0,t:Date.now()};
  ws.typLast=0;
  const first=!clients.has(ws.name);
  if(first) clients.set(ws.name,new Set());
  clients.get(ws.name).add(ws);
  const onlineCount=wss.clients.size;
  send(ws,{t:'init',me:ws.name,users:q.users.all().map(x=>({name:x.name,last_seen:x.last_seen,online:clients.has(x.name)})),last:q.lastPer.all(ws.name),cfg:{retentionMin:retMin(),spamMax:spamMax(),spamWin:spamWin(),typingThrottle:typThrottle(),adminTTL:adminTTL(),online:onlineCount},onlineCount});
  if(first) broadcast({t:'presence',name:ws.name,online:true,last_seen:Date.now(),onlineCount},ws);
  broadcast({t:'online_count',count:onlineCount},ws);
}

function admin(ws,d){
  const pwOk=typeof d.pw==='string'&&d.pw===getSetting('password');
  const now=Date.now();
  if(d.t==='admin_verify') return send(ws,pwOk?{t:'admin_ok',ret:retMin(),bans:q.bansAll.all(),bots:qBot.list.all(),cfg:{retentionMin:retMin(),spamMax:spamMax(),spamWin:spamWin(),typingThrottle:typThrottle(),adminTTL:adminTTL()},exp:now+adminTTL()}:{t:'admin_err',text:'Password salah'});
  if(d.t==='admin_bot_add'){if(!pwOk)return send(ws,{t:'admin_err',text:'Password salah'});const nm=(d.name||'').trim();if(!nm||nm.length<2||nm.length>20)return send(ws,{t:'admin_err',text:'Nama bot 2-20'});const h=Math.floor(Number(d.hour)),m=Math.floor(Number(d.minute));if(h<0||h>23||m<0||m>59)return send(ws,{t:'admin_err',text:'Jam tidak valid'});const text=(d.text||'').trim();if(!text)return send(ws,{t:'admin_err',text:'Pesan tidak boleh kosong'});const chat=(d.chat||'general').trim()||'general';const days=d.days||'*';const pos=Math.floor(Number(d.pos)||0);qBot.add.run(nm,d.enabled?1:0,h,m,days,chat,text,pos,0,Date.now());return send(ws,{t:'bot_list',bots:qBot.list.all()});}
  if(d.t==='admin_bot_upd'){if(!pwOk)return send(ws,{t:'admin_err',text:'Password salah'});const id=Math.floor(Number(d.id));if(!id)return send(ws,{t:'admin_err',text:'ID salah'});const nm=(d.name||'').trim();if(!nm||nm.length<2||nm.length>20)return send(ws,{t:'admin_err',text:'Nama bot 2-20'});const h=Math.floor(Number(d.hour)),m=Math.floor(Number(d.minute));if(h<0||h>23||m<0||m>59)return send(ws,{t:'admin_err',text:'Jam tidak valid'});const text=(d.text||'').trim();if(!text)return send(ws,{t:'admin_err',text:'Pesan tidak boleh kosong'});const chat=(d.chat||'general').trim()||'general';const days=d.days||'*';const pos=Math.floor(Number(d.pos)||0);qBot.upd.run(nm,d.enabled?1:0,h,m,days,chat,text,pos,id);return send(ws,{t:'bot_list',bots:qBot.list.all()});}
  if(d.t==='admin_bot_del'){if(!pwOk)return send(ws,{t:'admin_err',text:'Password salah'});const id=Math.floor(Number(d.id));if(id){qBot.del.run(id);}return send(ws,{t:'bot_list',bots:qBot.list.all()});}
  if(d.t==='admin_bot_list'){if(!pwOk)return send(ws,{t:'admin_err',text:'Password salah'});return send(ws,{t:'bot_list',bots:qBot.list.all()});}
  if(d.t==='admin_setret'){if(!pwOk)return send(ws,{t:'admin_err',text:'Password salah'});const n=Math.floor(Number(d.minutes));if(!Number.isFinite(n)||n<1||n>10080)return send(ws,{t:'admin_err',text:'Durasi harus 1-10080 menit'});q.setSetting.run('retention',String(n));broadcast({t:'cfg_update',cfg:{retentionMin:n}});return send(ws,{t:'ret_set',minutes:n});}
  if(d.t==='admin_reset'){if(!pwOk)return send(ws,{t:'admin_err',text:'Password salah'});q.delAllMsgs.run();broadcast({t:'reset'});return send(ws,{t:'reset_ok'});}
  if(d.t==='admin_ban'){if(!pwOk)return send(ws,{t:'admin_err',text:'Password salah'});const nm=(d.name||'').trim();if(!NAME_RE.test(nm))return send(ws,{t:'admin_err',text:'Nama tidak valid'});if(nm.toLowerCase()===ws.name?.toLowerCase())return send(ws,{t:'admin_err',text:'Tidak bisa ban diri sendiri'});q.banAdd.run(nm,d.reason||null,Date.now(),ws.name||'admin');const set=clients.get(nm);if(set){for(const w of [...set]){try{w.close(4001,'Diblokir')}catch{}}}broadcast({t:'ban',name:nm});return send(ws,{t:'ban_ok',name:nm,bans:q.bansAll.all()});}
  if(d.t==='admin_unban'){if(!pwOk)return send(ws,{t:'admin_err',text:'Password salah'});const nm=(d.name||'').trim();q.banDel.run(nm);broadcast({t:'unban',name:nm});return send(ws,{t:'unban_ok',name:nm,bans:q.bansAll.all()});}
  if(d.t==='admin_setcfg'){if(!pwOk)return send(ws,{t:'admin_err',text:'Password salah'});if(d.spamMax!=null){const v=num(d.spamMax,6);if(v<1||v>50)return send(ws,{t:'admin_err',text:'spamMax 1-50'});q.setSetting.run('spam_max',String(v));}if(d.spamWin!=null){const v=num(d.spamWin,10000);if(v<1000||v>60000)return send(ws,{t:'admin_err',text:'spamWin 1000-60000ms'});q.setSetting.run('spam_window',String(v));}if(d.typingThrottle!=null){const v=num(d.typingThrottle,1500);if(v<200||v>10000)return send(ws,{t:'admin_err',text:'typingThrottle 200-10000ms'});q.setSetting.run('typing_throttle',String(v));}if(d.adminTTL!=null){const v=num(d.adminTTL,600000);if(v<60000||v>3600000)return send(ws,{t:'admin_err',text:'adminTTL 60s-1jam'});q.setSetting.run('admin_ttl',String(v));}broadcast({t:'cfg_update',cfg:{spamMax:spamMax(),spamWin:spamWin(),typingThrottle:typThrottle(),adminTTL:adminTTL()}});return send(ws,{t:'cfg_set_ok',cfg:{spamMax:spamMax(),spamWin:spamWin(),typingThrottle:typThrottle(),adminTTL:adminTTL()}});}
  if(d.t==='admin_export_all'){if(!pwOk)return send(ws,{t:'admin_err',text:'Password salah'});const rows=q.allMsgs.all();return send(ws,{t:'export_all',data:{exportedAt:Date.now(),count:rows.length,retentionMin:retMin(),rows}});}
  if(d.t==='admin_export_chat'){if(!pwOk)return send(ws,{t:'admin_err',text:'Password salah'});const chat=d.chat||'general';const key=(chat==='general')?'general':chat;const rows=db.prepare('SELECT id,ts,sender,chat,text FROM messages WHERE chat=? ORDER BY id ASC').all(key);return send(ws,{t:'export_chat',chat:key,data:{exportedAt:Date.now(),chat:key,count:rows.length,retentionMin:retMin(),rows}});}
}
wss.on('connection',ws=>{
  ws.alive=true;ws.spam={c:0,t:Date.now()};ws.typLast=0;
  ws.on('pong',()=>ws.alive=true);
  ws.on('message',raw=>{
    let d;try{d=JSON.parse(raw);}catch{return;}
    if(d.t==='join')return join(ws,d);
    if(d.t==='admin_verify'||d.t==='admin_setpw'||d.t==='admin_setret'||d.t==='admin_reset'||d.t==='admin_ban'||d.t==='admin_unban'||d.t==='admin_setcfg'||d.t==='admin_export_all'||d.t==='admin_export_chat'||d.t==='admin_bot_add'||d.t==='admin_bot_upd'||d.t==='admin_bot_del'||d.t==='admin_bot_list') return admin(ws,d);
    if(!ws.name)return;if(isBanned(ws.name))return;
    if(d.t==='msg'){
      const now=Date.now();const s=ws.spam;if(now-s.t>spamWin()){s.c=0;s.t=now;}s.c++;if(s.c>spamMax())return send(ws,{t:'err',text:'Terlalu banyak pesan, tunggu sebentar'});
      const text=typeof d.text==='string'?d.text.trim().slice(0,4000):'';const to=resolve(d.to);if(!text||!to)return;
      const chat=chatKey(ws.name,to),ts=Date.now();const id=Number(q.add.run(ts,ws.name,chat,text).lastInsertRowid);const m={id,ts,sender:ws.name,chat,text};
      if(to==='general')broadcast({t:'msg',m});else{toUser(ws.name,{t:'msg',m});if(to!==ws.name)toUser(to,{t:'msg',m});}
    }else if(d.t==='hist'){
      const to=resolve(d.chat);if(!to)return;send(ws,{t:'hist',chat:to,msgs:q.hist.all(chatKey(ws.name,to)).reverse()});
    }else if(d.t==='typing'){
      const now=Date.now();if(now-ws.typLast<typThrottle())return;ws.typLast=now;const to=resolve(d.to);if(!to)return;
      if(to==='general')broadcast({t:'typing',from:ws.name,chat:'general'},ws);else toUser(to,{t:'typing',from:ws.name,chat:ws.name});
    }else if(d.t==='ping'){send(ws,{t:'pong'});}
  });
  ws.on('close',()=>{
    const oc=wss.clients.size;
    if(!ws.name){broadcast({t:'online_count',count:oc});return;}
    const set=clients.get(ws.name);set?.delete(ws);
    if(set&&!set.size){clients.delete(ws.name);const ts=Date.now();q.seen.run(ts,ws.name);broadcast({t:'presence',name:ws.name,online:false,last_seen:ts,onlineCount:oc});}
    broadcast({t:'online_count',count:oc});
  });
});
setInterval(()=>wss.clients.forEach(ws=>{if(!ws.alive)return ws.terminate();ws.alive=false;ws.ping();}),30000);
function sweep(){const cutoff=Date.now()-retMin()*60000;const c=q.expire.run(cutoff).changes;if(c)broadcast({t:'purge',cutoff});}
q.expire.run(Date.now()-retMin()*60000);setInterval(sweep,60000);
server.listen(PORT,'0.0.0.0',()=>console.log('chat-local on :'+PORT));
const qBot = {
  list: db.prepare('SELECT * FROM bots ORDER BY pos ASC, id ASC'),
  add: db.prepare('INSERT INTO bots(name,enabled,hour,minute,days,chat,text,pos,ts_last,ts_created) VALUES(?,?,?,?,?,?,?,?,?,?)'),
  upd: db.prepare('UPDATE bots SET name=?,enabled=?,hour=?,minute=?,days=?,chat=?,text=?,pos=? WHERE id=?'),
  del: db.prepare('DELETE FROM bots WHERE id=?'),
  touch: db.prepare('UPDATE bots SET ts_last=? WHERE id=?'),
};

const dayMap=['sun','mon','tue','wed','thu','fri','sat'];
function matchDay(s){
  if(!s||s==='*'||s==='all') return true;
  const d=new Date();
  const k=dayMap[d.getDay()];
  return s.toLowerCase().split(',').some(x=>x.trim()===k||x.trim()==='*');
}
function botSweep(){
  const now=Date.now();const d=new Date(now);
  const bots=qBot.list.all().filter(b=>b.enabled);
  for(const b of bots){
    if(!matchDay(b.days)) continue;
    if(d.getHours()!==b.hour||d.getMinutes()!==b.minute) continue;
    if(now - b.ts_last < 60000) continue;
    const chat=(b.chat||'general').trim()||'general';
    const text=(b.text||'').trim();
    if(!text) continue;
    let to=chat==='general'?'general':chat;
    if(to!=='general'){
      const r=resolve(to);
      if(!r) to=chat;
      else to=r;
    }
    const key=chatKey('general',to)==='general'?'general':chatKey('__bot__',to); // not needed
    const ckey = (to==='general'?'general':chatKey(b.name,to).includes('|')?chatKey(b.name,to):[b.name,to].sort().join('|'));
    const realChat = (to==='general'?'general':chatKey(b.name,to));
    const ts=Date.now();
    const id=Number(q.add.run(ts,b.name,realChat,text).lastInsertRowid);
    const m={id,ts,sender:b.name,chat:realChat,text};
    if(to==='general') broadcast({t:'msg',m});
    else { toUser(b.name,{t:'msg',m}); if(to!==b.name) toUser(to,{t:'msg',m}); }
    qBot.touch.run(ts,b.id);
  }
}
setInterval(botSweep,10000);
