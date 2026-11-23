# เปิดไฟล์ไหนเมื่อต้องอธิบายโปรเจกต์

เริ่มอ่านไฟล์นี้ก่อน ใช้เป็นแผนผังตอนสาธิตและตอบคำถาม ส่วนวิธีเปิดเว็บอยู่ใน START_HERE_TH.md

## โครงสร้างที่ใช้จริง

```text
noise-awareness/
├─ server.cjs               ← จุดเริ่มต้นสำหรับ npm / Render
├─ package.json             ← คำสั่งรันและ dependencies
├─ package-lock.json        ← ล็อกเวอร์ชัน dependencies
├─ README.md                ← ภาพรวมและลิงก์คู่มือ
├─ .gitignore               ← กฎไม่เอาข้อมูลส่วนตัวขึ้น Git
├─ backend/                 ← โค้ดหลังบ้านรวมไว้ที่เดียว
│  ├─ server.cjs            ← HTTP server / telemetry / ประวัติ / สถิติ
│  ├─ auth.cjs              ← เลือกระบบ Login
│  ├─ auth-thingsboard.cjs  ← บัญชี Cloud / session / จำรายการ Device
│  ├─ auth-local.cjs        ← บัญชีเดิมสำหรับ rollback
│  ├─ thingsboard-client.cjs ← เรียก ThingsBoard REST API
│  ├─ platform.cjs          ← Device และ Shared attributes
│  └─ push.cjs              ← Push ฝั่งเซิร์ฟเวอร์
├─ config/
│  └─ .env.example          ← ตัวอย่างค่าฝั่งเซิร์ฟเวอร์ ไม่มีคีย์จริง
├─ dist/                    ← หน้าเว็บและไฟล์ที่ browser ใช้
│  ├─ index.html            ← Dashboard / History / Insights / Settings
│  ├─ auth.html             ← Login / Register / Reset
│  ├─ login.html            ← หน้าเข้าใช้งานเดิม
│  ├─ sw.js                 ← Service Worker ของ Push
│  ├─ assets/css/           ← CSS กลาง
│  ├─ assets/js/            ← JavaScript หน้าเว็บแยกหน้าที่
│  ├─ assets/icons/         ← ไอคอน
│  └─ config/               ← ตั้งค่าฝั่ง browser
├─ docs/                    ← คู่มือทั้งหมด
│  ├─ README.md             ← สารบัญคู่มือ
│  ├─ START_HERE_TH.md      ← วิธีเปิดเว็บ
│  └─ PROJECT_GUIDE_TH.md   ← แผนผังและแนวตอบคำถาม (ไฟล์นี้)
└─ scripts/                 ← ทดสอบ ย้ายบัญชี และสร้าง ZIP
```

ไฟล์ที่มีเฉพาะเครื่องทำงาน: .env เก็บ secret; data/ เก็บฐานข้อมูลและสำรอง; node_modules/ เป็น library ที่ติดตั้ง; .test-results/ เป็นผลทดสอบ ไฟล์กลุ่มนี้ไม่อยู่ใน ZIP สำหรับ GitHub

## จำไฟล์หลักแค่ 7 จุดก่อน

| ถ้าถูกถามเรื่อง | เปิดไฟล์ | อธิบายว่า |
|---|---|---|
| หน้าเว็บและกราฟ | dist/index.html | รับ snapshot จาก backend แล้วแสดงค่า กราฟ ประวัติและสถิติ ภายในไฟล์ยังมี JavaScript หลักด้วย |
| ตัวเริ่มเซิร์ฟเวอร์ | backend/server.cjs | เปิด HTTP server, เสิร์ฟหน้าเว็บ, ตรวจ session และดึง telemetry จาก ThingsBoard |
| การเรียก Cloud API | backend/thingsboard-client.cjs | จัด header, timeout, ข้อผิดพลาด และตรวจ tenant โดยเก็บ credential ฝั่งเซิร์ฟเวอร์ |
| Login และจำ Device | backend/auth-thingsboard.cjs | ตรวจบัญชีกับ ThingsBoard, เก็บ token เข้ารหัสฝั่ง server และบันทึกรายการ Device กับบัญชี Cloud |
| เพิ่ม/แก้/ลบการเชื่อมและ Limit | backend/platform.cjs | ตรวจคำขอ จัดการรายการอุปกรณ์ และเขียน noise_limit ลง Shared attributes พร้อมอ่านกลับ |
| ขออนุญาตและแจ้งเตือนใน browser | dist/assets/js/browser-notifications.js | แสดงกล่องชวนเปิดแจ้งเตือน รับการอนุญาต และเรียก native notifications |
| แจ้งเตือนจาก backend | backend/push.cjs และ dist/sw.js | backend ตรวจ telemetry และส่ง Push; Service Worker รับแล้วให้เบราว์เซอร์แสดงแจ้งเตือนระบบ |

