(function(){
 'use strict';
 const supported='Notification' in window&&'serviceWorker' in navigator;
 const pref=()=>`noise-push-enabled:${(typeof authUser!=='undefined'&&authUser?.id)||'guest'}`;
 const seenKey=()=>`noise-browser-push-seen:${(typeof authUser!=='undefined'&&authUser?.email)||'guest'}`;
 const alerts=()=>typeof notificationAlerts==='function'?notificationAlerts():[];
 const eventId=e=>typeof notificationId==='function'?notificationId(e):[e.ts,e.device,e.type,e.level,e.status].join('|');
 let registration=null,workerPromise=null,checking=false,subscribing=false,serverPushReady=false;
 const status=(text,state='')=>{for(const id of ['browserNotificationStatus','notificationPermissionFeedback']){const node=document.getElementById(id);if(node){node.textContent=text;node.dataset.state=state}}};
 function updateButton(){
  for(const id of ['browserNotificationToggle']){const b=document.getElementById(id);if(!b)continue;b.hidden=supported&&Notification.permission==='granted'&&localStorage.getItem(pref())==='true';b.disabled=!supported||Notification.permission==='denied';b.textContent=!supported?'System notifications unavailable':Notification.permission==='denied'?'Notifications blocked':'Enable notifications';}
 }
 async function registerWorker(){
  if(!supported)throw Error('This browser does not support system notifications.');
  if(registration)return registration;
  if(!workerPromise)workerPromise=(async()=>{await navigator.serviceWorker.register('./sw.js',{scope:'./'});registration=await navigator.serviceWorker.ready;registration.update().catch(()=>{});return registration})().catch(e=>{workerPromise=null;throw e});
  return workerPromise;
 }
 const decode=value=>Uint8Array.from(atob((value+'='.repeat((4-value.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
 async function subscribeForServerPush(){
  if(subscribing||localStorage.getItem(pref())!=='true')return;subscribing=true;
  try{
   await registerWorker();const response=await fetch('/api/push/config',{credentials:'same-origin'});if(!response.ok)throw Error('Sign in before enabling background notifications.');
   const config=await response.json();if(!config.enabled||!config.vapidPublicKey)throw Error('Background push is not configured.');
   let subscription=await registration.pushManager.getSubscription();const expected=decode(config.vapidPublicKey),existing=subscription?.options?.applicationServerKey;
   if(existing&&(existing.byteLength!==expected.length||!new Uint8Array(existing).every((v,i)=>v===expected[i]))){await subscription.unsubscribe();subscription=null;}
   if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:expected});
   const saved=await fetch('/api/push/subscribe',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(subscription)});
   if(!saved.ok)throw Error('Background subscription failed ('+saved.status+').');serverPushReady=true;
  }catch(e){serverPushReady=false;throw e}finally{subscribing=false}
 }
 async function show(payload){
  if(!supported||Notification.permission!=='granted')throw Error('Allow notifications in this browser first.');
  const options={body:payload.body,icon:'./assets/icons/notification-icon.svg',badge:'./assets/icons/notification-icon.svg',tag:payload.tag,renotify:true,data:{url:'./index.html#events',eventId:payload.eventId}};
  try{const worker=await registerWorker();await worker.showNotification(payload.title,options)}catch(e){const notification=new Notification(payload.title,options);notification.onclick=()=>{window.focus();location.hash='events';notification.close()}}
 }
 async function enableNotifications(){
  if(!supported)return;
  try{
   // Request permission synchronously within the user's click, especially for Firefox.
   const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();updateButton();
   if(permission!=='granted'){status('Open browser site permissions > Notifications > Allow. Also enable your browser in Windows Settings > System > Notifications.','error');return}
   localStorage.setItem(pref(),'true');
   // Native OS test is independent of the backend or remote push provider.
   await show({title:'Notifications enabled',body:'Noise Awareness will notify you when sound reaches your limit.',tag:'noise-notifications-enabled',eventId:'notifications-enabled'});
   status('System test requested. If no banner appears, check Windows notifications and turn off Do Not Disturb.','success');
   try{await subscribeForServerPush();status('System test requested; background subscription saved. Windows controls whether a banner is shown.','success')}
   catch(e){status('System test requested. Background push unavailable: '+e.message,'error')}
  }catch(e){status('System notification failed: '+e.message,'error')}
 }
 async function stop(){
  localStorage.setItem(pref(),'false');serverPushReady=false;
  try{const worker=await registerWorker(),subscription=await worker.pushManager.getSubscription();if(subscription)await subscription.unsubscribe();const r=await fetch('/api/push/subscribe',{method:'DELETE',credentials:'same-origin'});if(!r.ok)throw Error('Server unsubscribe failed');status('System alerts turned off.','success');updateButton()}catch(e){status('Alerts disabled in this browser. '+e.message,'error')}
 }
 function maybeShowPermissionPrompt(){
  if(!supported||!document.body||typeof authUser==='undefined'||!authUser)return;
  const existing=document.getElementById('notificationPermissionPrompt');
  if(Notification.permission==='denied'||localStorage.getItem(pref())==='false'||(Notification.permission==='granted'&&localStorage.getItem(pref())==='true')){existing?.remove();return}
  if(existing)return;
  const laterKey='noise-permission-later:'+authUser.id;
  if(Date.now()-Number(localStorage.getItem(laterKey)||0)<86400000)return;
  const th=document.documentElement.lang==='th',prompt=document.createElement('aside');prompt.id='notificationPermissionPrompt';prompt.className='notification-permission-prompt';prompt.setAttribute('role','region');prompt.setAttribute('aria-labelledby','notificationPermissionTitle');
  prompt.innerHTML='<span class="notification-permission-icon" aria-hidden="true">🔔</span><div class="notification-permission-copy"><strong id="notificationPermissionTitle"></strong><p id="notificationPermissionDescription"></p><div class="notification-permission-actions"><button class="btn primary" type="button" id="notificationPermissionEnable"></button><button class="btn" type="button" id="notificationPermissionLater"></button></div><p id="notificationPermissionFeedback" role="status" aria-live="polite"></p></div>';
  document.body.append(prompt);
  prompt.querySelector('#notificationPermissionTitle').textContent=th?'เปิดการแจ้งเตือนเสียง':'Turn on sound alerts?';
  prompt.querySelector('#notificationPermissionDescription').textContent=th?'ให้เบราว์เซอร์แจ้งเตือนเมื่อเสียงถึงค่า Limit แม้คุณกำลังดูแท็บอื่น':'Get a system notification when sound reaches your limit, even while viewing another tab.';
  const enable=prompt.querySelector('#notificationPermissionEnable'),later=prompt.querySelector('#notificationPermissionLater');enable.textContent=th?'เปิดการแจ้งเตือน':'Enable notifications';later.textContent=th?'ไว้ทีหลัง':'Not now';
  enable.onclick=()=>{enable.disabled=true;const action=enableNotifications();Promise.resolve(action).finally(()=>{if(Notification.permission==='granted'||Notification.permission==='denied')prompt.remove();else{enable.disabled=false;prompt.querySelector('#notificationPermissionFeedback').textContent=th?'ยังไม่ได้อนุญาต กดเปิดอีกครั้งหรือเลือกไว้ทีหลังได้':'Permission was not granted. Try again or choose Not now.'}})};
  later.onclick=()=>{localStorage.setItem(laterKey,String(Date.now()));prompt.remove()};
 }

 function installControl(){
  const history=document.getElementById('notificationAll');if(!history||document.getElementById('browserNotificationToggle'))return;
  const create=(id,label,fn)=>{const b=document.createElement('button');b.id=id;b.type='button';b.className='browser-notification-toggle';b.textContent=label;b.addEventListener('click',fn);return b};
  const main=create('browserNotificationToggle','Enable notifications',enableNotifications),off=create('disableSystemNotifications','Turn off system alerts',stop),help=document.createElement('p');help.id='browserNotificationStatus';help.className='browser-notification-status';help.setAttribute('role','status');history.before(main,off,help);
  updateButton();if(supported&&Notification.permission==='denied')status('Notifications are blocked. Allow this site in browser permissions and enable browser notification banners in Windows.','error');
 }
 async function notifyNewAlerts(){
  if(checking||!supported||Notification.permission!=='granted'||localStorage.getItem(pref())!=='true')return;checking=true;
  try{
   const reading=typeof liveSnapshot!=='undefined'?liveSnapshot?.current:null;
   if(reading){
    const ts=Number(reading.ts);if(!Number.isFinite(ts)||ts>Date.now()+5000||Date.now()-ts>60000)return;
    const id=reading.deviceId,key='noise-system-state:'+pref()+':'+id;let previous;try{previous=JSON.parse(localStorage.getItem(key)||'null')}catch{}
    const currentStatus=reading.notificationStatus??reading.alertStatus,limit=liveSnapshot.threshold??null;
    if(previous&&ts<=previous.ts&&previous.limit===limit)return;
    if(currentStatus==='Unknown')return;
    if(currentStatus==='Alert'&&(previous?.status!=='Alert'||Date.now()-Number(previous?.ts)>60000||previous.limit!==limit)){
     const device=liveSnapshot.devices?.find(d=>d.id===id);
     await show({title:'Noise alert',body:(device?.name||'Device')+': '+reading.soundType+' '+Number(reading.approximateSoundLevel).toFixed(1)+' dB',tag:'noise:'+id+':'+ts,eventId:id+':'+ts});
    }
    localStorage.setItem(key,JSON.stringify({ts,status:currentStatus,limit}));return;
   }
   if(serverPushReady)return;
   let seen;try{seen=new Set(JSON.parse(localStorage.getItem(seenKey())||'[]'))}catch{seen=new Set()}
   for(const {event}of alerts().slice().reverse()){
    const id=eventId(event),ts=Number(event.ts);if(seen.has(id))continue;
    if(Number.isFinite(ts)&&ts<=Date.now()+5000&&Date.now()-ts<=60000)await show({title:'Noise alert',body:event.type+' '+Number(event.level).toFixed(1)+' dB - '+event.device,tag:'noise-'+id,eventId:id});seen.add(id);
   }
   localStorage.setItem(seenKey(),JSON.stringify([...seen].slice(-300)));
  }catch(e){status('System alert could not be displayed: '+e.message,'error')}finally{checking=false}
 }
 installControl();maybeShowPermissionPrompt();
 if(supported&&Notification.permission==='granted'&&localStorage.getItem(pref())==='true')subscribeForServerPush().catch(e=>status(e.message,'error'));
 const original=window.updateNotifications;if(typeof original==='function')window.updateNotifications=function(...args){const result=original.apply(this,args);installControl();updateButton();maybeShowPermissionPrompt();notifyNewAlerts();return result};
 setInterval(()=>{maybeShowPermissionPrompt();notifyNewAlerts()},2000);
 setInterval(()=>{if(supported&&Notification.permission==='granted'&&localStorage.getItem(pref())==='true')subscribeForServerPush().catch(e=>status('Background push unavailable: '+e.message,'error'))},60000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)notifyNewAlerts()});
})();
