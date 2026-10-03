'use strict';
const assert=require('assert/strict');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

async function main(){
  let installed;
  let value;
  let writes=0;
  const chrome={
    runtime:{onInstalled:{addListener(fn){installed=fn;}},onMessage:{addListener(){}},getURL:path=>'chrome-extension://fixture/'+path},
    action:{onClicked:{addListener(){}}},
    storage:{local:{async get(){return value?{dbs:value}:{};},async set(data){value=data.dbs;writes++;}}},
    tabs:{create(){throw new Error('Update must not open tabs');}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'extension/background.js'),'utf8'),{chrome,console,setTimeout,clearTimeout});
  value=['cssci','cas'];
  await installed({reason:'update',previousVersion:'1.0.2'});
  assert.deepEqual(Array.from(value),['cssci','cas','sxufe']);
  await installed({reason:'update',previousVersion:'1.0.2'});
  assert.equal(writes,1);
  value=['cssci'];
  await installed({reason:'update',previousVersion:'1.3.0'});
  assert.deepEqual(Array.from(value),['cssci']);
  value=undefined;
  await installed({reason:'update',previousVersion:'1.0.2'});
  assert.equal(value,undefined);
  console.log('✓ 旧对外版只补充学校开关一次；已关闭开关和无已存设置保持原逻辑');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
