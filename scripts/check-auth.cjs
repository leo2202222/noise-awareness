'use strict';
// Legacy-provider regression: runtime defaults to ThingsBoard.
process.env.AUTH_PROVIDER='local';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'noise-auth-check-'));
process.env.AUTH_DB_PATH=path.join(folder,'auth.sqlite');
const {server}=require('../server.cjs');
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const request=(p,method='GET',body,cookie,origin)=>fetch(base+p,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(origin?{Origin:origin}:{})},body:body?JSON.stringify(body):undefined});
 assert.equal((await request('/api/thingsboard/snapshot')).status,401);
 assert.equal((await request('/api/auth/session')).status,401);
 const account={name:'Test User',email:'test@example.com',password:'test-password-123'};
 assert.equal((await request('/api/auth/register','POST',account,null,'https://other.example')).status,403);
 const created=await request('/api/auth/register','POST',account);assert.equal(created.status,201);const header=created.headers.get('set-cookie');assert.ok(header.includes('HttpOnly'));assert.ok(header.includes('SameSite=Strict'));const cookie=header.split(';')[0];assert.equal((await request('/api/auth/session','GET',null,cookie)).status,200);
 const publicData=await (await request('/api/auth/session','GET',null,cookie)).json();assert.equal(publicData.user.email,account.email);assert.equal(publicData.user.hash,undefined);
 assert.equal((await request('/api/auth/register','POST',account)).status,409);
 assert.equal((await request('/api/auth/login','POST',{...account,password:'wrong-password'})).status,401);
 const login=await request('/api/auth/login','POST',account,cookie);assert.equal(login.status,200);const newCookie=login.headers.get('set-cookie').split(';')[0];assert.notEqual(cookie,newCookie);assert.equal((await request('/api/auth/session','GET',null,cookie)).status,401);
 assert.equal((await request('/api/auth/reset-password','POST',account)).status,401);
 assert.equal((await request('/api/auth/logout','POST',null,newCookie)).status,204);assert.equal((await request('/api/auth/session','GET',null,newCookie)).status,401);assert.equal((await request('/api/thingsboard/snapshot','GET',null,newCookie)).status,401);
 console.log('PASS: registration, duplicate email, password verification, session rotation, cookie flags, logout, cross-origin protection, anonymous API denial, email-only reset denied');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close(()=>{try{const {createAuth}=require('../backend/auth.cjs');const reopened=createAuth(process.env.AUTH_DB_PATH);const row=reopened.db.prepare('SELECT * FROM users WHERE email=?').get('test@example.com');assert.ok(row);assert.notEqual(row.hash,'test-password-123');assert.equal(reopened.db.prepare('SELECT count(*) AS total FROM sessions').get().total,0);reopened.db.close();console.log('PASS: accounts persist after reopening database; password is hashed; logged-out sessions stay invalid');}catch(error){console.error(error);process.exitCode=1}finally{for(const file of fs.readdirSync(folder))fs.unlinkSync(path.join(folder,file));fs.rmdirSync(folder);}}));
