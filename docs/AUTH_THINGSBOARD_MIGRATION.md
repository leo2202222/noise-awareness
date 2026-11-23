# รายงานย้าย Authentication ไป ThingsBoard — 20 พฤศจิกายน 2026

## โครงสร้างและขอบเขต

ตรวจ frontend auth.html/index.html/management.js, backend server/auth/platform/push, SQLite schema, cookie, role, telemetry และ tests แล้ว ใช้หน้าเว็บ CSS และ layout เดิม ไม่แก้ ESP32-S3, Arduino หรือ MQTT

Browser → Node NAS API → ThingsBoard Cloud เป็นเส้นทางสมัครและ Login บัญชี/รหัสผ่านหลักอยู่ใน ThingsBoard Node เก็บ opaque session และ JWT/refresh token ที่เข้ารหัส AES-256-GCM ใน SQLite Browser ได้ HttpOnly SameSite=Strict cookie เท่านั้น ไม่มี Cloud token ใน localStorage

SQLite ไม่ถูกลบ: เก็บผู้ใช้เก่า salt/hash เดิม, shadow identity ของ Cloud, session, การมอบหมายอุปกรณ์, labels, audit และ push metadata บัญชี Cloud ใหม่ไม่มี hash รหัสผ่าน local เก็บไว้ ส่วน key เข้ารหัสอยู่ data/tb-session.key หรือ SESSION_ENCRYPTION_KEY ต้องสำรองคู่กับ DB โดยไม่ใส่ใน ZIP

role มาจาก authority จริง: TENANT_ADMIN → admin, CUSTOMER_USER → viewer ตรวจ tenant และ identity ผ่าน /api/auth/user ผู้สมัครกำหนด role/customer/tenant เองไม่ได้ และไม่ได้สิทธิ์อุปกรณ์อัตโนมัติ ทุก request ข้อมูลทำภายใต้ JWT ของผู้ใช้ รวม background push; cache แยก session การมอบหมายใน SQLite เพียงอย่างเดียวไม่สามารถข้ามสิทธิ์ Cloud ได้

## ความสามารถของ instance ที่ตรวจจริง

thingsboard.cloud รายงาน OpenAPI version 4.4.1PAAS ใช้ API ที่ instance รองรับจริง:

| งาน | API และพฤติกรรม |
|---|---|
| สร้าง User | POST /api/user?sendActivationMail=false&entityGroupId=... กำหนด CUSTOMER_USER เท่านั้น ไม่ใส่ password ใน User |
| เปิดใช้งาน | GET /api/user/{id}/activationLink ได้ plain text; backend อ่าน activateToken แล้ว POST /api/noauth/activate?sendActivationMail=false |
| Login | POST /api/auth/login ด้วย username/password |
| ตรวจ identity | GET /api/auth/user ด้วย JWT ของผู้ใช้ |
| Refresh | POST /api/auth/token ด้วย refreshToken |
| Logout | POST /api/auth/logout ทำ audit; ลบ NAS session และ token ที่เก็บไว้ API นี้ไม่ revoke JWT ที่ออกไปแล้ว |
| เปลี่ยนรหัส | POST /api/auth/changePassword ด้วย JWT ของเจ้าของ ติด PROFILE WRITE 403 บน Customer User ปัจจุบัน |
| Reset | POST /api/noauth/resetPassword ต้องมี resetToken จริงจาก ThingsBoard ไม่สร้าง token ปลอม |
| มอบหมายอุปกรณ์ | entityGroup, role แบบ GROUP และ groupPermission เฉพาะ READ/READ_ATTRIBUTES/READ_TELEMETRY |

Customer quota ปัจจุบันเต็ม จึงใช้ Customer ของ NAS ที่มีอยู่แล้ว และ USER group ส่วนตัวที่ไม่มี grants เดิม ตรวจทุก membership และ permission ก่อนยอมให้การสมัครสำเร็จ หากพบ inherited permission จะปฏิเสธและลบเฉพาะทรัพยากรที่เพิ่งสร้าง ห้ามใส่ผู้สมัครเข้า Customer Users แบบกว้างโดยอัตโนมัติ

