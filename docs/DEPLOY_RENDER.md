# Deploy on Render

Upload the contents of noise-awareness (not the ZIP) to a private GitHub repository. Include .gitignore. Exclude .env, data, node_modules and test results. If the repository root contains package.json, leave Render Root Directory blank; otherwise use noise-awareness.

Create a Node Web Service connected to that repository. Use npm ci --omit=dev for Build Command and node server.cjs for Start Command. The local npm start command requires .env and should not be used on Render.

Set NODE_VERSION=24, HOST=0.0.0.0, NODE_ENV=production, COOKIE_SECURE=true, TRUST_PROXY=true, AUTH_PROVIDER=thingsboard. Copy THINGSBOARD_URL, THINGSBOARD_API_KEY, THINGSBOARD_TENANT_ID, THINGSBOARD_REGISTRATION_CUSTOMER_ID, THINGSBOARD_DEVICE_ID and group-sharing/registration settings from your private local .env into Render Environment. Never commit these secrets. Let Render supply PORT.

Choose paid compute for always-on service and attach a persistent disk mounted at /var/data. Set AUTH_DB_PATH=/var/data/auth.sqlite. The encryption key is generated alongside the DB if SESSION_ENCRYPTION_KEY is omitted; preserve both. For a new installation the ThingsBoard accounts remain available, but local device labels/connections, push subscriptions and audit history start empty. To preserve them, stop the local server and privately transfer a consistent backup of auth.sqlite plus tb-session.key to the mounted disk using a secure administrator workflow; never GitHub. Do not overwrite an active production DB.

Set VAPID_SUBJECT to the real public HTTPS URL after Render supplies it. Deploy and open the onrender.com URL. Test Login, connect/read devices, edit/disconnect, real Settings save/readback and logout. Verify DB/key survive a redeploy. Public HTTPS deployment and OS push delivery have not yet been verified by this coding session.

The full shared-workspace/no-role policy is still pending explicit approval; see SHARED_WORKSPACE_REVIEW.md. Deploying does not enable that policy or fix existing Cloud permissions by itself.
