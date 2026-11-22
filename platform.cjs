'use strict';
const {readBody,error}=require('./auth.cjs');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean=(value,max=120)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[<>"']/.test(value);
function createPlatform(auth,tb,defaultId){
 const db=auth.db;
 db.exec('CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,name TEXT NOT NULL,location TEXT NOT NULL DEFAULT ""); CREATE TABLE IF NOT EXISTS device_members(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,PRIMARY KEY(user_id,device_id)); CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY,ts INTEGER NOT NULL,user_id TEXT,action TEXT NOT NULL,target TEXT NOT NULL);');
 if(!db.prepare("SELECT value FROM app_meta WHERE key='devices_initialized'").get()){
  db.prepare('INSERT OR IGNORE INTO devices(id,name,location) VALUES(?,?,?)').run(defaultId,process.env.THINGSBOARD_DEVICE_NAME||'NAS 01','');
  db.prepare("INSERT INTO app_meta VALUES('devices_initialized','1')").run();
 }
 const log=(u,action,target)=>db.prepare('INSERT INTO audit_log(ts,user_id,action,target) VALUES(?,?,?,?)').run(Date.now(),u.id,action,target);
 const list=u=>u.role==='admin'?db.prepare('SELECT * FROM devices ORDER BY name,id').all():db.prepare('SELECT d.* FROM devices d JOIN device_members m ON d.id=m.device_id WHERE m.user_id=? ORDER BY d.name,d.id').all(u.id);
 function device(u,id,write=false){if(write&&u.role!=='admin')throw error(403,'Administrator access required');const d=list(u).find(d=>d.id===id);if(!d)throw error(403,'Device is not assigned to your account');return d}
 const administrator=u=>{if(u.role!=='admin')throw error(403,'Administrator access required')};
 async function settings(id){const [shared,client]=await Promise.all([tb(`/api/plugins/telemetry/DEVICE/${id}/values/attributes/SHARED_SCOPE`),tb(`/api/plugins/telemetry/DEVICE/${id}/values/attributes/CLIENT_SCOPE`)]);const data=Object.fromEntries(shared.map(a=>[a.key,a.value])),applied=client.find(a=>a.key==='applied_config_version')?.value;return {...data,applied_config_version:applied??null,syncStatus:data.config_version?(String(applied)===String(data.config_version)?'applied':'awaiting-device'):'not-configured'}}
 async function handle(req,res,url,u,send){
  let match;
  if(url.pathname==='/api/admin/users'&&req.method==='GET'){administrator(u);send(200,{users:db.prepare('SELECT id,name,email,role'+(auth.provider==='thingsboard'?',auth_provider AS authProvider,tb_user_id AS thingsboardUserId,tb_authority AS thingsboardAuthority':'')+' FROM users ORDER BY rowid').all().map(row=>({...row,deviceIds:db.prepare('SELECT device_id FROM device_members WHERE user_id=?').all(row.id).map(d=>d.device_id)})),devices:list(u)});return true}
  if((match=url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/))&&req.method==='PATCH'){
   administrator(u);const target=db.prepare('SELECT * FROM users WHERE id=?').get(match[1]);if(!target)throw error(404,'User not found');const b=await readBody(req);
   if(!['admin','viewer'].includes(b.role)||!Array.isArray(b.deviceIds)||b.deviceIds.some(id=>!db.prepare('SELECT id FROM devices WHERE id=?').get(id)))throw error(400,'Invalid role or device assignment');
   if(auth.provider==='thingsboard'&&target.auth_provider==='thingsboard'&&b.role!==(target.tb_authority==='TENANT_ADMIN'?'admin':'viewer'))throw error(400,'NAS roles follow ThingsBoard authority. Change administrative authority in ThingsBoard.');
   if(auth.assignDevices&&target.auth_provider==='thingsboard')await auth.assignDevices(req,target,b.deviceIds);
   if(target.role==='admin'&&b.role!=='admin'&&db.prepare("SELECT count(*) AS n FROM users WHERE role='admin'").get().n<=1)throw error(409,'At least one administrator is required');
   db.exec('BEGIN');try{db.prepare('UPDATE users SET role=? WHERE id=?').run(b.role,target.id);db.prepare('DELETE FROM device_members WHERE user_id=?').run(target.id);for(const id of new Set(b.deviceIds))db.prepare('INSERT INTO device_members VALUES(?,?)').run(target.id,id);auth.revoke(target.id);log(u,'user.permissions',target.id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}send(200,{message:'Permissions saved. User must sign in again.'});return true;
  }
  if((match=url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/recovery-code$/))&&req.method==='POST'){administrator(u);if(!db.prepare('SELECT id FROM users WHERE id=?').get(match[1]))throw error(404,'User not found');const code=auth.recovery(match[1]);auth.revoke(match[1]);log(u,'user.recovery',match[1]);send(200,{recoveryCode:code});return true}
  if(url.pathname==='/api/thingsboard/devices'&&req.method==='POST'){
   if(auth.provider!=='thingsboard')administrator(u);
   const b=await readBody(req);if(!clean(b.name)||typeof b.location!=='string'||b.location.length>200||/[<>"']/.test(b.location))throw error(400,'Valid name and location required');let id=b.id||'';
   if(id){if(!uuid.test(id))throw error(400,'ThingsBoard Device ID must be a UUID');if(u.role!=='admin'&&auth.connectCustomerDevice){try{await tb(`/api/device/${id}`);await tb(`/api/plugins/telemetry/DEVICE/${id}/values/timeseries?keys=sound_db`)}catch(e){if(e.status!==403)throw e;await auth.connectCustomerDevice(req,id)}}else await tb(`/api/device/${id}`)}else{if(u.role!=='admin'&&!auth.createCustomerDevice)throw error(403,'Cloud account required to create a device');const created=u.role!=='admin'?await auth.createCustomerDevice(req,b.name.trim()):await tb('/api/device',{method:'POST',body:{name:b.name.trim(),type:'Noise Awareness'}});id=created.id.id}
   const existing=db.prepare('SELECT * FROM devices WHERE id=?').get(id);if(existing&&(u.role==='admin'||db.prepare('SELECT 1 FROM device_members WHERE user_id=? AND device_id=?').get(u.id,id)))throw error(409,'Device already connected');db.exec('BEGIN');try{if(!existing)db.prepare('INSERT INTO devices VALUES(?,?,?)').run(id,b.name.trim(),b.location.trim());if(u.role!=='admin')db.prepare('INSERT INTO device_members VALUES(?,?)').run(u.id,id);log(u,'device.connect',id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}send(201,existing||{id,name:b.name.trim(),location:b.location.trim()});return true;
  }
  if((match=url.pathname.match(/^\/api\/thingsboard\/devices\/([^/]+)$/))){const d=device(u,match[1],auth.provider!=='thingsboard');
   if(auth.provider==='thingsboard'&&u.role!=='admin'&&req.method==='PATCH')await tb('/api/device/'+d.id);
   if(req.method==='PATCH'){const b=await readBody(req);if(!clean(b.name)||typeof b.location!=='string'||b.location.length>200||/[<>"']/.test(b.location))throw error(400,'Invalid name or location');db.prepare('UPDATE devices SET name=?,location=? WHERE id=?').run(b.name.trim(),b.location.trim(),d.id);log(u,'device.update',d.id);send(200,{...d,name:b.name.trim(),location:b.location.trim()});return true}
   if(req.method==='DELETE'){if(u.role!=='admin')db.prepare('DELETE FROM device_members WHERE user_id=? AND device_id=?').run(u.id,d.id);else db.prepare('DELETE FROM devices WHERE id=?').run(d.id);log(u,'device.disconnect',d.id);send(204);return true}
  }
  if(url.pathname==='/api/thingsboard/settings'){
   const d=device(u,url.searchParams.get('deviceId'),auth.provider!=='thingsboard'&&req.method!=='GET');
   if(req.method==='GET'){send(200,await settings(d.id));return true}
   if(req.method==='PUT'){const b=await readBody(req),input=b.noise_limit??b.soundLevelThreshold,threshold=Number(input);if((typeof input!=='number'&&typeof input!=='string')||String(input).trim()===''||!Number.isFinite(threshold)||threshold<0||threshold>140)throw error(400,'Check noise_limit (0 to 140 dB)');
    const config={noise_limit:threshold,config_version:Date.now()};const save=()=>tb(`/api/plugins/telemetry/DEVICE/${d.id}/attributes/SHARED_SCOPE`,{method:'POST',body:config});try{await save()}catch(e){if(e.status!==403||!auth.enableDeviceSettings)throw e;await auth.enableDeviceSettings(req,d.id);await save()}const persisted=await settings(d.id);if(String(persisted.config_version)!==String(config.config_version)||Number(persisted.noise_limit)!==config.noise_limit)throw error(502,'ThingsBoard accepted the write, but read-back verification did not match. Reload Settings to inspect the saved values.');log(u,'settings.save',d.id);send(200,{...config,syncStatus:persisted.syncStatus,verified:true,message:persisted.syncStatus==='applied'?'Saved and read back from ThingsBoard; device confirmed configuration.':'Saved and read back from ThingsBoard shared attributes; awaiting device acknowledgement.'});return true;
   }
  }
  return false;
 }
 return {list,device,handle,settings};
}
module.exports={createPlatform};
