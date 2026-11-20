'use strict';
// Local machine owner recovery tool. Run privately; never paste its output in chat.
const {createAuth}=require('../auth-local.cjs');
const email=String(process.argv[2]||'').trim().toLowerCase();
if(!email){console.error('Usage: node scripts/recover-account.cjs your-email@example.com');process.exitCode=1;}else{
 const auth=createAuth(process.env.AUTH_DB_PATH);try{const user=auth.db.prepare('SELECT * FROM users WHERE email=?').get(email);if(!user)throw Error('Account not found');if(user.auth_provider==='thingsboard')throw Error('This account is managed by ThingsBoard. A local recovery code cannot change its cloud password.');auth.revoke(user.id);console.log('One-time recovery code (keep private):\n'+auth.recovery(user.id));}catch(error){console.error(error.message);process.exitCode=1}finally{auth.db.close()}
}
