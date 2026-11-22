# Noise Awareness System — ThingsBoard authentication

บัญชีหลักใช้ ThingsBoard Cloud ผ่าน Node backend; หน้าเว็บและระบบ IoT เดิมยังใช้งานต่อ บัญชี SQLite เดิมเก็บไว้สำหรับย้ายและ rollback

เริ่มที่ [START_HERE_TH.md](START_HERE_TH.md) และอ่านรายงาน [การย้ายบัญชีและผลทดสอบ](docs/AUTH_THINGSBOARD_MIGRATION.md)

- สมัครสมาชิกผ่าน activation/password setup จริงของ ThingsBoard ผู้สมัครเป็น Viewer และไม่มีสิทธิ์ดูอุปกรณ์อัตโนมัติ
- Login ด้วยบัญชี ThingsBoard; Tenant Administrator เป็น NAS Admin; Customer User เป็น Viewer
- JWT/refresh token เข้ารหัสฝั่งเซิร์ฟเวอร์ Browser ได้เฉพาะ HttpOnly session cookie
- Dashboard/History/Insights ใช้ telemetry จริงและตรวจสิทธิ์ Cloud ของผู้ใช้ ไม่ส่งข้อมูลด้วยสิทธิ์ service admin ให้ Viewer
- รายการอุปกรณ์ที่เชื่อม ชื่อ และสถานที่ เก็บหลักใน ThingsBoard User additionalInfo และกู้กลับหลัง Login
- SQLite เก็บแคชรายการอุปกรณ์, session metadata, audit, push subscriptions และสำเนาบัญชีเก่า
- เปลี่ยนรหัสผ่านของ Customer User ยังติดสิทธิ์ PROFILE WRITE บน instance จริง ยังไม่ได้เพิ่มสิทธิ์นี้ ดู docs/PROFILE_PERMISSION_REVIEW.md
- Cloud reset ต้องใช้ reset token จริงของ ThingsBoard รหัสกู้คืน NAS เดิมใช้ได้เฉพาะโหมด local

## รันบน Windows

Node.js 24: เปิด Terminal ในโฟลเดอร์นี้ แล้ว `npm.cmd ci --omit=dev`, คัดลอก `.env.example` เป็น `.env` เฉพาะเครื่องใหม่ ตั้งค่าตามคู่มือ และ `npm.cmd start`
เปิด http://127.0.0.1:3000/auth.html ห้ามใช้ Live Server พอร์ต 5500 แทน backend

## ทดสอบและแพ็ก

ติดตั้ง dev dependencies ด้วย `npm.cmd ci`; รัน `npm.cmd run check`, `npm.cmd test`, `npm.cmd run test:cloud-browser`
Tests เหล่านี้ใช้ข้อมูลแยกและ mock transport ไม่ใช่ telemetry ของระบบจริง
`npm.cmd run test:cloud-live` สร้างบัญชี/อุปกรณ์เปล่าชั่วคราวบน Cloud จริงแล้วลบคืน ต้องมีสิทธิ์ provisioning; ไม่ส่งข้อมูลเซ็นเซอร์จำลอง
`powershell -ExecutionPolicy Bypass -File scripts/package.ps1` สร้าง ../noise-awareness.zip มีโฟลเดอร์เดียว ไม่รวม .env, data, node_modules และผลทดสอบ

เครื่องใช้งานจริงต้องใช้ HTTPS, NODE_ENV=production, COOKIE_SECURE=true และเก็บ data/tb-session.key หรือ SESSION_ENCRYPTION_KEY พร้อมฐานข้อมูลเป็นความลับ