## ข้อมูลเดินทางอย่างไร

1. ESP32 อ่านเซ็นเซอร์/ผลจำแนกเสียง แล้วส่ง telemetry เข้า ThingsBoard Cloud
2. หน้าเว็บขอ snapshot จาก Node.js backend ทุกประมาณ 5 วินาที
3. backend ตรวจตัวตนและสิทธิ์ของบัญชี แล้วเรียก ThingsBoard ผ่าน REST API
4. backend จับคู่ค่าตามเวลาและเตรียมข้อมูล หน้าเว็บนำไปแสดง Dashboard/History/Insights
5. เมื่อบันทึก Settings เว็บส่ง noise_limit ไป backend; backend เขียน Shared attributes ของ Device แล้วอ่านกลับเพื่อตรวจผล

พูดสั้น ๆ: “ESP32 ส่งข้อมูลให้ ThingsBoard ส่วน Node.js เป็น backend ของเว็บ และหน้าเว็บใช้แสดงผลกับรับคำสั่งผู้ใช้ครับ”

## อะไรเก็บที่ไหน

| ข้อมูล | ที่เก็บหลัก |
|---|---|
| ข้อมูลเสียง dB และผลจำแนก | ThingsBoard telemetry |
| speech / music / noise | อ่านจาก sound_class เป็นหลัก และรองรับ sound_type ของเวอร์ชันเก่า |
| ค่า Limit | ThingsBoard Device → Shared attributes → noise_limit |
| บัญชีและรหัสผ่านหลัก | ThingsBoard User/authentication |
| Device ที่แต่ละบัญชีเชื่อม ชื่อ และสถานที่ | ThingsBoard User additionalInfo.nasV2.deviceConnections |
| session, token ที่เข้ารหัส, cache, audit และ push subscriptions | SQLite ฝั่ง Node.js ใน data/ |
| ภาษา การเคลื่อนไหว และความต้องการเปิดแจ้งเตือน | localStorage ใน browser |
| service API key | .env บนเครื่อง หรือ Environment Variables บน Render |

## แนวตอบคำถามที่สำคัญ

**ใช้ ThingsBoard แล้วมี Node.js ทำไม?**
Node.js ให้บริการหน้าเว็บ จัดการ session ตรวจคำขอ เก็บ key ฝั่งหลังบ้าน และเรียก Cloud API ส่วน ThingsBoard เก็บและจัดการข้อมูล IoT/บัญชี

**AI ทำงานที่ไหน?**
เว็บรับผลจำแนกที่อุปกรณ์ส่งมา เว็บนี้ไม่ได้ฝึกหรือรันโมเดลจำแนกเสียงเอง โค้ด firmware/โมเดลไม่ได้อยู่ในโฟลเดอร์เว็บนี้

**Speech เคยขึ้น Unknown เพราะอะไร?**
อุปกรณ์ใช้ sound_class แต่เว็บเก่าอ่าน sound_type ปัจจุบันอ่าน sound_class ก่อน และจับคู่กับ sample dB ที่ตามมาไม่เกิน 2 วินาที ถ้าไม่มีข้อมูลที่จับคู่ได้จริง ยังแสดง Unknown

**Normal กับ Alert คิดอย่างไร?**
ข้อมูลสดเทียบ dB >= noise_limit จาก Shared attributes ส่วน History ใช้ Limit ที่เคยบันทึกใน telemetry ก่อนหรือ ณ เวลา sample นั้น เพื่อไม่เอาค่าใหม่ไปเปลี่ยนอดีต ถ้าไม่มี Limit ย้อนหลังจะใช้ device alert ที่บันทึกไว้ หากข้อมูลไม่พอจะแสดง Unknown

**ทำไม History กับ Insights นับไม่เท่ากัน?**
History แสดงบันทึกละเอียด ส่วน Insights เวอร์ชันปัจจุบันรวมประเภทเสียงเดียวกันที่ต่อเนื่องเป็นเหตุการณ์เดียว ถ้าเปลี่ยนประเภทหรือข้อมูลขาดเกิน 30 วินาทีจะแยกเหตุการณ์ ไม่ตีความว่าข้อมูลหายคือความเงียบ Alert ต่อเนื่องนับเป็นช่วงเหตุการณ์ ข้อมูลละเอียดเดิมยังอยู่ครบ

