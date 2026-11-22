# Web Push

The server uses web-push and stores its VAPID key pair and subscriptions privately
in data/auth.sqlite. GET /api/push/config exposes only the public key to signed-in
users. POST /api/push/subscribe enrolls the current browser. POST /api/push/test
sends a real encrypted test notification through its provider. DELETE
/api/push/subscribe turns server notifications off for that account.

When the actual server is running it polls telemetry every 15 seconds for users
with active sessions/subscriptions. Each browser receives only assigned-device
alerts. Old readings are not replayed on enrollment. A fresh transition into
Alert triggers a notification; continued Alert samples do not spam repeatedly.
Stale readings (>60 seconds) are not pushed. Endpoints that expire (404/410) are
removed. Other delivery failures are logged without exposing endpoint secrets.

Opt-in/out is remembered in the browser. Logout, password reset, password change
and permission revocation remove affected push subscriptions. Log in and enable
notifications again after such changes if needed.

Closing the website tab is supported; the Node server, push provider, browser
background service and OS notifications must remain available. Closing/shutting
down the browser/PC can prevent delivery. Grant notification permission and
check Do Not Disturb on Windows. localhost is supported for local Chrome demos.
Public hosting requires HTTPS and COOKIE_SECURE=true. Set VAPID_SUBJECT to the
real HTTPS site/contact URI. The local default is not supported by Apple Push;
configure a real public subject before Safari deployment.

The push transport is covered by isolated tests and encrypted request generation
is verified with the real library. A user must perform the browser enrollment
and press the server test button to validate delivery on their actual OS.

## Sound categories and push recovery update

The supported classifications are speech, music and noise. Matching ignores case and outer whitespace; display labels are Speech, Music and Noise. Legacy music/media and background noise labels map to Music and Noise. Missing/unsupported values remain Unknown in records instead of being fabricated as Noise; Insights shows only the three supported classes and calculates shares over classified records.

Fixed notification enrollment so a successful config fetch alone does not disable foreground fallback. After enrollment failure, fresh alerts can still appear while the page is open. Old/repeated records are suppressed. Browser subscriptions compare VAPID keys and resubscribe when the server key changes, and reconcile after authentication and periodically while open. Push test errors report expired subscriptions/provider failures rather than a generic ThingsBoard error.

To test on the deployed site: upload updated files to the SAME GitHub repository, let Render redeploy, then open the HTTPS site, Login, click the bell, and choose Turn on device alerts / Send a test notification. Allow notification permission and check OS Do Not Disturb. If enrollment fails but foreground permission works, a clearly labeled local test is shown and the UI reports that background delivery failed. A mock test is not evidence of OS delivery.

Render Free still sleeps without traffic and loses SQLite/VAPID/subscriptions on restart. Re-enrollment repairs the open browser, but cannot guarantee closed-tab/background delivery while the server sleeps. Persistent/always-on hosting remains required for reliable background alerts. No fabricated sensor telemetry was posted for these tests.

## Native system notifications only

The in-page corner popup has been removed at the user's request. The header now has Enable Windows notifications / Test Windows notification. A user click requests browser permission and calls ServiceWorkerRegistration.showNotification directly. The native test does not wait for the remote push provider. Background subscription is attempted separately, with a separate Test background delivery control in the bell panel. Fresh current alerts also use native OS notifications while the page is open; a continuous alert is not repeated.

After updating, reload with Ctrl+F5, click the system notification button, and Allow the browser prompt. On Windows check Settings > System > Notifications, enable the browser and notification banners, and disable Do Not Disturb. Software tests verify the native API calls and browser controls; actual banner rendering requires a test on the user's desktop. Render Free still cannot guarantee closed-tab delivery while the server sleeps.

## Threshold-triggered notification fix

Live notification status now compares actual sound_db >= noise_limit. The threshold is read from ThingsBoard Shared attributes first, falling back to the real telemetry noise_limit only if no shared value is available. Current notificationStatus is separate from the device-reported alertStatus: Windows alerts, background pushes and the live Dashboard use notificationStatus; recorded history/intervals retain the device's original alert values. If no numeric threshold exists, the current device alert is the fallback; no threshold is invented.

The fix is tested at exact equality (85 dB / shared limit 85), while telemetry carries an older limit (75) and device alert is false. It triggers a notification and keeps the recorded alert Normal. Continuous above-limit readings do not repeat; a new below-to-at/above crossing triggers again. Stale/future records remain excluded. Initial fresh above-limit readings can notify; a saved limit change is also considered. Tests use isolated sensor fixtures, not fabricated Cloud telemetry.

## Entry permission invitation

After Login, users who have not enabled system notifications see a small invitation with Enable notifications / Not now. Enable calls the existing native permission handler directly from the click; the browser permission request is not fired on page load. Not now defers the invitation for 24 hours per account. Already-enabled, explicitly turned-off, denied-permission, unsupported and signed-out states do not show the invitation. The removed permanent header test button stays removed; actual alerts remain native OS notifications. Browser tests cover invitation visibility, dismissal across reload, trusted click activation, permission grant, and native test invocation with isolated mocks.

Notification panel cleanup: removed Windows-test/background-test buttons from the UI. The remaining Enable notifications control is hidden once enabled; Turn off system alerts remains available. Permission enrollment still shows the native confirmation notification. Fixed History filter overlap by raising the header stacking context only while the bell panel is open and bounding panel/list height to the viewport. Browser tests check the element at the overlap point belongs to the notification panel and verify no test buttons remain.