Cloud service key ใช้ provisioning และแก้ profile ที่ whitelist เฉพาะ identity ของ session เท่านั้น ไม่ใช้ service key ดึง telemetry ให้ Viewer profile ไม่รับ authority/tenant/customer ที่ browser กำหนดมา การเปลี่ยนอีเมลต้องพิสูจน์รหัสปัจจุบัน

## ไฟล์ที่เพิ่มและแก้

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| auth.cjs | เลือก provider; local สำหรับ rollback |
| auth-local.cjs | สำเนาระบบเดิมรักษาบัญชี/hash/recovery เดิม |
| auth-thingsboard.cjs | Cloud auth/session encryption/refresh/role/isolation/profile/grants |
| thingsboard-client.cjs | REST client, tenant validation, activation, error mapping, rollback |
| server.cjs | async identity validation, request context, telemetry ใต้ JWT ผู้ใช้, scoped cache |
| platform.cjs | Cloud-derived role, admin device grants, ป้องกันปลอม local role |
| push.cjs | ข้อมูลแจ้งเตือนภายใต้ session และสิทธิ์ของเจ้าของ subscription |
| dist/auth.html | confirm validation, Cloud register/login, ไม่มี recovery code ปลอม, reset token จริง |
| dist/index.html | ข้อความเปลี่ยนรหัสที่สอดคล้องกับ Cloud permission |
| dist/assets/js/management.js | Cloud role readonly และอธิบาย recovery ที่รองรับ |
| scripts/migrate-auth.cjs | list/link metadata โดยไม่ export hash/password |
| scripts/recover-account.cjs | local recovery เท่านั้น ป้องกันอ้างว่า reset Cloud สำเร็จ |
| scripts/check-*.cjs, fake-thingsboard.cjs | regression แยก provider, cloud mock/browser/live tests |
| package.json, config/.env.example, scripts/package.ps1 | คำสั่งและแพ็กไฟล์ใหม่ ไม่รวม secrets/data |
| README, START_HERE_TH, docs | วิธีใช้และข้อจำกัดปัจจุบัน |

ระบบเดิมถูกแยกเป็น provider ไม่ได้ลบ SQLite หรือฟีเจอร์ IoT การตั้งค่า noise_limit ยังเขียน shared attributes จริงตามสิทธิ์ Admin และตรวจ readback การแสดง History/Insights ยังใช้ข้อมูลจริงและไม่เติมช่วงข้อมูลหาย ไม่มี runtime mock ข้อมูลใน test fixtures ใช้เฉพาะการทดสอบ

## Environment และตั้งค่า Cloud

ดู config/.env.example และ START_HERE_TH.md ทุกค่าตั้งเฉพาะ backend:

| ค่า | ความหมาย |
|---|---|
| AUTH_PROVIDER | thingsboard สำหรับหลัก; local ย้อนกลับ |
| THINGSBOARD_URL | HTTPS instance ที่ใช้งาน |
| THINGSBOARD_API_KEY | service key เดิม ฝั่ง backend เท่านั้น |
| THINGSBOARD_ADMIN_API_KEY | optional dedicated provisioning key ถ้าไม่ใส่ใช้ key เดิม |
| THINGSBOARD_TENANT_ID | จำกัด tenant ที่ยอมรับ |
| THINGSBOARD_REGISTRATION_CUSTOMER_ID | Customer ที่ตรวจยืนยันแล้วว่าถูก tenant ไม่ใช่ Tenant ID |
| THINGSBOARD_REGISTRATION_ENABLED | ปิด public signup ได้ด้วย false |
| THINGSBOARD_GROUP_SHARING | true บน Cloud/PE นี้; false ต้องจัด Cloud rights เองก่อน NAS grant |
| SESSION_ENCRYPTION_KEY | optional 32 bytes base64; ไม่ใส่จะสร้าง private key file |
| THINGSBOARD_DEVICE_ID, PORT | device เริ่มต้นและพอร์ต Node |
| NODE_ENV, COOKIE_SECURE | production และ true เมื่อโฮสต์ HTTPS |
| TRUST_PROXY | true เฉพาะ reverse proxy ที่ควบคุมเอง ส่ง x-forwarded-proto ถูกต้อง |
| VAPID_SUBJECT | public HTTPS URL หรือ contact ที่ใช้ push จริง |

