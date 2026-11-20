# Submission status — 20 November 2026

Authentication changed to ThingsBoard. Current results, migration and outstanding limitations are documented in AUTH_THINGSBOARD_MIGRATION.md.
Do not use previous local-provider recovery-code and first-admin tests as proof of Cloud capabilities.
Syntax, local regression, Cloud mock and Cloud browser tests pass. Live Cloud registration, activation, credential login, duplicate rejection, refresh, profile persistence, device isolation/read grant/revoke and NAS logout pass; 7 temporary resources removed.
Customer User password change remains blocked by PROFILE WRITE. Owner TenantAdmin credential login and production HTTPS/hardware checks still require operator verification. No production-ready claim is made.
