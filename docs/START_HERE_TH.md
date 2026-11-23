# วิธีเริ่มใช้งาน NAS

1. ติดตั้ง Node.js 24 เปิด Terminal ใน noise-awareness ที่มี server.cjs
2. รัน `npm.cmd ci --omit=dev`
3. เครื่องใหม่เท่านั้น: `Copy-Item config/.env.example .env` อย่าทับ .env เดิม
4. ใส่ค่าฝั่งเซิร์ฟเวอร์ใน .env:

```dotenv
AUTH_PROVIDER=thingsboard
THINGSBOARD_URL=https://thingsboard.cloud
THINGSBOARD_API_KEY=ใส่คีย์จริงในเครื่องเท่านั้น
THINGSBOARD_TENANT_ID=3c85f930-29f7-11f1-93d4-a32bb61f9d35
THINGSBOARD_REGISTRATION_CUSTOMER_ID=a92a4620-e196-11f1-8cd9-6b9990469fa2
THINGSBOARD_DEVICE_ID=26330d60-e196-11f1-ba8b-c1a2c9300913
THINGSBOARD_REGISTRATION_ENABLED=true
THINGSBOARD_GROUP_SHARING=true
PORT=3000
```

5. รัน `npm.cmd start` เปิด http://127.0.0.1:3000/auth.html ใช้บัญชี ThingsBoard จริง
6. ผู้ดูแลใช้ Tenant Administrator ของ tenant นี้ ผู้สมัครใหม่เป็น Viewer รอ Admin มอบหมายอุปกรณ์ในหน้า Users จึงจะเห็นข้อมูล
7. บัญชี NAS เก่าไม่ถูกลบ แต่ Login แบบ Cloud ต้องย้ายก่อน ดู docs/AUTH_THINGSBOARD_MIGRATION.md

ไม่ต้องส่งรหัสผ่านหรือ API key ผ่านแชต ห้ามเปิดหน้าเว็บผ่าน Live Server เพราะไม่มี API backend
กด Ctrl+C เพื่อหยุด ก่อนสำรองโฟลเดอร์ data และ .env แยกเก็บส่วนตัว
ย้อนกลับชั่วคราว: ตั้ง AUTH_PROVIDER=local แล้ว restart ใช้ข้อมูลบัญชีเดิมที่เก็บไว้
บัญชี Cloud ที่สร้างใหม่ไม่ได้กลายเป็นบัญชี local อัตโนมัติ

ข้อจำกัดที่ยังเหลือ: Customer User เปลี่ยนรหัสผ่านติด PROFILE WRITE; ยังไม่ได้เพิ่มสิทธิ์ถาวรนี้ และ Cloud reset ต้องมี token จริงของ ThingsBoard

Customer เพิ่มอุปกรณ์ได้แล้ว: เปิด Device Management > Connect / create device ใส่ UUID เพื่อเชื่อมอุปกรณ์ที่บัญชีเข้าถึงได้ หรือเว้น UUID เพื่อสร้างอุปกรณ์จริงและเชื่อมเข้าบัญชีอัตโนมัติ ไม่ต้องให้ Admin ติ๊กมอบหมายก่อนสำหรับอุปกรณ์ที่สร้างเอง ขึ้นกับโควตาของ ThingsBoard

## รายการ Device ไม่หายหลัง Render restart / deploy

เวอร์ชันนี้เก็บ Device ID ชื่อ และสถานที่ไว้กับบัญชีผู้ใช้ ThingsBoard ใน additionalInfo.nasV2.deviceConnections โดยไม่เก็บรหัสผ่านหรือ token ในฟิลด์นี้ เมื่อ Login เว็บจะโหลดรายการกลับมาใส่แคช SQLite ให้อัตโนมัติ ทั้ง Connect, Edit และ Disconnect ตรวจ readback จาก Cloud ก่อนแจ้งสำเร็จ

รายการเก่าที่ยังอยู่ใน SQLite จะถูกย้ายเมื่อบัญชีเข้าใช้งาน หากแคชเก่าหายไปแล้ว ระบบจะพยายามกู้จากกลุ่ม NAS เดิมที่บัญชียังอ่านอุปกรณ์ได้จริง ชื่อ/สถานที่ซึ่งไม่เคยถูกบันทึกบน Cloud อาจกู้คืนไม่ได้ รายการที่ Disconnect ในเวอร์ชันใหม่นี้จะไม่กลับมาเอง

หลัง Deploy บน Render ฟรี อาจต้อง Login และเปิด Push ใหม่ แต่รายการ Device ที่บันทึกด้วยเวอร์ชันนี้ไม่ต้องกด Connect ใหม่ ข้อมูล telemetry และค่า noise_limit ยังอยู่ใน ThingsBoard ตามเดิม
