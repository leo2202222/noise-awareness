'use strict';
// Deployment entry point. Application code is grouped in backend/.
const application=require('./backend/server.cjs');
module.exports=application;
if(require.main===module)application.start();
