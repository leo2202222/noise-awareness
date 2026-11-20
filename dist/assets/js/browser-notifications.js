(function () {
  'use strict';

  const pushPreferenceKey=()=>`noise-push-enabled:${(typeof authUser!=='undefined'&&authUser?.id)||'guest'}`;
  const supported = 'Notification' in window && 'serviceWorker' in navigator;
  let registration = null;
  let checking = false;

  const thai = () => document.documentElement.lang === 'th';
  const alerts = () => typeof notificationAlerts === 'function' ? notificationAlerts() : [];
  const eventId = event => typeof notificationId === 'function'
    ? notificationId(event)
    : [event.date, event.time, event.device, event.type, event.level, event.status].join('|');
  const seenKey = () => `noise-browser-push-seen:${(typeof authUser !== 'undefined' && authUser?.email) || 'guest'}`;

  function readSeen() {
    try { return new Set(JSON.parse(localStorage.getItem(seenKey()) || '[]')); }
    catch { return new Set(); }
  }

  function saveSeen(seen) {
    localStorage.setItem(seenKey(), JSON.stringify([...seen].slice(-300)));
  }

  function currentIds() {
    return alerts().map(({ event }) => eventId(event));
  }

  function baselineExistingAlerts() {
    if (localStorage.getItem(seenKey()) !== null) return;
    saveSeen(new Set(currentIds()));
  }

  function button() {
    return document.getElementById('browserNotificationToggle');
  }

  function status() {
    return document.getElementById('browserNotificationStatus');
  }

  function setStatus(message, state = '') {
    const element = status();
    if (!element) return;
    element.textContent = message;
    element.dataset.state = state;
  }

  function updateButton() {
    const control = button();
    if (!control) return;
    if (!supported) {
      control.disabled = true;
      control.dataset.state = 'unsupported';
      control.textContent = thai() ? 'เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน' : 'Browser alerts unavailable';
      return;
    }
    const permission = Notification.permission;
    control.dataset.state = permission;
    control.disabled = permission === 'denied';
    control.textContent = permission === 'granted'
      ? (thai() ? 'ส่งการแจ้งเตือนทดสอบ' : 'Send a test notification')
      : permission === 'denied'
        ? (thai() ? 'Chrome บล็อกการแจ้งเตือน' : 'Notifications blocked by Chrome')
        : (thai() ? 'เปิดการแจ้งเตือนบนอุปกรณ์' : 'Turn on device alerts');
    control.setAttribute('aria-pressed', String(permission === 'granted'));
    if (permission === 'granted') {
      setStatus(thai() ? 'เปิดแล้ว · กดปุ่มเพื่อทดสอบได้ทุกเมื่อ' : 'On · use the button to test it anytime', 'success');
    } else if (permission === 'denied') {
      setStatus(thai() ? 'คลิกไอคอนด้านซ้ายของแถบที่อยู่ → การแจ้งเตือน → อนุญาต แล้วโหลดหน้าใหม่' : 'Open site controls beside the address → Notifications → Allow, then reload.', 'error');
    } else {
      setStatus(thai() ? 'Chrome จะถามสิทธิ์หลังจากกดปุ่ม' : 'Chrome will ask for permission after you click.', '');
    }
  }

  function installControl() {
    const panel = document.getElementById('notificationPanel');
    const history = document.getElementById('notificationAll');
    if (!panel || !history || button()) return;
    const control = document.createElement('button');
    control.id = 'browserNotificationToggle';
    control.className = 'browser-notification-toggle';
    control.type = 'button';
    control.addEventListener('click', enableNotifications);
    const help = document.createElement('p');
    help.id = 'browserNotificationStatus';
    help.className = 'browser-notification-status';
    help.setAttribute('role', 'status');
    const stop=document.createElement('button');stop.type='button';stop.className='browser-notification-toggle';stop.textContent='Turn off background notifications';stop.onclick=async()=>{try{const response=await fetch('/api/push/subscribe',{method:'DELETE',credentials:'same-origin'});if(!response.ok)throw Error('Unable to unsubscribe');const worker=await navigator.serviceWorker.ready;const subscription=await worker.pushManager.getSubscription();if(subscription)await subscription.unsubscribe();window.NOISE_PUSH_CONFIG={enabled:false};localStorage.setItem(pushPreferenceKey(),'false');setStatus('Background notifications disabled.','success');}catch(error){setStatus(error.message,'error')}};history.before(control,stop,help);
    updateButton();
  }

  async function registerWorker() {
    if (!supported) return null;
    if (registration) return registration;
    registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    await navigator.serviceWorker.ready;
    registration.update().catch(() => {});
    return registration;
  }

  function urlBase64ToUint8Array(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
  }

  async function subscribeForServerPush() {
    if(localStorage.getItem(pushPreferenceKey())!=='true')return;
    const responseConfig=await fetch("/api/push/config",{credentials:"same-origin"});
    if(!responseConfig.ok)throw new Error("Sign in to enable server notifications");
    const config=window.NOISE_PUSH_CONFIG=await responseConfig.json();
    if (!config?.enabled || !config.vapidPublicKey || !config.subscribeUrl || !registration) return;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey)
      });
    }
    const response = await fetch(config.subscribeUrl, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });
    if (!response.ok) throw new Error(`Push subscription failed (${response.status})`);
  }

  async function show(payload) {
    const options = {
      body: payload.body,
      icon: './assets/icons/notification-icon.svg',
      badge: './assets/icons/notification-icon.svg',
      tag: payload.tag,
      renotify: false,
      data: { url: './index.html#events', eventId: payload.eventId }
    };
    try {
      const worker = await registerWorker();
      await worker.showNotification(payload.title, options);
    } catch (workerError) {
      const notice = new Notification(payload.title, options);
      notice.onclick = () => {
        window.focus();
        location.hash = 'events';
        notice.close();
      };
    }
  }

  async function enableNotifications() {
    if (!supported) return;
    try {
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      updateButton();
      if (permission !== 'granted') return;
      await registerWorker();
      localStorage.setItem(pushPreferenceKey(),'true');
      baselineExistingAlerts();
      await subscribeForServerPush();
      const pushTest=await fetch("/api/push/test",{method:"POST",credentials:"same-origin"});
      if(!pushTest.ok)throw new Error("Server push test failed");
      /*await show({
        title: thai() ? 'ทดสอบการแจ้งเตือนสำเร็จ' : 'Notification test successful',
        body: thai() ? 'Mimi พร้อมแจ้งเมื่อพบเหตุการณ์เสียงใหม่แล้ว' : 'Mimi is ready to notify you about new sound events.',
        tag: `noise-alert-test-${Date.now()}`,
        eventId: 'test'
      });*/
      setStatus(thai() ? 'ส่งข้อความทดสอบแล้ว ถ้าไม่เห็นให้ตรวจโหมดห้ามรบกวนของ Windows' : 'Test sent. If it is hidden, check Windows Do Not Disturb.', 'success');
      if (typeof window.toast === 'function') window.toast(thai() ? 'ส่งการแจ้งเตือนทดสอบแล้ว' : 'Test notification sent.');
    } catch (error) {
      console.warn('Unable to enable browser notifications:', error);
      setStatus(thai() ? 'ส่งไม่สำเร็จ ลองโหลดหน้าใหม่และตรวจสิทธิ์แจ้งเตือนของ Chrome' : 'Could not send. Reload and check Chrome notification permission.', 'error');
      if (typeof window.toast === 'function') window.toast(thai() ? 'เปิดการแจ้งเตือนไม่สำเร็จ' : 'Could not enable device alerts.');
    }
  }

  async function notifyNewAlerts() {
    if (localStorage.getItem(pushPreferenceKey())==='false'||window.NOISE_PUSH_CONFIG?.enabled) return;
    if (checking || !supported || Notification.permission !== 'granted') return;
    checking = true;
    try {
      await registerWorker();
      const seen = readSeen();
      const items = alerts();
      if (localStorage.getItem(seenKey()) === null) {
        items.forEach(({ event }) => seen.add(eventId(event)));
        saveSeen(seen);
        return;
      }
      for (const { event } of items.slice().reverse()) {
        const id = eventId(event);
        if (seen.has(id)) continue;
        const title = thai() ? 'มีเสียงที่ควรลองตรวจดู' : 'A sound may need a quick look';
        const body = thai()
          ? `${event.type} ประมาณ ${Number(event.level).toFixed(1)} dB · ${event.device}`
          : `${event.type} around ${Number(event.level).toFixed(1)} dB · ${event.device}`;
        await show({ title, body, tag: `noise-${id}`, eventId: id });
        seen.add(id);
      }
      saveSeen(seen);
    } catch (error) {
      console.warn('Browser notification check failed:', error);
    } finally {
      checking = false;
    }
  }

  installControl();
  baselineExistingAlerts();

  if (supported) {
    registerWorker().then(() => {
      updateButton();
      if (Notification.permission === 'granted') subscribeForServerPush().catch(console.warn);
    }).catch(error => console.warn('Service worker registration failed:', error));
  }

  const originalUpdateNotifications = window.updateNotifications;
  if (typeof originalUpdateNotifications === 'function') {
    window.updateNotifications = function (...args) {
      const result = originalUpdateNotifications.apply(this, args);
      updateButton();
      notifyNewAlerts();
      return result;
    };
  }

  setInterval(notifyNewAlerts, 6000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) notifyNewAlerts();
  });
})();