**ข้อมูลเป็นค่าจริงหรือจำลอง?**
ระบบใช้งานจริงดึงจาก ThingsBoard ไม่มี runtime mock ส่วน fake-thingsboard.cjs และข้อมูลทดสอบใน scripts/ ใช้ทดสอบแยก ไม่ใช่ข้อมูลที่นำไปแสดงในเว็บใช้งานจริง

**Save Limit สำเร็จ แปลว่าอุปกรณ์เปลี่ยนค่าแล้วทันทีไหม?**
ยืนยันว่า Cloud บันทึกได้เมื่ออ่านค่ากลับตรงกัน ส่วน ESP32 ต้องรับและนำ Shared attributes ไปใช้เอง จึงจะยืนยันการเปลี่ยนค่าฮาร์ดแวร์ได้

**Disconnect ลบเซ็นเซอร์หรือข้อมูล Cloud ไหม?**
นำการเชื่อมออกจากรายการของบัญชี ไม่ลบอุปกรณ์หรือ telemetry ใน ThingsBoard และบันทึกรายการใหม่บน Cloud เพื่อไม่ให้รายการกลับมาเองหลัง restart

**Deploy ใหม่แล้ว Device หายไหม?**
เวอร์ชันปัจจุบันกู้รายการ Device จากบัญชี ThingsBoard หลัง Login ได้แล้ว แต่ Render Free ยังสูญเสีย session และ push subscriptions ใน SQLite ได้ จึงอาจต้อง Login/เปิด Push ใหม่

**มีข้อจำกัดอะไรที่ยังเหลือ?**
Render Free พักบริการเมื่อไม่มีคนใช้ จึงรับประกัน Push ขณะปิดเว็บตลอดเวลาไม่ได้ ประวัติขึ้นกับข้อมูลที่ ThingsBoard ยังเก็บและขีดจำกัด query เปลี่ยนรหัสผ่าน Customer ยังขึ้นกับสิทธิ์ PROFILE ของ Cloud และเว็บไม่สามารถรับรองค่าของเซ็นเซอร์ที่ไม่ผ่านการสอบเทียบ

## ไฟล์ JavaScript หน้าเว็บที่เหลือ

| ไฟล์ใน dist/assets/js/ | หน้าที่ |
|---|---|
| management.js | ฟอร์ม Device/Settings และการผูกปุ่มจัดการหน้าเว็บ |
| thingsboard-adapter.js | ส่ง HTTP request จากหน้าเว็บไป API ของ Node.js |
| local-auth.js | ตัวเรียก API บัญชี/Session จาก browser ชื่อไฟล์มาจากระบบเดิม ปัจจุบันไม่ได้เก็บรหัสผ่าน Cloud ใน browser |
| preferences.js | ภาษาและการเคลื่อนไหวของ UI |
| ux-enhancements.js | พฤติกรรมและรายละเอียดการแสดงผลเพิ่มเติม |

## วิธีเปิดและตรวจงาน

```powershell
cd D:\Dowload\work\cpe231\finalproject\web\noise-awareness
npm.cmd start
```

เปิด http://127.0.0.1:3000/auth.html

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run test:cloud-browser
```

คำสั่งตรวจทั่วไปใช้ fixture แยก ส่วน test:cloud-live สร้างบัญชี/อุปกรณ์ชั่วคราวบน Cloud จริงและลบคืน จึงไม่ควรรันสาธิตโดยไม่อธิบายผลกระทบก่อน

## ลำดับเปิดไฟล์ตอนสาธิต

1. เปิดไฟล์นี้ให้เห็นโครงสร้าง
2. เปิดหน้าเว็บ Dashboard แสดงข้อมูลจริง
3. เปิด backend/server.cjs อธิบายการดึงข้อมูล
4. เปิด backend/platform.cjs อธิบาย Shared attributes
5. เปิด backend/auth-thingsboard.cjs อธิบาย Login และการจำ Device
6. เปิด browser-notifications.js / backend/push.cjs / sw.js เมื่อถูกถามเรื่องแจ้งเตือน
7. เปิด docs/ เฉพาะรายละเอียดที่ถูกถาม
