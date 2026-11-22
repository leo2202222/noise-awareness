'use strict';
const {randomUUID}=require('node:crypto');
const TENANT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function fakeCloud(){
 const attributes=new Map(),users=new Map(),customers=new Map(),tokens=new Map(),refreshes=new Map(),groups=new Map(),roles=new Map(),permissions=new Map(),devices=new Map();
 const sharedCustomer='cccccccc-cccc-4ccc-8ccc-cccccccccccc';customers.set(sharedCustomer,{id:{id:sharedCustomer,entityType:'CUSTOMER'},tenantId:{id:TENANT},title:'NAS Test Customer'});const calls=[];let unavailable=false,invalidRefresh=false,inheritPermissions=false;
 const adminId=randomUUID();users.set(adminId,{id:{id:adminId,entityType:'USER'},tenantId:{id:TENANT,entityType:'TENANT'},customerId:{id:'13814000-1dd2-11b2-8080-808080808080',entityType:'CUSTOMER'},authority:'TENANT_ADMIN',email:'cloud-admin@example.com',firstName:'Cloud',lastName:'Admin',password:'CloudAdmin!234',additionalInfo:{}});
 const issue=id=>{const token='eyJ0eXAiOiJKV1QifQ.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600,sub:id})).toString('base64url')+'.'+randomUUID(),refreshToken=randomUUID();tokens.set(token,id);refreshes.set(refreshToken,id);return {token,refreshToken}};
 const allowed=(u,id)=>u?.authority==='TENANT_ADMIN'||[...permissions.values()].some(p=>roles.get(p.roleId.id)?.permissions.includes('READ_TELEMETRY')&&groups.get(p.userGroupId.id)?.entities.has(u.id.id)&&groups.get(p.entityGroupId.id)?.entities.has(id));
 const response=(status,data)=>({ok:status>=200&&status<300,status,text:async()=>data===undefined?'':JSON.stringify(data)});
 async function fetcher(url,options={}){
  if(unavailable)throw TypeError('isolated cloud outage');const uurl=new URL(url),p=uurl.pathname,m=options.method||'GET',body=options.body?JSON.parse(options.body):undefined,authorization=options.headers?.['X-Authorization'];
  const service=authorization==='ApiKey test-service-secret',actor=service?users.get(adminId):users.get(tokens.get(authorization?.replace(/^Bearer /,'')));calls.push({path:p,method:m,body,service,actor:actor?.id.id});
  if(p==='/api/auth/login'){const u=[...users.values()].find(u=>u.email===body.username&&u.password===body.password&&u.active!==false);return u?response(200,issue(u.id.id)):response(401,{message:'Bad credentials'})}
  if(p==='/api/auth/token'){const id=refreshes.get(body.refreshToken);return id&&!invalidRefresh?response(200,issue(id)):response(401,{message:'Refresh token invalid'})}
  if(p==='/api/noauth/activate'){const u=[...users.values()].find(u=>u.activation===body.activateToken);if(!u)return response(400,{message:'Invalid activation token'});u.password=body.password;delete u.activation;return response(200,issue(u.id.id))}
  if(p==='/api/auth/user')return actor?response(200,publicRecord(actor)):response(401,{message:'Unauthorized'});
  if(!actor)return response(401,{message:'Unauthorized'});
  if(p==='/api/auth/logout')return response(200);
  if(p==='/api/auth/changePassword'){if(actor.password!==body.currentPassword)return response(400,{message:'Wrong password'});actor.password=body.newPassword;return response(200)}
  if(p==='/api/customer'&&m==='POST'){if(actor.authority!=='TENANT_ADMIN')return response(403);const id=randomUUID(),c={...body,id:{id,entityType:'CUSTOMER'},tenantId:{id:TENANT}};customers.set(id,c);return response(200,c)}
  if(p.startsWith('/api/customer/')&&m==='GET'){const found=customers.get(p.split('/')[3]);return found?response(200,found):response(404);}
  if(p.startsWith('/api/customer/')&&m==='DELETE'){customers.delete(p.split('/')[3]);return response(200)}
  if(p==='/api/user'&&m==='POST'){
   if(actor.authority!=='TENANT_ADMIN')return response(403);if(body.password)throw Error('User-create API must not receive a password');
   if(body.id){const old=users.get(body.id.id);Object.assign(old,body);return response(200,publicRecord(old))}
   if([...users.values()].some(u=>u.email===body.email))return response(400,{message:'User with email already exists'});const id=randomUUID(),u={...body,id:{id,entityType:'USER'},activation:randomUUID()};users.set(id,u);const group=uurl.searchParams.get('entityGroupId');if(group)groups.get(group).entities.add(id);return response(200,publicRecord(u));
  }
  const activation=p.match(/^\/api\/user\/([^/]+)\/activationLink$/);if(activation)return response(200,'https://thingsboard.cloud/login/createPassword?activateToken='+users.get(activation[1]).activation);
  const userRoute=p.match(/^\/api\/user\/([^/]+)$/);if(userRoute&&m==='GET'){const u=users.get(userRoute[1]);return u?response(200,publicRecord(u)):response(404)}
  if(userRoute&&m==='DELETE'){users.delete(userRoute[1]);return response(200)}
  if(p.startsWith('/api/entityGroups/USER/')){const id=p.split('/').pop();return response(200,[...groups.values()].filter(g=>g.type==='USER'&&g.entities.has(id)).map(g=>({id:g.id.id,entityType:'ENTITY_GROUP'})));}
  if(p.startsWith('/api/userGroup/')&&p.endsWith('/groupPermissions')){const id=p.split('/')[3];return response(200,inheritPermissions?[{id:{id:'inherited'},roleId:{id:'unsafe'}}]:[...permissions.values()].filter(p=>p.userGroupId.id===id));}
  const namedGroup=p.match(/^\/api\/entityGroup\/CUSTOMER\/([^/]+)\/(USER|DEVICE)\/(.+)$/);if(namedGroup&&m==='GET'){const found=[...groups.values()].find(g=>g.ownerId.id===namedGroup[1]&&g.type===namedGroup[2]&&g.name===decodeURIComponent(namedGroup[3]));return found?response(200,{...found,entities:undefined}):response(404)}
  const groupRoute=p.match(/^\/api\/entityGroup\/([^/]+)$/);if(groupRoute&&m==='GET'){const found=groups.get(groupRoute[1]);return found?response(200,{...found,entities:undefined}):response(404)}
  if(groupRoute&&m==='DELETE'){groups.delete(groupRoute[1]);return response(200);}
  if(p==='/api/entityGroup'&&m==='POST'){if([...groups.values()].some(g=>g.name===body.name&&g.type===body.type&&g.ownerId.id===body.ownerId.id))return response(400,{message:'Entity Group with such name, type and owner already exists!'});const id=randomUUID(),g={...body,id:{id},entities:new Set()};groups.set(id,g);return response(200,{...g,entities:undefined})}
  const membership=p.match(/^\/api\/entityGroup\/([^/]+)\/(addEntities|deleteEntities)$/);if(membership){const group=groups.get(membership[1]);if(membership[2]==='addEntities'&&group.type==='DEVICE'&&body.some(id=>{const device=devices.get(id);return device?.customerId?.id&&device.customerId.id!==group.ownerId?.id}))return response(400,{message:'Unable to add entity with other owner than group'});for(const id of body)membership[2]==='addEntities'?group.entities.add(id):group.entities.delete(id);return response(200)}
  if(p==='/api/role'&&m==='POST'){const r={...body,id:{id:randomUUID()}};roles.set(r.id.id,r);return response(200,r)}
  if(p==='/api/groupPermission'&&m==='POST'){const v={...body,id:{id:randomUUID()}};permissions.set(v.id.id,v);return response(200,v)}
  if(p==='/api/device'&&m==='POST'){if(actor.authority!=='TENANT_ADMIN')return response(403);const device={...body,id:{id:randomUUID()},tenantId:{id:TENANT}};devices.set(device.id.id,device);return response(200,device)}
  if(p.startsWith('/api/device/')){const id=p.split('/')[3];return allowed(actor,id)?response(200,devices.get(id)||{id:{id},name:'NAS Test'}):response(403,{message:'Forbidden'})}
  const telemetry=p.match(/^\/api\/plugins\/telemetry\/DEVICE\/([^/]+)\//);if(telemetry){if(!allowed(actor,telemetry[1]))return response(403,{message:'Forbidden'});if(p.includes('/attributes/SERVER_SCOPE'))return response(200,[{key:'active',value:true}]);if(p.includes('/attributes/')){if(m==='POST'){const canWrite=actor.authority==='TENANT_ADMIN'||[...permissions.values()].some(p=>roles.get(p.roleId.id)?.permissions.includes('WRITE_ATTRIBUTES')&&groups.get(p.userGroupId.id)?.entities.has(actor.id.id)&&groups.get(p.entityGroupId.id)?.entities.has(telemetry[1]));if(!canWrite)return response(403,{message:'Forbidden attribute write'});attributes.set(telemetry[1],body);return response(200)}return response(200,p.includes('/SHARED_SCOPE')?Object.entries(attributes.get(telemetry[1])||{}).map(([key,value])=>({key,value})):[])}const ts=Date.now();return response(200,{sound_db:[{ts,value:'68.5'}],alert:[{ts,value:'false'}],presence:[{ts,value:'true'}],sound_type:[{ts,value:'Speech'}],device_status:[{ts,value:'awake'}]})}
  return response(404,{message:'Unknown fake endpoint '+p});
 }
 function publicRecord(u){const {password,activation,...rest}=u;return rest}
 return {TENANT,sharedCustomer,adminId,users,customers,tokens,refreshes,groups,roles,permissions,devices,calls,fetch:fetcher,setUnavailable:value=>unavailable=value,setInvalidRefresh:value=>invalidRefresh=value,setInheritedPermissions:value=>inheritPermissions=value};
}
module.exports={fakeCloud,TENANT};
