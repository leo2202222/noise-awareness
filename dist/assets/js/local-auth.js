window.NOISE_AUTH_CONFIG={mode:'server'};
(function(){
 const thai=()=>document.documentElement.lang==='th';
 const message=()=>thai()?'หน้านี้ไม่ได้เชื่อมกับเซิร์ฟเวอร์เว็บ กรุณารัน npm.cmd start และเปิดเว็บที่พอร์ต 3000 แทน Live Server':'This page is not connected to the application server. Run npm.cmd start and open port 3000 instead of Live Server.';
 window.showBackendNotice=function(){
  if(document.getElementById('backendNotice'))return;
  const panel=document.createElement('div');panel.id='backendNotice';panel.setAttribute('role','alert');panel.style.cssText='padding:16px;margin-bottom:20px;border:1px solid #e2adad;border-radius:12px;background:#fff0f0;color:#7b3232;line-height:1.6';
  const copy=document.createElement('p');copy.textContent=message();copy.style.margin='0 0 10px';panel.append(copy);
  if(['127.0.0.1','localhost',''].includes(location.hostname)){const link=document.createElement('a');link.href='http://127.0.0.1:3000/auth.html';link.textContent=thai()?'เปิดหน้าเข้าสู่ระบบที่ถูกต้อง →':'Open the application login →';panel.append(link);}
  document.querySelector('.card')?.prepend(panel);
  document.querySelectorAll('#loginForm .primary,#registerForm .primary,#resetForm .primary').forEach(button=>button.disabled=true);
 };
 window.AuthAPI=async function(path,body,method='POST'){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
   const response=await fetch(path,{method,credentials:'same-origin',headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
   if(response.status===204)return null;
   const raw=await response.text();let data;
   try{data=JSON.parse(raw)}catch{throw Object.assign(new Error(message()),{status:response.status,code:'INVALID_API_RESPONSE'})}
   if(!response.ok)throw Object.assign(new Error(data?.error||'Request failed ('+response.status+')'),{status:response.status});
   return data;
  }catch(error){if(error.name==='AbortError')throw new Error(thai()?'เซิร์ฟเวอร์ตอบกลับช้า กรุณาลองอีกครั้ง':'The server did not respond in time. Please try again.');if(error instanceof TypeError)throw new Error(thai()?'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณารัน npm.cmd start แล้วเปิดพอร์ต 3000':'Cannot connect to the server. Run npm.cmd start and open port 3000.');throw error;}finally{clearTimeout(timer)}
 };
 window.LocalAuth={updateProfile:async body=>(await AuthAPI('/api/auth/profile',body)).user,updateAvatar:async avatar=>(await AuthAPI('/api/auth/avatar',{avatar})).user,changePassword:body=>AuthAPI('/api/auth/password',body)};
})();
