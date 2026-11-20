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
