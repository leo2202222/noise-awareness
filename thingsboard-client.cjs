'use strict';
const {error}=require('./auth-local.cjs');
function createThingsBoardClient(options={}){
 const base=(options.url||process.env.THINGSBOARD_URL||'https://thingsboard.cloud').replace(/\/$/,'');const address=new URL(base);
 if(address.protocol!=='https:'&&!(process.env.ALLOW_HTTP_THINGSBOARD==='true'&&['localhost','127.0.0.1'].includes(address.hostname)))throw error(503,'ThingsBoard must use HTTPS.');
 const fetcher=options.fetch||global.fetch;let cachedService;
 async function request(route,{method='GET',body,token,service=false}={}){
  const authorization=service?(process.env.THINGSBOARD_ADMIN_API_KEY||process.env.THINGSBOARD_API_KEY):token;
  if((service&&!authorization)||(!service&&token===undefined&&!route.startsWith('/api/noauth/')&&!['/api/auth/login','/api/auth/token'].includes(route)))throw error(503,'ThingsBoard service credentials are not configured.');
  let response;try{response=await fetcher(base+route,{method,redirect:'error',headers:{Accept:'application/json,text/plain,*/*',...(authorization?{'X-Authorization':(service?'ApiKey ':'Bearer ')+authorization}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)})}catch{throw error(503,'ThingsBoard is unavailable. Please try again later.')}
  const text=await response.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!response.ok){const e=error(response.status===401?401:response.status===403?403:response.status===429?429:response.status>=500?503:response.status,'ThingsBoard request failed.');e.upstreamStatus=response.status;e.operation=route.split('?')[0];e.remoteMessage=typeof data==='object'?data?.message:typeof data==='string'?data:'';throw e}
  return data;
 }
 async function serviceIdentity(){if(cachedService&&Date.now()-cachedService.at<300000)return cachedService.user;const u=await request('/api/auth/user',{service:true});if(u.authority!=='TENANT_ADMIN')throw error(503,'Registration requires a tenant-scoped service account.');const expected=process.env.THINGSBOARD_TENANT_ID;if(expected&&u.tenantId?.id!==expected)throw error(503,'ThingsBoard tenant configuration does not match the service account.');cachedService={at:Date.now(),user:u};return u}
 async function expectedTenant(){if(process.env.THINGSBOARD_TENANT_ID)return process.env.THINGSBOARD_TENANT_ID;return (await serviceIdentity()).tenantId.id}
 async function identity(token){const u=await request('/api/auth/user',{token});if(!u.id?.id||!['TENANT_ADMIN','CUSTOMER_USER'].includes(u.authority)||u.tenantId?.id!==await expectedTenant())throw error(403,'This ThingsBoard account is not authorized for this NAS tenant.');return u}
 async function register({name,email,password}){
  if(process.env.THINGSBOARD_REGISTRATION_ENABLED==='false')throw error(503,'Registration is disabled by the administrator.');const service=await serviceIdentity();let customer,user,registrationGroup,createdCustomer=false,activated=false;
  try{
   const configuredCustomer=process.env.THINGSBOARD_REGISTRATION_CUSTOMER_ID;
   if(configuredCustomer){customer=await request('/api/customer/'+configuredCustomer,{service:true});if(customer.tenantId?.id!==service.tenantId.id)throw error(403,'Registration customer belongs to another tenant.');registrationGroup=await request('/api/entityGroup',{method:'POST',service:true,body:{name:'NAS V2 Pending '+require('node:crypto').randomUUID(),type:'USER',ownerId:customer.id,additionalInfo:{nasV2Managed:true,registrationOnly:true}}});}
   else{customer=await request('/api/customer',{method:'POST',service:true,body:{title:'NAS V2 '+require('node:crypto').randomUUID(),additionalInfo:{nasV2Managed:true}}});createdCustomer=true;}
   user=await request('/api/user?sendActivationMail=false'+(registrationGroup?'&entityGroupId='+registrationGroup.id.id:''),{method:'POST',service:true,body:{email,authority:'CUSTOMER_USER',tenantId:service.tenantId,customerId:{id:customer.id.id,entityType:'CUSTOMER'},firstName:name,lastName:'',additionalInfo:{nasV2Managed:true}}});
   const link=await request(`/api/user/${user.id.id}/activationLink`,{service:true});let activateToken;try{activateToken=new URL(typeof link==='string'?link:link.activationLink).searchParams.get('activateToken')}catch{}if(!activateToken)throw error(503,'ThingsBoard did not provide an activation token.');
   const tokens=await request('/api/noauth/activate?sendActivationMail=false',{method:'POST',body:{activateToken,password}});const verified=await identity(tokens.token);if(verified.id.id!==user.id.id||verified.authority!=='CUSTOMER_USER'||verified.customerId?.id!==customer.id.id)throw error(403,'Unexpected ThingsBoard registration identity.');if(registrationGroup){const memberships=await request('/api/entityGroups/USER/'+verified.id.id,{service:true});for(const group of memberships){const grants=await request('/api/userGroup/'+(typeof group==='string'?group:typeof group.id==='string'?group.id:group.id.id)+'/groupPermissions',{service:true});if(grants.length)throw error(403,'New account inherited existing group permissions. Registration was rolled back.');}}activated=true;return {tokens,user:verified,registrationGroupId:registrationGroup?.id.id,createdCustomerId:createdCustomer?customer.id.id:null};
  }catch(e){
   if(!activated){const cleanup=[];if(user?.id?.id)cleanup.push('/api/user/'+user.id.id);if(registrationGroup?.id?.id)cleanup.push('/api/entityGroup/'+registrationGroup.id.id);if(createdCustomer&&customer?.id?.id)cleanup.push('/api/customer/'+customer.id.id);for(const route of cleanup)try{await request(route,{method:'DELETE',service:true})}catch(cleanupError){e.rollbackFailures??=[];e.rollbackFailures.push({route,status:cleanupError.status})}}
   if(/maximum allowed customers/i.test(e.remoteMessage||''))throw error(503,'Customer quota reached. Configure THINGSBOARD_REGISTRATION_CUSTOMER_ID with a NAS customer; new users will be isolated in empty groups.');
   if(e.upstreamStatus===409||/already|duplicate|email.*exist|user.*exist/i.test(e.remoteMessage||''))throw error(409,'This email is already registered in ThingsBoard.');
   if(e.upstreamStatus===400){const mapped=error(400,'ThingsBoard rejected these account details. Check its email/password policy.');mapped.operation=e.operation;mapped.remoteMessage=(e.remoteMessage||'').replaceAll(password,'[redacted]');throw mapped;}
   if(activated&&e.status>=500)throw error(503,'The cloud account was created. Try signing in instead of registering again.');throw e;
  }
 }
 return {base,request,identity,expectedTenant,serviceIdentity,register};
}
module.exports={createThingsBoardClient};
