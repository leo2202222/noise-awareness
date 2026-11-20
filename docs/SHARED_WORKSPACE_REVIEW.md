# Shared workspace proposal — pending approval

Requested behavior: keep Login, remove NAS Admin/Viewer distinction, and allow every authenticated account in the configured tenant to view and manage all devices connected to this website, including changing noise thresholds and disconnecting website device records. No ThingsBoard device or telemetry deletion is proposed.

Implementation requiring approval: authorize this shared workspace in the Node backend and use the backend-only tenant service key for its device/telemetry operations. Keep Cloud credential login, tenant checks and HttpOnly sessions. Do not expose the key, change ThingsBoard user authority, or add PROFILE permissions. Disable the obsolete user-role management endpoints. The API proxy remains a fixed server-side set of device and telemetry operations, not an arbitrary URL proxy.

Impact: every successful signup/login accepted by this website could view the shared devices and change their settings. Customer ownership boundaries would no longer separate device access inside NAS. Existing Cloud roles would remain unchanged. This is a persistent access-policy change, not merely a UI edit.

Automatic approval review rejected applying this policy without explicit confirmation of that impact. It has NOT been implemented. Current changes only enable Settings controls for all signed-in users and remove visible Role text. Existing Cloud JWT permissions, device membership and backend role management remain in place; therefore the full no-role request is not complete yet.
