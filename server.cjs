const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {createAuth}=require('./auth.cjs');
const auth=createAuth(process.env.AUTH_DB_PATH);
const root = path.join(__dirname, 'dist');
const base = (process.env.THINGSBOARD_URL || 'https://thingsboard.cloud').replace(/\/$/, '');
const id = process.env.THINGSBOARD_DEVICE_ID || '26330d60-e196-11f1-ba8b-c1a2c9300913';
const key = process.env.THINGSBOARD_API_KEY;
const keys = ['sound_db','sound_class','sound_type','confidence','noise_limit','alert','presence','audio_valid','device_status'];
async function tb(route,options={}) {
  if(auth.provider==='thingsboard')return auth.apiRequest(route,options);
  if (!key) throw new Error('Set THINGSBOARD_API_KEY in .env and restart the server.');
  const response = await fetch(base + route, {method:options.method||'GET',headers:{'X-Authorization':`ApiKey ${key}`,...(options.body?{'Content-Type':'application/json'}:{})},body:options.body?JSON.stringify(options.body):undefined, signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw Object.assign(new Error(`ThingsBoard returned HTTP ${response.status}`),{status:502});
  if(response.status===204)return null;const text=await response.text();return text?JSON.parse(text):null;
}
const bool = value => value === true || value === 'true' ? true : value === false || value === 'false' ? false : null;
const soundType = value => ({speech:'Speech',music:'Music',noise:'Noise','music / media':'Music','background noise':'Noise'})[String(value??'').trim().toLowerCase()] || 'Unknown';
const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
function classificationSeries(data){return ['sound_class','sound_type'].map(key=>({key,points:(data[key]||[]).filter(p=>Number.isFinite(Number(p.ts))).slice().sort((a,b)=>Number(a.ts)-Number(b.ts))}))}
function classificationAt(series,ts){
 for(const {key,points}of series){let left=0,right=points.length-1,index=-1;while(left<=right){const mid=(left+right)>>1;if(Number(points[mid].ts)<=ts){index=mid;left=mid+1}else right=mid-1}if(index>=0&&ts-Number(points[index].ts)<=2000)return {type:soundType(points[index].value),key,ts:Number(points[index].ts)}}
 return {type:'Unknown',key:null,ts:null};
}
function recordedPointAtOrBefore(points,ts){let left=0,right=points.length-1,index=-1;while(left<=right){const mid=(left+right)>>1;if(Number(points[mid].ts)<=ts){index=mid;left=mid+1}else right=mid-1}return index<0?null:points[index]}
function historyEvents(history,deviceId=id,deviceName=process.env.THINGSBOARD_DEVICE_NAME||'NAS 01') {
  const classifications=classificationSeries(history),limits=(history.noise_limit||[]).filter(p=>Number.isFinite(Number(p.ts))).slice().sort((a,b)=>Number(a.ts)-Number(b.ts));
  const indexed=Object.fromEntries(keys.map(k=>[k,new Map((history[k]||[]).map(p=>[Number(p.ts),p.value]))]));
  return (history.sound_db||[]).filter(p=>number(p.value)!==null).map(p=>{
    const ts=Number(p.ts),get=k=>indexed[k].get(ts),classification=classificationAt(classifications,ts),limitPoint=recordedPointAtOrBefore(limits,ts),noiseLimit=number(limitPoint?.value),hasLimit=noiseLimit!==null&&noiseLimit>=0&&noiseLimit<=140,deviceAlertStatus=bool(get('alert'))==null?'Unknown':bool(get('alert'))?'Alert':'Normal',alertStatus=hasLimit?(number(p.value)>=noiseLimit?'Alert':'Normal'):deviceAlertStatus;
    return {ts,deviceId,deviceName,soundType:classification.type,soundClassKey:classification.key,soundClassTs:classification.ts,approximateSoundLevel:number(p.value),presence:get('presence')==null?null:bool(get('presence')),alertStatus,deviceAlertStatus,alertSource:hasLimit?'historical-noise-limit':'device-alert',noiseLimit:hasLimit?noiseLimit:null,noiseLimitTs:hasLimit?Number(limitPoint.ts):null,modelConfidence:number(get('confidence')),durationMs:null,reason:hasLimit?'Recorded sound level compared with noise_limit recorded at that time. Duration is not recorded.':'Recorded device alert; no historical noise_limit available. Duration is not recorded.'};
  }).sort((a,b)=>b.ts-a.ts);
}
function soundMoments(records){
 const ordered=[...new Map(records.filter(r=>Number.isFinite(Number(r.ts))).map(r=>[r.deviceId+':'+r.ts,r])).values()].sort((a,b)=>a.ts-b.ts),result=[];let active=null;
 for(const record of ordered){
  if(!active||active.deviceId!==record.deviceId||active.soundType!==record.soundType||record.ts-active.lastSampleTs>30000){active={...record,source:'observed-sound-event',lastSampleTs:record.ts,endTs:null,durationMs:null,sampleCount:1};result.push(active)}
  else{active.lastSampleTs=record.ts;active.endTs=record.ts;active.durationMs=record.ts-active.ts;active.sampleCount++}
 }
 return result.sort((a,b)=>b.ts-a.ts);
}
function alertIncidents(records){
 const sorted=[...records].sort((a,b)=>a.ts-b.ts),result=[];let active=null,previous=null;
 const finish=(end,reason)=>{if(active){result.push({...active,endTs:end,durationMs:end==null?null:end-active.ts,reason});active=null}};
 for(const sample of sorted){if(previous&&sample.ts-previous.ts>30000)finish(null,'Telemetry gap; end time not recorded.');if(sample.alertStatus==='Alert'){if(!active)active={...sample,source:'observed-alert-interval',durationMs:null,endTs:null};}else if(sample.alertStatus==='Normal'){finish(sample.ts,'Observed interval from first alert sample to the following normal sample. This is not an exact audio recording duration.');}else finish(null,'Alert state missing; end time not recorded.');previous=sample;}
 finish(null,'Alert has no observed end sample.');return result.sort((a,b)=>b.ts-a.ts);
}
const historyCaches=new Map(),historyRequests=new Map();
async function loadHistory(prefix,now){
  const cacheKey=(auth.scopeId?auth.scopeId():'service')+'|'+prefix;const historyCache=historyCaches.get(cacheKey);if(historyCache && now-historyCache.at<60000)return historyCache.data;
  if(!historyRequests.has(cacheKey))historyRequests.set(cacheKey,tb(`${prefix}?keys=${keys.join(",")}&startTs=${now-49*86400000}&endTs=${now}&agg=NONE&limit=1000&orderBy=DESC`).then(async data=>{const limit=20000;for(const key of keys){let values=data[key]||[];while(values.length>=1000&&values.length<limit){const endTs=Math.min(...values.map(p=>Number(p.ts)))-1;if(endTs<now-49*86400000)break;const page=await tb(`${prefix}?keys=${key}&startTs=${now-49*86400000}&endTs=${endTs}&agg=NONE&limit=1000&orderBy=DESC`),next=(page[key]||[]).filter(p=>Number(p.ts)<=endTs);if(!next.length)break;values=values.concat(next);data[key]=values;if(next.length<1000)break;}}historyCaches.set(cacheKey,{at:Date.now(),data});return data}).finally(()=>{historyRequests.delete(cacheKey)}));
  return historyRequests.get(cacheKey);
}
function mergeLatestHistory(history,latest,now){
 for(const key of keys){const incoming=(latest[key]||[]).filter(p=>Number.isFinite(Number(p.ts))&&Number(p.ts)<=now+5000&&Number(p.ts)>=now-49*86400000);if(!incoming.length)continue;const merged=new Map((history[key]||[]).map(p=>[Number(p.ts),p]));for(const point of incoming)merged.set(Number(point.ts),point);history[key]=[...merged.values()].sort((a,b)=>Number(b.ts)-Number(a.ts)).slice(0,20000)}return history;
}
const statusCaches=new Map();
async function deviceStatus(deviceId){
 const cacheKey=(auth.scopeId?auth.scopeId():'service')+'|'+deviceId;const cached=statusCaches.get(cacheKey);if(cached&&Date.now()-cached.at<5000)return cached.data;
 const values=await tb(`/api/plugins/telemetry/DEVICE/${encodeURIComponent(deviceId)}/values/attributes/SERVER_SCOPE?keys=active,lastActivityTime,lastConnectTime,lastDisconnectTime`);
 const attributes=Object.fromEntries((Array.isArray(values)?values:[]).map(a=>[a.key,a.value]));
 const active=bool(attributes.active),connected=number(attributes.lastConnectTime),disconnected=number(attributes.lastDisconnectTime),activity=number(attributes.lastActivityTime);
 const online=active;
 const data={online,statusSource:'thingsboard',lastActivityTime:activity,lastConnectTime:connected,lastDisconnectTime:disconnected};statusCaches.set(cacheKey,{at:Date.now(),data});return data;
}
async function snapshot(deviceId=id) {
  const configured=auth.db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId)||{id:deviceId,name:process.env.THINGSBOARD_DEVICE_NAME||'NAS 01',location:''};
  const prefix = `/api/plugins/telemetry/DEVICE/${encodeURIComponent(deviceId)}/values/timeseries`;
  const now = Date.now();
  const [latest, history, connectivity, shared] = await Promise.all([
    tb(`${prefix}?keys=${keys.join(',')}`),
    loadHistory(prefix,now),
    deviceStatus(deviceId).catch(()=>({online:null,statusSource:'unavailable'})),
    tb(`/api/plugins/telemetry/DEVICE/${encodeURIComponent(deviceId)}/values/attributes/SHARED_SCOPE?keys=noise_limit`).catch(()=>null)
  ]);
  mergeLatestHistory(history,latest,now);
  const value = k => latest[k]?.[0]?.value;
  const ts = Number(latest.sound_db?.[0]?.ts || 0);
  const classification=classificationAt(classificationSeries(latest),ts);
  const savedLimit=Array.isArray(shared)?number(shared.find(a=>a.key==='noise_limit')?.value):null;
  const threshold=savedLimit??number(value('noise_limit')),level=number(value('sound_db'));
  const soundRecords=historyEvents(history,deviceId,configured.name);
  const notificationStatus=level!==null&&threshold!==null?(level>=threshold?'Alert':'Normal'):(Number(latest.alert?.[0]?.ts)===ts&&bool(value('alert'))!==null?(bool(value('alert'))?'Alert':'Normal'):'Unknown');
  return {
    threshold,thresholdSource:savedLimit!==null?'shared-attributes':'telemetry',
    current:ts && number(value('sound_db'))!==null ? {deviceId,ts,notificationStatus,notificationSource:level!==null&&threshold!==null?'noise_limit':'device-alert',approximateSoundLevel:number(value('sound_db')),soundType:classification.type,soundClassKey:classification.key,soundClassTs:classification.ts,presence:Number(latest.presence?.[0]?.ts)===ts?bool(value('presence')):null,alertStatus:Number(latest.alert?.[0]?.ts)!==ts||bool(value('alert'))==null?'Unknown':bool(value('alert'))?'Alert':'Normal',modelConfidence:Number(latest.confidence?.[0]?.ts)===ts?number(value('confidence')):null,audioValid:Number(latest.audio_valid?.[0]?.ts)===ts?bool(value('audio_valid')):null,deviceStatus:value('device_status')} : null,
    devices:[{...configured,...connectivity,updated:ts?new Date(ts).toLocaleString('en-GB',{timeZone:'Asia/Bangkok'}):'No telemetry'}],
    events:soundRecords,
    soundRecords,
    soundMoments:soundMoments(soundRecords),
    alertRecords:soundRecords.filter(record=>record.alertStatus==='Alert'),
    incidents:alertIncidents(soundRecords),
    historyInfo:{days:49,limitPerKey:20000,refreshedAt:historyCaches.get((auth.scopeId?auth.scopeId():'service')+'|'+prefix)?.at||now,possiblyTruncated:Object.values(history).some(points=>points.length>=20000)},
    soundLevels:(history.sound_db || []).map(p=>({ts:Number(p.ts),value:number(p.value)})).filter(p=>p.value!==null).sort((a,b)=>a.ts-b.ts)
  };
}
const {createPlatform}=require('./platform.cjs');
const platform=createPlatform(auth,tb,id);
const {createPush}=require('./push.cjs');
const push=createPush(auth,platform,snapshot);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const handleRequest=async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('X-Frame-Options','DENY');
  const send = (status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(status===204?undefined:JSON.stringify(data));};
  try {
    const url = new URL(req.url,'http://localhost');
    if(await auth.handle(req,res,url,send))return;
    if(url.pathname.startsWith('/api/')) {
      const currentUser=auth.validate?await auth.validate(req):auth.user(req);if(!currentUser)return send(401,{error:'Sign in required'});
      if(!['GET','HEAD'].includes(req.method)&&req.headers.origin&& !['http://'+req.headers.host,'https://'+req.headers.host].includes(req.headers.origin))return send(403,{error:'Invalid origin'});
      if(await platform.handle(req,res,url,currentUser,send)||await push.handle(req,res,url,currentUser,send))return;
      if(req.method==='GET' && url.pathname==='/api/thingsboard/snapshot'){const allowed=platform.list(currentUser);const selected=url.searchParams.get('deviceId')||allowed[0]?.id;if(!selected)return send(200,{devices:[],events:[],soundLevels:[],current:null,threshold:null});platform.device(currentUser,selected);const data=await snapshot(selected);const stillSignedIn=auth.validate?await auth.validate(req):auth.user(req);if(!stillSignedIn)return send(401,{error:'Session expired'});platform.device(stillSignedIn,selected);data.eventKind=url.searchParams.get('historyMode')==='incidents'?'incidents':'samples';if(data.eventKind==='incidents')data.events=data.incidents;data.devices=await Promise.all(allowed.map(async d=>{if(d.id===selected)return data.devices[0];try{const status=await deviceStatus(d.id);return {...d,...status,updated:status.lastActivityTime?new Date(status.lastActivityTime).toLocaleString('en-GB',{timeZone:'Asia/Bangkok'}):'No activity recorded'}}catch{return {...d,online:null,statusSource:'unavailable',updated:'Status unavailable'}}}));return send(200,data);}
      return send(404,{error:'Unknown API route'});
    }
    if(req.method!=='GET' && req.method!=='HEAD') return send(405,{error:'Method not allowed'});
    const relative=decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file=path.resolve(root,relative);
    if(!file.startsWith(root+path.sep)) return send(403,{error:'Forbidden'});
    const data=await fs.readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-cache'});
    res.end(req.method==='HEAD'?undefined:data);
  } catch(error) {
    if(error.status)return send(error.status,{error:error.message});
    if(error instanceof URIError)return send(400,{error:'Invalid URL'});
    if(error.code==='ENOENT' || error.code==='EISDIR') return send(404,{error:'Not found'});
    send(502,{error:error.message.startsWith('ThingsBoard') || error.message.startsWith('Set THINGSBOARD') ? error.message : 'Unable to fetch ThingsBoard data. Check server configuration and connectivity.'});
  }
};
const server=http.createServer((req,res)=>{const task=()=>handleRequest(req,res);const pending=auth.runRequest?auth.runRequest(req,task):task();Promise.resolve(pending).catch(()=>{if(!res.headersSent){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Request could not be completed.'}))}else res.end()});});
let pushTimer;server.on('listening',()=>{if(require.main===module){pushTimer=setInterval(()=>push.poll().catch(()=>{}),15000);pushTimer.unref();push.poll().catch(()=>{})}});
server.on('close',()=>{clearInterval(pushTimer);auth.db.close()});
if(require.main===module) server.listen(Number(process.env.PORT || 3000),process.env.HOST || '127.0.0.1',()=>console.log(`Open http://localhost:${process.env.PORT || 3000}`));
module.exports={server,snapshot,historyEvents,alertIncidents,soundMoments,bool,deviceStatus,auth,platform,push};
