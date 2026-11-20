# Authentication integration

ระบบหลักใหม่ใช้ ThingsBoard ดูรายละเอียด API, โครงสร้าง, migration และผลทดสอบที่ [AUTH_THINGSBOARD_MIGRATION.md](AUTH_THINGSBOARD_MIGRATION.md)

ข้อมูลเดิมใน SQLite ไม่ถูกลบ auth-local.cjs คงระบบเดิมสำหรับ rollback เท่านั้น ข้อความบัญชีแรกเป็น Admin และ recovery code ใช้ได้กับ AUTH_PROVIDER=local ไม่ใช่ ThingsBoard provider
Cloud Admin มาจาก authority TENANT_ADMIN ของ ThingsBoard เท่านั้น JWT และ refresh token ไม่ส่งไป Browser
