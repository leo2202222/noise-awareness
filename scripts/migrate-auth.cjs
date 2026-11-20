'use strict';
// Local administrator tool: no password/hash export and no automatic cloud writes.
const {createThingsBoardAuth}=require('../auth-thingsboard.cjs');
const action=process.argv[2]||'--list',auth=createThingsBoardAuth(process.env.AUTH_DB_PATH);
(async()=>{
 if(action==='--list'){console.log(JSON.stringify(auth.db.prepare('SELECT id,name,email,role,auth_provider AS provider,tb_user_id AS thingsboardUserId FROM users ORDER BY rowid').all(),null,2));console.log('Legacy password hashes are preserved; they cannot be converted into ThingsBoard passwords.');return;}
 if(action!=='--link'||!process.argv[3]||!process.argv[4])throw Error('Usage: node --env-file=.env scripts/migrate-auth.cjs --list OR --link LOCAL_ID THINGSBOARD_USER_ID');
 const local=auth.db.prepare('SELECT * FROM users WHERE id=?').get(process.argv[3]);if(!local)throw Error('Legacy/local identity not found');
 const remote=await auth.client.request('/api/user/'+process.argv[4],{service:true});if(remote.tenantId?.id!==await auth.client.expectedTenant()||!['TENANT_ADMIN','CUSTOMER_USER'].includes(remote.authority)||remote.email.trim().toLowerCase()!==local.email.trim().toLowerCase())throw Error('Tenant, authority or email mismatch. No identity was linked.');
 const duplicate=auth.db.prepare('SELECT id FROM users WHERE tb_user_id=? AND id<>?').get(remote.id.id,local.id);if(duplicate)throw Error('That cloud identity is already linked to another local row.');
 auth.db.prepare('UPDATE users SET auth_provider=?,tb_user_id=?,tb_tenant_id=?,tb_customer_id=?,tb_authority=?,role=? WHERE id=?').run('thingsboard',remote.id.id,remote.tenantId.id,remote.customerId?.id||null,remote.authority,remote.authority==='TENANT_ADMIN'?'admin':'viewer',local.id);auth.revoke(local.id);
 console.log('Identity linked. Legacy salt/hash were preserved, not decoded or changed. Login must now use the ThingsBoard password. Device access still requires cloud permissions.');
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>auth.db.close());
