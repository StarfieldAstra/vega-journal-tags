// Compatibility entry point; one workflow for local and published editions.
'use strict';
const {spawnSync}=require('child_process');
const path=require('path');
const result=spawnSync('python',[path.join(__dirname,'build_release.py'),...process.argv.slice(2)],{stdio:'inherit'});
if(result.error)console.error(result.error.message);
process.exitCode=result.status == null ? 1 : result.status;
