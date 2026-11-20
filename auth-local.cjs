'use strict';
const {DatabaseSync}=require('node:sqlite');
const {randomBytes,randomUUID,createHash,scrypt,timingSafeEqual}=require('node:crypto');
const {promisify}=require('node:util'),{mkdirSync}=require('node:fs'),path=require('node:path');
const derive=promisify(scrypt),ttl=7*86400000;
const error=(status,message)=>Object.assign(new Error(message),{status});
async function readBody(req,max=500000){if(!req.headers['content-type']?.startsWith('application/json'))throw error(415,'JSON required');let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>max)throw error(413,'Request too large')}try{const body=JSON.parse(text);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();return body}catch{throw error(400,'Invalid JSON')}}
function createAuth(filename=path.join(__dirname,'data','auth.sqlite')){
 if(filename!==':memory:')mkdirSync(path.dirname(filename),{recursive:true});const db=new DatabaseSync(filename);
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,salt TEXT NOT NULL,hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);');
 const columns=db.prepare('PRAGMA table_info(users)').all().map(c=>c.name);
 for(const [column,definition]of [['role',"TEXT NOT NULL DEFAULT 'viewer'"],['avatar','TEXT'],['recovery_hash','TEXT']])if(!columns.includes(column))db.exec(`ALTER TABLE users ADD COLUMN ${column} ${definition}`);
 if(!db.prepare("SELECT value FROM app_meta WHERE key='roles_initialized'").get()){const oldest=db.prepare('SELECT id FROM users ORDER BY rowid LIMIT 1').get();if(oldest){db.prepare("UPDATE users SET role='admin' WHERE id=?").run(oldest.id);db.prepare('INSERT INTO app_meta VALUES(?,?)').run('roles_initialized','1')}}
 const digest=t=>createHash('sha256').update(t).digest('hex');
 const token=req=>(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('noise_session='))?.slice(14)||'';
 const publicUser=u=>({id:u.id,name:u.name,email:u.email,role:u.role,avatar:u.avatar||null,hasRecoveryCode:!!u.recovery_hash});
 const user=req=>{const u=db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(digest(token(req)),Date.now());return u?publicUser(u):null};
 const cookie=(res,value,age)=>res.setHeader('Set-Cookie',`noise_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${process.env.COOKIE_SECURE==='true'?'; Secure':''}`);
 function establish(req,res,id){db.prepare('DELETE FROM sessions WHERE token=? OR expires<=?').run(digest(token(req)),Date.now());const t=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(t),id,Date.now()+ttl);cookie(res,t,ttl/1000)}
 function revoke(id){db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);if(db.prepare("SELECT name FROM sqlite_master WHERE name='push_subscriptions'").get())db.prepare('DELETE FROM push_subscriptions WHERE user_id=?').run(id)}
 const validPassword=p=>typeof p==='string'&&p.length>=8&&p.length<=256;
 const validEmail=e=>typeof e==='string'&&e.length<=254&&/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(e);
 const verify=async(u,password)=>{const candidate=await derive(typeof password==='string'?password:'',u?.salt||'00000000000000000000000000000000',64);return !!u&&timingSafeEqual(candidate,Buffer.from(u.hash,'hex'))};
 async function setPassword(id,password){if(!validPassword(password))throw error(400,'Password must be 8 to 256 characters');const salt=randomBytes(16).toString('hex'),hash=(await derive(password,salt,64)).toString('hex');db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(salt,hash,id);revoke(id)}
 function recovery(id){const code=randomBytes(24).toString('hex');db.prepare('UPDATE users SET recovery_hash=? WHERE id=?').run(digest(code),id);return code}
 const attempts=new Map();
 function rate(req){const now=Date.now(),ip=req.socket.remoteAddress;for(const [key,v]of attempts)if(v.until<now)attempts.delete(key);const entry=attempts.get(ip)||{count:0,until:now+600000};entry.count++;attempts.set(ip,entry);if(entry.count>30)throw error(429,'Too many attempts. Try again in 10 minutes.')}
 async function handle(req,res,url,send){
  if(!url.pathname.startsWith('/api/auth/'))return false;
  const route=url.pathname.slice(10);
  if(req.method==='GET'&&route==='session'){const u=user(req);send(u?200:401,u?{user:u}:{error:'Sign in required'});return true}
  if(req.method!=='POST')throw error(405,'Method not allowed');
  if(req.headers.origin&&!['http://'+req.headers.host,'https://'+req.headers.host].includes(req.headers.origin))throw error(403,'Invalid origin');
  if(route==='logout'){const u=user(req);db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token(req)));if(u&&db.prepare("SELECT name FROM sqlite_master WHERE name='push_subscriptions'").get())db.prepare('DELETE FROM push_subscriptions WHERE user_id=?').run(u.id);cookie(res,'',0);send(204);return true}
  if(!['register','login','reset-password','profile','avatar','password','recovery-code'].includes(route))throw error(404,'Unknown authentication route');
  rate(req);const body=await readBody(req),email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
  if(route==='reset-password'){
   const u=db.prepare('SELECT * FROM users WHERE email=?').get(email),code=typeof body.recoveryCode==='string'?body.recoveryCode.trim():'';
   if(!u?.recovery_hash||!code||digest(code)!==u.recovery_hash)throw error(401,'Email or recovery code is incorrect');
   if(!validPassword(body.password))throw error(400,'Password must be 8 to 256 characters');
   const consumed=db.prepare('UPDATE users SET recovery_hash=NULL WHERE id=? AND recovery_hash=?').run(u.id,u.recovery_hash);if(consumed.changes!==1)throw error(401,'Recovery code already used');
   try{await setPassword(u.id,body.password)}catch(e){db.prepare('UPDATE users SET recovery_hash=? WHERE id=? AND recovery_hash IS NULL').run(u.recovery_hash,u.id);throw e}const recoveryCode=recovery(u.id);send(200,{recoveryCode,message:'Password reset. Save the new recovery code; the previous code is invalid.'});return true;
  }
  if(route==='register'){
   const name=typeof body.name==='string'?body.name.trim():'';
   if(name.length<2||name.length>80||/[<>]/.test(name)||!validEmail(email)||!validPassword(body.password))throw error(400,'Check name, email and password (8 to 256 characters)');
   if(db.prepare('SELECT id FROM users WHERE email=?').get(email))throw error(409,'Email already registered');
   const salt=randomBytes(16).toString('hex'),hash=(await derive(body.password,salt,64)).toString('hex'),id=randomUUID();
   // Select the first administrator after asynchronous hashing, with no await before insertion.
   const role=db.prepare('SELECT id FROM users LIMIT 1').get()?'viewer':'admin';
   try{db.prepare('INSERT INTO users(id,name,email,salt,hash,role) VALUES(?,?,?,?,?,?)').run(id,name,email,salt,hash,role)}catch(e){if(db.prepare('SELECT id FROM users WHERE email=?').get(email))throw error(409,'Email already registered');throw e}
   if(role==='admin')db.prepare('INSERT OR IGNORE INTO app_meta VALUES(?,?)').run('roles_initialized','1');
   const recoveryCode=recovery(id);establish(req,res,id);send(201,{user:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)),recoveryCode});return true;
  }
  if(route==='login'){
   if(!validEmail(email)||!validPassword(body.password))throw error(400,'Valid email and password required');const found=db.prepare('SELECT * FROM users WHERE email=?').get(email);
   if(!await verify(found,body.password))throw error(401,'Invalid email or password');establish(req,res,found.id);send(200,{user:publicUser(found)});return true;
  }
  const current=user(req);if(!current)throw error(401,'Sign in required');let found=db.prepare('SELECT * FROM users WHERE id=?').get(current.id);
  if(route==='profile'){
   const name=typeof body.name==='string'?body.name.trim():'';if(name.length<2||name.length>80||/[<>]/.test(name)||!validEmail(email))throw error(400,'Invalid name or email');
   if(email!==found.email){if(!await verify(found,body.currentPassword))throw error(401,'Current password is incorrect');if(db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(email,found.id))throw error(409,'Email already registered');revoke(found.id);establish(req,res,found.id)}
   db.prepare('UPDATE users SET name=?,email=? WHERE id=?').run(name,email,found.id);
  }else if(route==='avatar'){
   const avatar=body.avatar;if(avatar!==null&&(typeof avatar!=='string'||avatar.length>450000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar)))throw error(400,'Invalid image');db.prepare('UPDATE users SET avatar=? WHERE id=?').run(avatar,found.id);
  }else if(route==='password'){
   if(!await verify(found,body.currentPassword))throw error(401,'Current password is incorrect');await setPassword(found.id,body.newPassword);establish(req,res,found.id);
  }else if(route==='recovery-code'){
   if(!await verify(found,body.currentPassword))throw error(401,'Current password is incorrect');send(200,{recoveryCode:recovery(found.id)});return true;
  }
  send(200,{user:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(found.id))});return true;
 }
 return {user,handle,db,publicUser,recovery,revoke};
}
module.exports={createAuth,readBody,error};
