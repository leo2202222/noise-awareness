'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {randomBytes,createHash,createCipheriv,createDecipheriv,timingSafeEqual,scrypt}=require('node:crypto');
const {promisify}=require('node:util'),fs=require('node:fs'),path=require('node:path');
const legacy=require('./auth-local.cjs'),{createThingsBoardClient}=require('./thingsboard-client.cjs');
const derive=promisify(scrypt),{error,readBody}=legacy,ttl=7*86400000;
function createThingsBoardAuth(filename,options={}){
 const store=legacy.createAuth(filename),db=store.db,context=new AsyncLocalStorage(),client=options.client||createThingsBoardClient(options),refreshing=new Map();
 const columns=db.prepare('PRAGMA table_info(users)').all().map(c=>c.name);
 for(const [name,type]of [['auth_provider',"TEXT NOT NULL DEFAULT 'local'"],['tb_user_id','TEXT'],['tb_tenant_id','TEXT'],['tb_customer_id','TEXT'],['tb_authority','TEXT']])if(!columns.includes(name))db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
 db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_tb_id ON users(tb_user_id) WHERE tb_user_id IS NOT NULL; CREATE TABLE IF NOT EXISTS tb_sessions(token TEXT PRIMARY KEY REFERENCES sessions(token) ON DELETE CASCADE,access_token TEXT NOT NULL,refresh_token TEXT NOT NULL,access_expires INTEGER NOT NULL);');
 let encryptionKey;
 if(process.env.SESSION_ENCRYPTION_KEY){encryptionKey=Buffer.from(process.env.SESSION_ENCRYPTION_KEY,'base64');if(encryptionKey.length!==32)throw error(503,'SESSION_ENCRYPTION_KEY must be 32 bytes encoded as base64.');}
 else if(filename===':memory:')encryptionKey=randomBytes(32);
 else{const keyFile=path.join(path.dirname(filename||path.join(__dirname,'data','auth.sqlite')),'tb-session.key');try{encryptionKey=fs.readFileSync(keyFile)}catch(e){if(e.code!=='ENOENT')throw e;const candidate=randomBytes(32);try{fs.writeFileSync(keyFile,candidate,{flag:'wx',mode:0o600})}catch(e){if(e.code!=='EEXIST')throw e}encryptionKey=fs.readFileSync(keyFile)}if(encryptionKey.length!==32)throw error(503,'Invalid server session encryption key.');}
 const digest=t=>createHash('sha256').update(t).digest('hex');
 const encrypt=value=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey,iv),payload=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),payload]).toString('base64')};
 const decrypt=value=>{const raw=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',encryptionKey,raw.subarray(0,12));cipher.setAuthTag(raw.subarray(12,28));return Buffer.concat([cipher.update(raw.subarray(28)),cipher.final()]).toString('utf8')};
 const sessionSecret=(value,hash)=>{try{return decrypt(value)}catch{db.prepare('DELETE FROM sessions WHERE token=?').run(hash);throw error(401,'Session encryption state changed. Sign in again.')}};
 const hashFor=req=>digest((req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('noise_session='))?.slice(14)||'');
 const rowFor=hash=>db.prepare('SELECT s.user_id,s.expires,t.* FROM sessions s JOIN tb_sessions t ON t.token=s.token JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.auth_provider=?').get(hash,Date.now(),'thingsboard');
 const role=u=>u.authority==='TENANT_ADMIN'?'admin':'viewer';
 const publicUser=u=>({id:u.id,name:u.name,email:u.email,role:u.role,avatar:u.avatar||null,authProvider:'thingsboard',thingsboardUserId:u.tb_user_id,hasRecoveryCode:false});
 const localUser=id=>db.prepare('SELECT * FROM users WHERE id=? AND auth_provider=?').get(id,'thingsboard');
 const user=req=>{const s=rowFor(hashFor(req));return s?publicUser(localUser(s.user_id)):null};
 const validateEmail=email=>typeof email==='string'&&email.length<=254&&/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email);
 const validPassword=p=>typeof p==='string'&&p.length>=8&&p.length<=256;
 const expiration=token=>{try{const e=JSON.parse(Buffer.from(token.split('.')[1],'base64url')).exp;return Number.isFinite(e)?e*1000:Date.now()+30000}catch{return Date.now()+30000}};
 const cookie=(res,value,age)=>res.setHeader('Set-Cookie',`noise_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${(process.env.COOKIE_SECURE==='true'||process.env.NODE_ENV==='production')?'; Secure':''}`);
 function revoke(id){store.revoke(id)}
 async function upsert(remote,proof){
  const mapped=db.prepare('SELECT * FROM users WHERE tb_user_id=?').get(remote.id.id),email=remote.email.trim().toLowerCase();let local=mapped||db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if(local&&!mapped&&local.auth_provider==='local'){
   const candidate=proof?await derive(proof,local.salt,64):null;
   if(!candidate||!local.hash||!timingSafeEqual(candidate,Buffer.from(local.hash,'hex')))throw error(409,'A legacy NAS account uses this email. Verify its old password during migration, or have the local administrator link the identities.');
  }
  if(mapped){const conflict=db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(email,mapped.id);if(conflict)throw error(409,'Cloud email conflicts with a preserved legacy identity; contact the local administrator.');}
  const name=[remote.firstName,remote.lastName].filter(Boolean).join(' ').trim()||email,avatar=remote.additionalInfo?.nasV2?.avatar||null;
  if(local){db.prepare('UPDATE users SET name=?,email=?,role=?,avatar=?,auth_provider=?,tb_user_id=?,tb_tenant_id=?,tb_customer_id=?,tb_authority=? WHERE id=?').run(name,email,role(remote),avatar,'thingsboard',remote.id.id,remote.tenantId.id,remote.customerId?.id||null,remote.authority,local.id);}
  else{const id='tb_'+remote.id.id;db.prepare('INSERT INTO users(id,name,email,salt,hash,role,avatar,auth_provider,tb_user_id,tb_tenant_id,tb_customer_id,tb_authority) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,name,email,'','',role(remote),avatar,'thingsboard',remote.id.id,remote.tenantId.id,remote.customerId?.id||null,remote.authority);local={id};}
  return localUser(local.id);
 }
 function establish(req,res,u,tokens){if(!tokens?.token||!tokens?.refreshToken)throw error(503,'ThingsBoard did not return a complete token pair.');const opaque=randomBytes(32).toString('hex'),hash=digest(opaque);db.exec('BEGIN');try{db.prepare('DELETE FROM sessions WHERE token=? OR expires<=?').run(hashFor(req),Date.now());db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash,u.id,Date.now()+ttl);db.prepare('INSERT INTO tb_sessions VALUES(?,?,?,?)').run(hash,encrypt(tokens.token),encrypt(tokens.refreshToken),expiration(tokens.token));db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}cookie(res,opaque,ttl/1000);return hash}
 async function accessToken(hash){let s=rowFor(hash);if(!s)throw error(401,'Sign in with your ThingsBoard account.');
  if(s.access_expires>Date.now()+30000)return sessionSecret(s.access_token,hash);
  if(!refreshing.has(hash))refreshing.set(hash,(async()=>{try{const pair=await client.request('/api/auth/token',{method:'POST',body:{refreshToken:sessionSecret(s.refresh_token,hash)}});if(!pair?.token||!pair.refreshToken)throw error(401,'ThingsBoard session expired. Sign in again.');db.prepare('UPDATE tb_sessions SET access_token=?,refresh_token=?,access_expires=? WHERE token=?').run(encrypt(pair.token),encrypt(pair.refreshToken),expiration(pair.token),hash);return pair.token}catch(e){if(e.status===401||e.status===403){db.prepare('DELETE FROM sessions WHERE token=?').run(hash);throw error(401,'ThingsBoard session expired. Sign in again.')}throw e}finally{refreshing.delete(hash)}})());return refreshing.get(hash);
 }
 async function validateHash(hash){const token=await accessToken(hash);let remote;try{remote=await client.identity(token)}catch(e){if(e.status===401||e.status===403)db.prepare('DELETE FROM sessions WHERE token=?').run(hash);throw e}const s=rowFor(hash);if(!s||localUser(s.user_id)?.tb_user_id!==remote.id.id)throw error(401,'Session identity changed. Sign in again.');return publicUser(await upsert(remote));}
 const validate=req=>validateHash(hashFor(req));
 async function requestAsHash(hash,route,options={}){const token=await accessToken(hash);try{return await client.request(route,{...options,token})}catch(e){if(e.status===401){db.prepare('DELETE FROM sessions WHERE token=?').run(hash);throw error(401,'ThingsBoard session expired. Sign in again.')}if(e.status===403)throw error(403,'ThingsBoard has not granted your account access to this device or operation.');throw e}}
 function apiRequest(route,options={}){const scope=context.getStore();return scope?.hash?requestAsHash(scope.hash,route,options):client.request(route,{...options,service:true})}
 const runRequest=(req,fn)=>context.run({hash:hashFor(req)},fn);
 async function runForUser(id,fn){const s=db.prepare('SELECT s.token FROM sessions s JOIN tb_sessions t ON s.token=t.token WHERE s.user_id=? AND s.expires>? ORDER BY s.expires DESC LIMIT 1').get(id,Date.now());if(!s)throw error(401,'No active ThingsBoard session.');return context.run({hash:s.token},async()=>{await validateHash(s.token);return fn()})}
 const scopeId=()=>context.getStore()?.hash||'service';
 async function assignDevices(req,target,deviceIds){
  if(target.tb_authority==='TENANT_ADMIN')return;
  if(process.env.THINGSBOARD_GROUP_SHARING!=='true'){
   for(const deviceId of deviceIds)await runForUser(target.id,()=>apiRequest('/api/plugins/telemetry/DEVICE/'+deviceId+'/values/timeseries?keys=sound_db'));
   return;
  }
  const current=await validate(req);if(current.role!=='admin')throw error(403,'Tenant administrator required.');
  const hash=hashFor(req);const remoteTarget=await requestAsHash(hash,'/api/user/'+target.tb_user_id);if(remoteTarget.tenantId?.id!==target.tb_tenant_id||remoteTarget.customerId?.id!==target.tb_customer_id||remoteTarget.authority!==target.tb_authority)throw error(409,'Cloud user ownership or authority changed. Ask the user to sign in again before changing access.');const key='cloud-grant:'+target.tb_user_id,stored=db.prepare('SELECT value FROM app_meta WHERE key=?').get(key);let group=stored?JSON.parse(stored.value):null;
  const invoke=(route,body,method='POST')=>requestAsHash(hash,route,{method,...(body===undefined?{}:{body})});
  if(!group){
   if(!deviceIds.length)return;
   const registered=db.prepare('SELECT value FROM app_meta WHERE key=?').get('cloud-registration-group:'+target.tb_user_id);const userGroup=registered?{id:{id:registered.value}}:await invoke('/api/entityGroup',{name:'NAS V2 User '+target.tb_user_id,type:'USER',ownerId:{id:target.tb_customer_id,entityType:'CUSTOMER'},additionalInfo:{nasV2Managed:true}});
   const deviceGroup=await invoke('/api/entityGroup',{name:'NAS V2 Devices '+target.tb_user_id,type:'DEVICE',ownerId:{id:target.tb_tenant_id,entityType:'TENANT'},additionalInfo:{nasV2Managed:true}});
   const readRole=await invoke('/api/role',{name:'NAS V2 Read '+target.tb_user_id,type:'GROUP',permissions:['READ','READ_ATTRIBUTES','READ_TELEMETRY']});
   group={userGroup:userGroup.id.id,deviceGroup:deviceGroup.id.id,role:readRole.id.id,members:[]};
   db.prepare('INSERT INTO app_meta(key,value) VALUES(?,?)').run(key,JSON.stringify(group));
   await invoke('/api/entityGroup/'+group.userGroup+'/addEntities',[target.tb_user_id]);
  }
  const desired=[...new Set(deviceIds)],removed=group.members.filter(id=>!desired.includes(id)),added=desired.filter(id=>!group.members.includes(id));
  if(removed.length)await invoke('/api/entityGroup/'+group.deviceGroup+'/deleteEntities',removed);
  if(added.length)await invoke('/api/entityGroup/'+group.deviceGroup+'/addEntities',added);
  group.members=desired;db.prepare('UPDATE app_meta SET value=? WHERE key=?').run(JSON.stringify(group),key);
  if(desired.length&&!group.permission){const permission=await invoke('/api/groupPermission',{userGroupId:{id:group.userGroup,entityType:'ENTITY_GROUP'},entityGroupId:{id:group.deviceGroup,entityType:'ENTITY_GROUP'},roleId:{id:group.role,entityType:'ROLE'}});group.permission=permission.id.id;db.prepare('UPDATE app_meta SET value=? WHERE key=?').run(JSON.stringify(group),key);}
 }
 async function createCustomerDevice(req,name,existingId,writeAttributes=false){
  const user=await validate(req),target=localUser(user.id);
  if(target.tb_authority!=='CUSTOMER_USER'||!target.tb_customer_id)throw error(403,'Customer account required.');
  if(process.env.THINGSBOARD_GROUP_SHARING!=='true')throw error(409,'Customer device creation requires Cloud entity-group sharing.');
  const owned=[],post=(route,body)=>client.request(route,{method:'POST',body,service:true});
  const record=(kind,value)=>{owned.push({kind,id:value.id.id});return value};
  try{
   const device=existingId?await client.request('/api/device/'+existingId,{service:true}):record('device',await post('/api/device',{name,type:'Noise Awareness',customerId:{id:target.tb_customer_id,entityType:'CUSTOMER'}}));
   if(device.customerId?.id!==target.tb_customer_id||device.tenantId?.id!==target.tb_tenant_id)throw error(403,'This device belongs to a different customer.');
   const group=async(type,name)=>{
    const route='/api/entityGroup/CUSTOMER/'+target.tb_customer_id+'/'+type+'/'+encodeURIComponent(name);
    const lookup=()=>client.request(route,{service:true});let found;
    try{found=await lookup()}catch(e){if(e.upstreamStatus!==404)throw e}
    if(!found)try{found=record('entityGroup',await post('/api/entityGroup',{name,type,ownerId:{id:target.tb_customer_id,entityType:'CUSTOMER'},additionalInfo:{nasV2Managed:true}}))}catch(e){if(e.upstreamStatus!==400||!/already|exist|duplicate/i.test(e.remoteMessage||''))throw e;found=await lookup()}
    if(found.ownerId?.id!==target.tb_customer_id||found.type!==type||found.additionalInfo?.nasV2Managed!==true)throw error(409,'Connection group ownership does not match this account.');return found;
   };
   const suffix=target.tb_user_id+' '+device.id.id;
   const userGroup=await group('USER','NAS Owner '+suffix);
   const deviceGroup=await group('DEVICE',(writeAttributes?'NAS Settings Device ':'NAS Device ')+suffix);
   await post('/api/entityGroup/'+userGroup.id.id+'/addEntities',[target.tb_user_id]);
   await post('/api/entityGroup/'+deviceGroup.id.id+'/addEntities',[device.id.id]);
   const grants=await client.request('/api/userGroup/'+userGroup.id.id+'/groupPermissions',{service:true});
   if(!grants.some(p=>p.entityGroupId?.id===deviceGroup.id.id)){
    const readRole=record('role',await post('/api/role',{name:(writeAttributes?'NAS Settings ':'NAS Read ')+device.id.id+' '+randomBytes(8).toString('hex'),type:'GROUP',permissions:['READ','READ_ATTRIBUTES','READ_TELEMETRY',...(writeAttributes?['WRITE_ATTRIBUTES']:[])]}));
    record('groupPermission',await post('/api/groupPermission',{userGroupId:{id:userGroup.id.id,entityType:'ENTITY_GROUP'},entityGroupId:{id:deviceGroup.id.id,entityType:'ENTITY_GROUP'},roleId:{id:readRole.id.id,entityType:'ROLE'}}));
   }
   await requestAsHash(hashFor(req),'/api/plugins/telemetry/DEVICE/'+device.id.id+'/values/timeseries?keys=sound_db');
   const resourceKey=(writeAttributes?'cloud-settings-device:'+target.tb_user_id+':':existingId?'cloud-connected-device:'+target.tb_user_id+':':'cloud-created-device:')+device.id.id;let priorResources=[];try{priorResources=JSON.parse(db.prepare('SELECT value FROM app_meta WHERE key=?').get(resourceKey)?.value||'{}').resources||[]}catch{}const resources=[...new Map([...priorResources,...owned].map(r=>[r.kind+':'+r.id,r])).values()];
   db.prepare('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(resourceKey,JSON.stringify({userId:target.tb_user_id,resources}));
   return device;
  }catch(e){if(e.operation){let detail=String(e.remoteMessage||'').slice(0,300);for(const secret of [process.env.THINGSBOARD_API_KEY,process.env.THINGSBOARD_ADMIN_API_KEY])if(secret)detail=detail.replaceAll(secret,'[redacted]');console.error('Device connection failed:',JSON.stringify({operation:e.operation,status:e.upstreamStatus,detail}));if(e.upstreamStatus===400)e.message=e.operation==='/api/device'&&/already|exist|duplicate/i.test(detail)?'A device with this name already exists. Enter its Device ID to connect it.':'ThingsBoard rejected the connection setup. Please retry; the existing device has not been deleted.';else if(e.upstreamStatus===404)e.message='ThingsBoard could not find the device or a required API resource.';else if(e.upstreamStatus===429)e.message='ThingsBoard request limit reached. Please try again later.';}const failed=[];for(const item of owned.reverse())try{await client.request('/api/'+item.kind+'/'+item.id,{method:'DELETE',service:true})}catch{failed.push(item)}if(failed.length)db.prepare('INSERT OR REPLACE INTO app_meta(key,value) VALUES(?,?)').run('cloud-device-cleanup:'+Date.now(),JSON.stringify(failed));throw e}
 }
 const attempts=new Map();function limit(req){const now=Date.now(),ip=req.socket.remoteAddress;for(const[k,v]of attempts)if(v.until<now)attempts.delete(k);const r=attempts.get(ip)||{n:0,until:now+600000};r.n++;attempts.set(ip,r);if(r.n>30)throw error(429,'Too many attempts. Try again in 10 minutes.')}
 async function handle(req,res,url,send){
  if(!url.pathname.startsWith('/api/auth/'))return false;const route=url.pathname.slice(10);
  if(req.method==='GET'&&route==='session'){try{const u=await validate(req);send(200,{user:u,provider:'thingsboard'})}catch(e){if(e.status===401){cookie(res,'',0);send(401,{error:e.message,provider:'thingsboard'})}else throw e}return true}
  if(req.method!=='POST')throw error(405,'Method not allowed');if(req.headers.origin&&!['http://'+req.headers.host,'https://'+req.headers.host].includes(req.headers.origin))throw error(403,'Invalid origin');
  if(process.env.NODE_ENV==='production'&&!req.socket.encrypted&&!(process.env.TRUST_PROXY==='true'&&req.headers['x-forwarded-proto']==='https'))throw error(400,'HTTPS is required for authentication.');
  if(route==='logout'){const hash=hashFor(req),session=rowFor(hash);try{if(session)await client.request('/api/auth/logout',{method:'POST',token:await accessToken(hash)})}catch{}finally{if(session)revoke(session.user_id);else db.prepare('DELETE FROM sessions WHERE token=?').run(hash);cookie(res,'',0)}send(204);return true}
  limit(req);const b=await readBody(req),email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
  if(['login','register'].includes(route)){
   if(!validateEmail(email)||typeof b.password!=='string'||b.password.length<1||b.password.length>256||route==='register'&&!validPassword(b.password))throw error(400,'Enter a valid email and password. New passwords must have at least 8 characters.');
   if(route==='register'){
    if(b.confirmPassword!==b.password)throw error(400,'Passwords do not match.');if(b.role||b.authority||b.customerId||b.tenantId)throw error(400,'Account privileges are assigned by the server.');const name=typeof b.name==='string'?b.name.trim():'';if(name.length<2||name.length>80||/[<>]/.test(name))throw error(400,'Enter a valid name.');
    const existing=db.prepare('SELECT * FROM users WHERE email=?').get(email);if(existing?.auth_provider==='thingsboard')throw error(409,'Email already registered.');if(existing?.auth_provider==='local'){const proof=await derive(b.password,existing.salt,64);if(!timingSafeEqual(proof,Buffer.from(existing.hash,'hex')))throw error(409,'A legacy account exists. Use its current password to migrate or ask the administrator to link it.');}
    const result=await client.register({name,email,password:b.password}),local=await upsert(result.user,b.password);if(result.registrationGroupId)db.prepare('INSERT OR REPLACE INTO app_meta(key,value) VALUES(?,?)').run('cloud-registration-group:'+result.user.id.id,result.registrationGroupId);establish(req,res,local,result.tokens);send(201,{user:publicUser(local),provider:'thingsboard',activated:true});return true;
   }
   let tokens;try{tokens=await client.request('/api/auth/login',{method:'POST',body:{username:email,password:b.password}})}catch(e){if(e.status===401)throw error(401,'Email or ThingsBoard password is incorrect. Legacy accounts must be migrated first.');throw e}
   const remote=await client.identity(tokens.token),local=await upsert(remote,b.password);establish(req,res,local,tokens);send(200,{user:publicUser(local),provider:'thingsboard'});return true;
  }
  if(route==='reset-password'){
   // Existing NAS recovery hashes cannot authorize changes to a cloud password.
   if(!b.resetToken||!validPassword(b.password))throw error(400,'Use a ThingsBoard-issued reset token. Legacy NAS recovery codes apply only to the preserved local provider.');const result=await client.request('/api/noauth/resetPassword',{method:'POST',body:{resetToken:b.resetToken,password:b.password}});let resetUser;if(result?.token)resetUser=await client.identity(result.token);else{let pair;try{pair=await client.request('/api/auth/login',{method:'POST',body:{username:email,password:b.password}});resetUser=await client.identity(pair.token)}catch{throw error(400,'The password was reset in ThingsBoard. Sign in with the email belonging to the reset token.')}}const local=db.prepare('SELECT id FROM users WHERE tb_user_id=?').get(resetUser.id.id);if(local)revoke(local.id);send(200,{message:'ThingsBoard password reset. Sign in with your new password.'});return true;
  }
  const u=await validate(req),hash=hashFor(req),remote=await client.identity(await accessToken(hash));
  if(route==='password'){if(!validPassword(b.newPassword)||typeof b.currentPassword!=='string'||!b.currentPassword||b.currentPassword.length>256)throw error(400,'Check current and new passwords.');try{await requestAsHash(hash,'/api/auth/changePassword',{method:'POST',body:{currentPassword:b.currentPassword,newPassword:b.newPassword}})}catch(e){if(e.status===403)throw error(403,'Your ThingsBoard role lacks PROFILE WRITE for password changes. Ask a tenant administrator.');throw e}const pair=await client.request('/api/auth/login',{method:'POST',body:{username:remote.email,password:b.newPassword}});revoke(u.id);const local=await upsert(await client.identity(pair.token));establish(req,res,local,pair);send(200,{user:publicUser(local)});return true}
  if(route==='profile'||route==='avatar'){
   const patch={...remote,additionalInfo:{...(remote.additionalInfo||{})}};
   if(route==='profile'){const name=typeof b.name==='string'?b.name.trim():'';const conflict=db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(email,u.id);if(conflict)throw error(409,'This email belongs to another preserved NAS identity.');if(!name||name.length>80||/[<>]/.test(name)||!validateEmail(email))throw error(400,'Check name and email.');if(email!==remote.email){let proof;try{proof=await client.request('/api/auth/login',{method:'POST',body:{username:remote.email,password:b.currentPassword}})}catch{throw error(401,'Enter the current ThingsBoard password to change email.')}const verified=await client.identity(proof.token);if(verified.id.id!==remote.id.id)throw error(401,'Account proof failed.');}patch.firstName=name;patch.lastName='';patch.email=email;
   }else{if(b.avatar!==null&&(typeof b.avatar!=='string'||b.avatar.length>450000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(b.avatar)))throw error(400,'Invalid profile image.');patch.additionalInfo.nasV2={...(patch.additionalInfo.nasV2||{}),avatar:b.avatar};}
   const saved=await client.request('/api/user?sendActivationMail=false',{method:'POST',service:true,body:patch});if(saved.id.id!==remote.id.id||saved.authority!==remote.authority||saved.tenantId.id!==remote.tenantId.id)throw error(403,'Cloud profile identity mismatch.');const local=await upsert(saved);send(200,{user:publicUser(local)});return true;
  }
  if(route==='recovery-code')throw error(409,'Cloud passwords require ThingsBoard recovery. NAS recovery codes remain available only in the legacy provider.');throw error(404,'Unknown authentication route');
 }
 return {provider:'thingsboard',db,user,validate,handle,publicUser,revoke,apiRequest,runRequest,runForUser,scopeId,client,requestAsHash,assignDevices,createCustomerDevice,connectCustomerDevice:(req,id)=>createCustomerDevice(req,'',id),enableDeviceSettings:(req,id)=>createCustomerDevice(req,'',id,true),recovery:()=>{throw error(409,'Use ThingsBoard password recovery for cloud accounts.')}};
}
module.exports={createThingsBoardAuth};