1. เข้าบัญชี Tenant Administrator ของ tenant เดียวกัน ตรวจ Customer ของ NAS และ service key สิทธิ์ provisioning
2. กรอก .env ตามคู่มือ ไม่ส่ง key/password เข้า frontend หรือ repository
3. ห้ามเพิ่ม grants กว้างให้ All users/registration USER groups โค้ดจะตรวจและปฏิเสธการสมัครถ้ามีสิทธิ์ inherited อยู่แล้ว
4. รัน Node แล้ว Login ด้วยบัญชี Tenant Administrator จริง จากนั้นมอบหมายอุปกรณ์แก่ Viewer ในหน้า Users การ grant สร้าง private device group และ read-only role ไม่ย้ายเจ้าของอุปกรณ์ ไม่เปลี่ยน MQTT credentials
5. Logout/Login ใหม่หลังเปลี่ยนสิทธิ์ ตรวจ Viewer เห็นเฉพาะอุปกรณ์ที่ได้รับสิทธิ์ และแก้ Settings ไม่ได้
6. โฮสต์สาธารณะต้องมี HTTPS/reverse proxy และเก็บ service key กับ DB/private encryption key เป็นความลับ rate limit ฝั่ง Node จำกัด 30 auth attempts ต่อ 10 นาทีต่อ peer IP หลัง proxy จะนับ peer ร่วมกันได้

## ย้ายบัญชีเดิมอย่างปลอดภัย

สำรองก่อนแก้แล้วใน data/backups/before-thingsboard-auth-*.sqlite และ env-before-cloud-auth-*.private ไม่รวมใน ZIP หยุด Node ก่อนสำรอง data ใหม่ทั้งโฟลเดอร์

hash แบบ scrypt เดิมแปลงเป็น plaintext หรือ ThingsBoard password ไม่ได้ ไม่คัดลอก hash ไป Cloud ไม่ย้ายทุกบัญชีเงียบ ๆ

- หากยังไม่มีบัญชี Cloud: สมัครด้วยอีเมลเดิมและรหัส NAS เดิมเพื่อพิสูจน์ความเป็นเจ้าของ จากนั้น backend สร้าง Cloud account ผ่าน activation และผูก row เดิม salt/hash เก่ายังคงอยู่ บทบาทใหม่ตาม Cloud จึงเป็น Viewer
- หากมี Cloud account อีเมลเดียวกันแล้ว และรหัสเก่าต่างกัน: ผู้ดูแลเครื่องตรวจบัญชีจริง แล้วใช้ CLI link ด้านล่าง จากนั้น Login ด้วยรหัส ThingsBoard
- Tenant Admin ต้องใช้บัญชี Tenant Administrator จริง ไม่มีการสืบทอด admin จากบัญชีแรกใน NAS โดยอัตโนมัติ

```powershell
npm.cmd run migrate:list
node --env-file=.env scripts/migrate-auth.cjs --link LOCAL_USER_ID THINGSBOARD_USER_ID
```

CLI ตรวจอีเมล tenant และ authority ก่อนเชื่อม รักษา hash เก่าและ revoke NAS sessions ไม่แก้รหัส Cloud การ rollback ตั้ง AUTH_PROVIDER=local แล้ว restart แต่ Cloud accounts ใหม่ไม่มี local password ให้ Login อัตโนมัติ บัญชีเก่าที่ผูกไป Cloud ยังมี hash เดิมอยู่แต่ต้องวางแผนคืน mapping/backup ก่อนใช้งาน local จริง ห้ามทับฐาน production ด้วย backup โดยไม่ตรวจข้อมูลใหม่

## รันและทดสอบบน Windows

