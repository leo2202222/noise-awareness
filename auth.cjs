'use strict';
const legacy=require('./auth-local.cjs');
function createAuth(filename,options){return process.env.AUTH_PROVIDER==='local'?{...legacy.createAuth(filename),provider:'local'}:require('./auth-thingsboard.cjs').createThingsBoardAuth(filename,options)}
module.exports={createAuth,readBody:legacy.readBody,error:legacy.error};
