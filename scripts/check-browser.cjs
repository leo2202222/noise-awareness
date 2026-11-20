'use strict';
// Legacy-provider regression: runtime defaults to ThingsBoard.
process.env.AUTH_PROVIDER='local';
const {chromium}=require('playwright'),assert=require('node:assert/strict');
process.env.AUTH_DB_PATH=':memory:';process.env.THINGSBOARD_API_KEY='test-key';
const deviceId='26330d60-e196-11f1-ba8b-c1a2c9300913',otherId='11111111-1111-4111-8111-111111111111';
let onlineState=true;let attributes={},now=Date.now();
global.fetch=async(url,options={})=>{
 let data;const route=String(url);const n=route.includes(otherId)?42:76;
 if(route.includes('/attributes/SERVER_SCOPE'))data=[{key:'active',value:onlineState},{key:'lastActivityTime',value:now}];
 else if(route.includes('/attributes/SHARED_SCOPE')){if(options.method==='POST'){attributes=JSON.parse(options.body);data=null}else data=Object.entries(attributes).map(([key,value])=>({key,value}));}
 else if(route.includes('/attributes/CLIENT_SCOPE'))data=[];
 else if(route.includes('startTs='))data={sound_db:[{ts:now,value:String(n)},{ts:now-5000,value:'40'}],alert:[{ts:now,value:'true'},{ts:now-5000,value:'false'}],sound_type:[{ts:now,value:'Speech'}],presence:[{ts:now,value:'true'}]};
 else if(route.includes('/values/timeseries'))data={sound_db:[{ts:now,value:String(n)}],alert:[{ts:now,value:'true'}],sound_type:[{ts:now,value:'Speech'}],presence:[{ts:now,value:'true'}],noise_limit:[{ts:now,value:'75'}],device_status:[{ts:now,value:'awake'}]};
 else if(route.includes('/api/device/'))data={id:{id:otherId},name:'Second Sensor'};
 else if(route.endsWith('/api/device'))data={id:{id:otherId}};
 else throw Error('Unexpected test upstream '+route);
 return {ok:true,status:200,text:async()=>data===null?'':JSON.stringify(data)};
};
const {server}=require('../server.cjs');
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{const context=await browser.newContext({viewport:{width:1000,height:700}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/auth.html');await page.locator('[data-view=register]').first().click();await page.locator('#registerName').fill('Browser Admin');await page.locator('#registerEmail').fill('browser@example.com');await page.locator('#registerPassword').fill('browser-password');await page.locator('#confirmPassword').fill('browser-password');await page.locator('#registerForm .primary').click();
 await page.waitForSelector('textarea[readonly]');const recovery=await page.locator('textarea[readonly]').inputValue();assert.equal(recovery.length,48);await page.getByRole('button',{name:/I saved the code/}).click();await page.waitForURL('**/index.html');await page.waitForSelector('.metrics');assert.ok((await page.locator('.metrics').innerText()).includes('76.0'));onlineState=false;await page.waitForFunction(()=>document.querySelector('.context-state .state-pill')?.textContent.includes('Offline'),{},{timeout:15000});onlineState=true;require('node:fs').mkdirSync('.test-results',{recursive:true});await page.waitForTimeout(1200);await page.screenshot({path:'.test-results/dashboard.png',fullPage:true});
 await page.goto(base+'/index.html#account');await page.locator('#accountName').fill('Updated Admin');await page.locator('#profileForm button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#profileFeedback')?.textContent.includes('updated'));
 await page.evaluate(()=>localStorage.setItem('noise-language','th'));await page.goto(base+'/index.html#settings');await page.waitForFunction(()=>!document.querySelector('#saveConfiguration')?.disabled);await page.locator('#threshold').fill('');await page.locator('#saveConfiguration').click();await page.waitForFunction(()=>document.querySelector('#settingsStatus')?.textContent.includes('valid threshold'));assert.ok(await page.locator('#settingsStatus').isVisible());await page.screenshot({path:'.test-results/settings-validation.png',fullPage:false});await page.locator('#threshold').fill('80');const savedResponse=page.waitForResponse(r=>r.url().includes('/api/thingsboard/settings')&&r.request().method()==='PUT');await page.locator('#saveConfiguration').click();assert.equal((await savedResponse).status(),200);await page.waitForFunction(()=>document.querySelector('#settingsStatus')?.hidden===true);assert.equal(attributes.noise_limit,80);assert.equal(attributes.sound_types,undefined);assert.equal(attributes.minimum_duration_ms,undefined);assert.equal(attributes.monitoring_schedule,undefined);await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(400);await page.screenshot({path:'.test-results/settings.png',fullPage:true});
 await page.goto(base+'/index.html#devices');await page.locator('#addDevice').click();await page.locator('#managedDeviceForm [name=id]').fill(otherId);await page.locator('#managedDeviceForm [name=name]').fill('Second Sensor');await page.locator('#managedDeviceForm [name=location]').fill('Room 2');await page.locator('#managedDeviceForm button').first().click();await page.waitForFunction(()=>document.querySelectorAll('.device-grid .device').length===2);
 await page.locator('[data-select-device="'+otherId+'"]').click();await page.waitForSelector('.metrics');await page.waitForFunction(()=>document.querySelector('.metric .value')?.textContent.includes('42.0'));
 await page.goto(base+'/index.html#events');await page.waitForSelector('#fDate');assert.equal(await page.locator('#historyKind').count(),0);await page.goto(base+'/index.html#insights');await page.waitForSelector('.chart-sections');assert.equal(await page.locator('#historyKind').count(),0);
 if(process.env.AUDIT_UI==='1'){
  for(const [kind,viewport]of [['desktop',{width:1366,height:900}],['mobile',{width:390,height:844}]]){
   await page.setViewportSize(viewport);
   for(const route of ['dashboard','events','insights','devices','settings','account']){
    await page.goto(base+'/index.html#'+route);await page.waitForFunction(()=>!document.body.classList.contains('auth-pending'));await page.waitForSelector('#content[data-page="'+route+'"]');await page.waitForTimeout(900);await page.evaluate(()=>scrollTo(0,0));
    if(route==='devices'){const badgeFits=await page.locator('.device').evaluateAll(cards=>cards.every(card=>{const badge=card.querySelector('.device-top .status'),rect=badge.getBoundingClientRect(),container=card.getBoundingClientRect();return rect.right<=container.right&&rect.left>=container.left&&badge.scrollWidth<=badge.clientWidth+1}));assert.ok(badgeFits,'Device status badge is clipped');}
    const layout=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,labels:[...document.querySelectorAll('.metric .label')].map(n=>n.textContent),values:[...document.querySelectorAll('.metric .value')].map(n=>n.textContent)}));
    console.log(JSON.stringify({screen:kind,page:route,...layout}));assert.ok(layout.width<=viewport.width+1,kind+' '+route+' has horizontal overflow');await page.screenshot({path:'.test-results/'+kind+'-'+route+'.png',fullPage:true});
   }
  }
  await page.setViewportSize({width:1000,height:700});
 }
 // Logout through the actual UI and recover through the form.
 await page.locator('#profileToggle').click();await page.locator('#authButton').click();await page.locator('#confirmLogout').click();await page.waitForURL('**/auth.html');await page.locator('[data-view=reset]').click();await page.locator('#resetEmail').fill('browser@example.com');await page.locator('#recoveryCode').fill(recovery);await page.locator('#resetPassword').fill('new-browser-password');await page.locator('#resetConfirm').fill('new-browser-password');await page.locator('#resetForm .primary').click();await page.waitForSelector('textarea[readonly]');assert.equal((await page.locator('textarea[readonly]').inputValue()).length,48);
 const preview=await context.newPage();await preview.route('**/api/auth/session',route=>route.fulfill({status:404,contentType:'text/html',body:''}));await preview.goto(base+'/auth.html');await preview.waitForSelector('#backendNotice');assert.ok(await preview.locator('#registerForm .primary').isDisabled());assert.ok((await preview.locator('#backendNotice a').getAttribute('href')).includes(':3000/auth.html'));await preview.close();
 assert.deepEqual(errors,[]);console.log('PASS: browser registration/recovery-code display, login dashboard, profile save, real settings API, device registration/selection, history/insights, logout and web recovery; no page errors.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>server.close());