Node.js 24 ใช้ npm.cmd เพื่อหลีกเลี่ยง PowerShell npm.ps1 execution policy ห้าม Live Server

```powershell
cd D:\Dowload\work\cpe231\finalproject\web\noise-awareness
npm.cmd ci
npm.cmd run check
npm.cmd test
npm.cmd run test:cloud-browser
npm.cmd start
```

เปิด http://127.0.0.1:3000/auth.html สมัครแล้วต้องไม่มีอุปกรณ์ของผู้อื่น Login ผิดต้องไม่สร้าง session Logout ต้องเข้า protected API ไม่ได้ ทดสอบ grant/revoke ด้วย Admin จริงภายหลังโดยผู้ดูแล

## ผลทดสอบที่ทำจริง

รอบล่าสุด syntax, npm test และ Cloud browser suite ผ่าน Mock transport แยกจาก runtime ทั้งหมด:

| กรณี | ผล/ขอบเขต |
|---|---|
| 1 สมัครสมาชิก | mock+browser+Cloud จริง ผ่าน activation/password setup |
| 2 Email ซ้ำ | mock+Cloud จริง ปฏิเสธ |
| 3 Confirm password ไม่ตรง | mock+browser ปฏิเสธก่อนสร้าง Cloud user |
| 4 Login สำเร็จ | mock+browser+Cloud Customer User จริง ผ่าน |
| 5 รหัสผิด | mock+Cloud จริง ปฏิเสธ |
| 6 Logout | mock+browser+Cloud audit และ NAS session invalidation ผ่าน |
| 7 Local session หมดอายุ | mock ผ่าน |
| 8 Viewer เข้า Admin | mock+browser ปฏิเสธ |
| 9 Device ไม่ได้รับสิทธิ์ | mock+Cloud จริง ปฏิเสธ แม้แทรก local grant ทดสอบ |
| 10 Dashboard หลัง Login | mock+browser telemetry fixture ผ่าน; Cloud API จริงผ่านกับอุปกรณ์เปล่าของ test ไม่ส่ง telemetry ปลอม |
| 11 Cloud ไม่พร้อม | mock 503 session ยังไม่ถูกลบ ผ่าน |
| 12 Refresh หมดอายุ/ผิด | mock expiry+refresh ผ่าน; Cloud refresh จริงและ invalid refresh rejection ผ่าน |

เพิ่มเติม: encrypted token at rest, ไม่มี JWT ใน browser/response, role injection, rollback เมื่อกลุ่มมี inherited permissions, profile Cloud persistence, read-only cloud write denial, grant/revoke จริง ผ่าน Live test ลบทรัพยากรชั่วคราว 7 รายการแล้ว ไม่แตะอุปกรณ์ NAS เดิมหรือบัญชีเดิม ไม่มีการใส่ข้อมูลเซ็นเซอร์จำลอง

การเปลี่ยนรหัสผ่านผ่าน mock ที่กำหนด policy ให้รองรับ แต่ Cloud จริงยัง 403 PROFILE WRITE จึงไม่นับว่าฟีเจอร์นี้ผ่านจริง ไม่มีรหัสผ่าน Tenant Administrator สำหรับทดสอบ credential login จริงของเจ้าของ ส่วน admin role/grant ทดสอบด้วย mock และ service provisioning key จริง ต้องยืนยัน owner Login ด้วยตนเอง

ข้อมูล NAS เดิมที่ตรวจแบบอ่านก่อนหน้า: 17 samples / 9 observed alert intervals ล่าสุด 19 พฤศจิกายน 2026 18:19:48 Asia/Bangkok เป็น snapshot ตอนตรวจ ไม่ใช่การยืนยันว่าอุปกรณ์ออนไลน์ตอนนี้

## ข้อจำกัดและสิ่งที่ยังต้องทำ

