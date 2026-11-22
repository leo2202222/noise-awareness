'use strict';
const webpush=require('web-push');
const {readBody,error}=require('./auth.cjs');
function createPush(auth,platform,snapshot){
 const db=auth.db;db.exec('CREATE TABLE IF NOT EXISTS push_subscriptions(endpoint TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,payload TEXT NOT NULL,expires INTEGER NOT NULL);');
 let keys=db.prepare("SELECT value FROM app_meta WHERE key='vapid_keys'").get();keys=keys?JSON.parse(keys.value):webpush.generateVAPIDKeys();db.prepare('INSERT OR IGNORE INTO app_meta VALUES(?,?)').run('vapid_keys',JSON.stringify(keys));
 const provider=endpoint=>{try{const u=new URL(endpoint);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&['fcm.googleapis.com','updates.push.services.mozilla.com','push.services.mozilla.com','web.push.apple.com','notify.windows.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h))}catch{return false}};
 async function deliver(subscription,payload){return webpush.sendNotification(JSON.parse(subscription.payload),JSON.stringify(payload),{TTL:120,timeout:10000,vapidDetails:{subject:process.env.VAPID_SUBJECT||'https://localhost:3000',publicKey:keys.publicKey,privateKey:keys.privateKey}})}
 async function handle(req,res,url,u,send){
  if(url.pathname==='/api/push/config'&&req.method==='GET'){send(200,{enabled:true,vapidPublicKey:keys.publicKey,subscribeUrl:'/api/push/subscribe'});return true}
  if(url.pathname==='/api/push/subscribe'&&req.method==='POST'){const b=await readBody(req,10000);if(!provider(b.endpoint)||typeof b.keys?.p256dh!=='string'||!/^[-_A-Za-z0-9]{80,100}$/.test(b.keys.p256dh)||typeof b.keys?.auth!=='string'||!/^[-_A-Za-z0-9]{20,30}$/.test(b.keys.auth))throw error(400,'Invalid push subscription');db.prepare('INSERT INTO push_subscriptions VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,payload=excluded.payload,expires=excluded.expires').run(b.endpoint,u.id,JSON.stringify({endpoint:b.endpoint,keys:b.keys}),Date.now()+7*86400000);send(201,{message:'Background notifications enabled while the server is running.'});return true}
  if(url.pathname==='/api/push/subscribe'&&req.method==='DELETE'){db.prepare('DELETE FROM push_subscriptions WHERE user_id=?').run(u.id);send(204);return true}
  if(url.pathname==='/api/push/test'&&req.method==='POST'){const rows=db.prepare('SELECT * FROM push_subscriptions WHERE user_id=? AND expires>?').all(u.id,Date.now());if(!rows.length)throw error(409,'Enable notifications in this browser first');try{await Promise.all(rows.map(async row=>{try{await deliver(row,{title:'Noise Awareness',body:'Server push test: this message was sent by the backend.',url:'./index.html#events',tag:'server-push-test'})}catch(e){if(e.statusCode===404||e.statusCode===410)db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(row.endpoint);throw e}}))}catch(e){throw error(502,e.statusCode===404||e.statusCode===410?'Push subscription expired. Turn notifications off and on again.':e.statusCode===401||e.statusCode===403?'Push provider rejected the server key. Turn notifications off and on again; check VAPID_SUBJECT.':'Push service could not deliver the test. Browser alerts can still work while the page is open.')}send(200,{message:'Test delivered to push service.'});return true}
  return false;
 }
 let running=false;
 async function poll(){if(running)return;running=true;try{
  db.prepare('DELETE FROM push_subscriptions WHERE expires<=?').run(Date.now());
  const rows=db.prepare('SELECT p.* FROM push_subscriptions p WHERE EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=p.user_id AND s.expires>?)').all(Date.now());
  for(const userId of new Set(rows.map(row=>row.user_id))){
   const initial=db.prepare('SELECT id,role FROM users WHERE id=?').get(userId);if(!initial)continue;
   for(const configured of platform.list(initial)){try{
    const read=()=>snapshot(configured.id),data=await (auth.runForUser?auth.runForUser(userId,read):read()),reading=data.current;if(!reading)continue;
    const cursor='push_cursor:'+userId+':'+configured.id,previous=db.prepare('SELECT value FROM app_meta WHERE key=?').get(cursor);
    const currentStatus=reading.notificationStatus??reading.alertStatus,limit=data.threshold??null,state=JSON.stringify({ts:reading.ts,status:currentStatus,limit});
    if(currentStatus==='Unknown')continue;
    let prior;try{prior=previous?JSON.parse(previous.value):null}catch{prior={ts:Number(previous.value)}}if(typeof prior==='number')prior={ts:prior};if(prior&&reading.ts<=prior.ts&&prior.limit===limit)continue;
    if(currentStatus==='Alert'&&(prior?.status!=='Alert'||Date.now()-Number(prior?.ts)>60000||prior.limit!==limit)&&Date.now()-reading.ts<60000&&reading.ts<=Date.now()+5000){
     const current=db.prepare('SELECT id,role FROM users WHERE id=?').get(userId);
     if(current&&platform.list(current).some(device=>device.id===configured.id))for(const row of rows.filter(row=>row.user_id===userId)){
      if(!db.prepare('SELECT endpoint FROM push_subscriptions WHERE endpoint=?').get(row.endpoint)||!db.prepare('SELECT token FROM sessions WHERE user_id=? AND expires>? LIMIT 1').get(userId,Date.now()))continue;
      try{await deliver(row,{title:'Noise alert',body:configured.name+': '+reading.approximateSoundLevel.toFixed(1)+' dB',url:'./index.html#events',eventId:configured.id+':'+reading.ts,tag:'noise:'+configured.id+':'+reading.ts})}catch(e){if(e.statusCode===404||e.statusCode===410)db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(row.endpoint);else console.warn('Push delivery failed:',e.statusCode||'network')}
     }
    }
    db.prepare('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(cursor,state);
   }catch(e){console.warn('Background telemetry check failed:',e.status||'upstream')}}
  }
 }finally{running=false}}
 return {handle,poll};
}
module.exports={createPush};