- PROFILE READ/WRITE ยังไม่ได้ grant ดู PROFILE_PERMISSION_REVIEW.md ต้องได้รับอนุญาตชัดเจนและทดสอบ isolation ก่อนทำ จึงยังไม่เรียกว่าพร้อม production ครบทุกฟังก์ชัน
- Cloud reset ต้องมี resetToken จริง รหัสกู้คืน NAS ใช้ reset Cloud ไม่ได้ และไม่มีการสร้าง API ที่ไม่มีจริงมาทดแทน
- Logout ลบ local session/ความลับที่เก็บไว้และเรียก cloud audit ไม่อ้างว่า revoke JWT แล้ว
- Customer quota เต็ม จัด private groups ใน Customer เดิม หากเพิ่ม users/groups เกิน plan Cloud จะปฏิเสธตามจริง
- การส่ง push ถึง OS และ firmware applied_config_version ต้องตรวจบนอุปกรณ์จริงตามคู่มือเดิม ยังไม่เปลี่ยน firmware
- ต้องทดสอบ owner TenantAdmin Login, deployment HTTPS และการใช้งานกับ sensor ขณะออนไลน์ก่อนส่งเป็นระบบ production

แหล่งข้อมูล: deployed OpenAPI https://thingsboard.cloud/v3/api-docs, official REST https://thingsboard.io/docs/reference/rest-api/, Cloud users https://thingsboard.io/docs/paas/user-guide/users/
## Update: Customer device creation

Customer users can now open Connect / create device without an administrator role.
- Existing UUID: checked using the customer's own ThingsBoard JWT (entity and telemetry read). If accessible, the website connects it to that account automatically. No grants are added to someone else's existing device.
- Blank UUID: backend provisioning creates a real device in the authenticated user's Cloud Customer, plus a private USER/DEVICE group and read-only grant for that newly created device. The device is automatically connected to its creator. This does not grant PROFILE permissions or change the user's authority.
- Duplicate connections return a clear conflict. Existing global device labels are retained when another authorized user connects the same device.
- Settings writes and administrative user management retain their existing permissions.
- Creation depends on the ThingsBoard service key, entity-group sharing and Cloud plan quotas; upstream failures are shown rather than inventing a successful device.

Tests added: Customer create + automatic membership + scoped read, inaccessible UUID denial, duplicate connection, accessible existing device connection, and browser Customer button/form opening. Mock tests are isolated from production data. Live test now also exercises this flow with temporary resources and no fabricated telemetry.

ผลตรวจรอบ Customer update: npm test, syntax และ Cloud browser tests ผ่าน การทดสอบ Cloud จริงสองครั้งติดต่อ upstream ไม่สำเร็จ (503/timeout) ตั้งแต่ก่อนสร้างทรัพยากร จึงยังไม่ได้ยืนยัน Customer create flow ใหม่กับ Cloud จริงในรอบนี้ ไม่มีทรัพยากรทดสอบสร้างค้างไว้ ผล live ที่ผ่านก่อนหน้านี้เป็น auth/grant flow รุ่นก่อน ไม่ใช่หลักฐานว่า Customer create ใหม่นี้ผ่านแล้ว

Existing-device connection update: a Customer can self-connect an existing device in the SAME ThingsBoard tenant and Customer even without a previous read grant. Backend verifies ownership via the service API before creating a private read-only grant; devices in another Customer remain denied. Added mock tests cover this path and scoped telemetry access. This supersedes the earlier requirement for pre-existing Cloud read permission. Live verification of this update is still pending.

Cloud group ownership fix: Customer-owned devices must be added to a DEVICE group owned by that same CUSTOMER, not a TENANT-owned group. Fixed provisioning/connection helper and strengthened mock membership validation. Live Customer create + automatic connection + scoped empty Dashboard passed; 12 temporary resources removed. No existing NAS device ownership, MQTT credentials or telemetry changed.

Customer Edit/Disconnect update: Customer can edit website name/location of connected devices after Cloud access validation, and disconnect their own website membership. Customer disconnect preserves the device, telemetry and other users' connections. Settings permissions are unchanged. Syntax, API regression (edit/unassigned denial/disconnect preservation) and browser Edit/Disconnect dialog checks passed using isolated mock transport.
