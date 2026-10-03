'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const J = require('./extension/core/judge.js');
const T = require('./extension/core/themes.js');
const data = JSON.parse(fs.readFileSync(path.join(__dirname,'extension/data/journals.json'),'utf8'));
const records = {
  '双库刊':{n:'双库刊',c:'source',d:'core',b:1},
  '扩展刊':{n:'扩展刊',c:'ext',d:'ext'},
  '英文刊':{n:'英文刊',i:'0028-0836',z:'1',T:1,M:'综合性期刊'},
  '预警刊':{n:'预警刊',z:'3',w:'2024',y:'历史预警'},
  '无收录':{n:'无收录'},
};
const ctx={journals:records,idx:J.buildIndex(records)};
const keys=(name,dbs)=>J.judge(name,ctx,dbs).badges.map(b=>b.k);
assert.deepEqual(J.DB_IDS,['cssci','cscd','beike','cas','warning']);
assert.equal(J.BADGE_KEYS.length,12);
assert.deepEqual(keys('双库刊'),['both-core','beike']);
assert.deepEqual(keys('双库刊',['cssci']),['cssci-source']);
assert.deepEqual(keys('双库刊',['cscd']),['cscd-core']);
assert.deepEqual(keys('双库刊',['beike']),['beike']);
assert.deepEqual(keys('扩展刊'),['both-mixed']);
assert.deepEqual(keys('英文刊'),['cas-1']);
assert.equal(J.judge({name:'未知刊',issn:'0028 0836'},ctx).key,'英文刊');
assert.equal(J.judge('英文刊',ctx).badges[0].top,true);
assert.deepEqual(keys('预警刊'),['cas-3','warning']);
assert.equal(J.judge('预警刊',ctx).warning.reason,'历史预警');
assert.deepEqual(keys('无收录'),[]);
assert.equal(J.hasSignal(records['双库刊'],['cas']),false);
assert.equal(J.judge('不存在',ctx).record,null);
assert.equal(J.norm('ＡＢＣ （测试）'),'abc(测试)');
assert.deepEqual(J.normalizeDbs(['retired']),J.DB_IDS);
assert.deepEqual(J.normalizeDbs(['cssci','cssci','retired']),['cssci']);
assert.equal(T.THEMES.length,1);
assert.equal(T.CUSTOM_KEYS.length,8);
assert.deepEqual(Object.keys(T.ROLE).sort(),J.BADGE_KEYS.slice().sort());
assert.equal(Object.keys(T.PALETTE).length,18);
assert.equal(T.normalizeHex('#abc'),'#AABBCC');
assert.equal(T.normalizeHex('oops'),null);
assert.equal(T.buildCustom({cssci:'#228866'}).custom.cssci,'#228866');
const actualCounts={
  total:Object.keys(data.journals).length,
  cssciSource:0,cssciExt:0,cscdCore:0,cscdExt:0,beike:0,cas:0,casTop:0,warning:0,both:0,
};
const actualCtx={journals:data.journals,idx:J.buildIndex(data.journals)};
for(const [key,rec] of Object.entries(data.journals)){
  if(rec.c==='source')actualCounts.cssciSource++;
  if(rec.c==='ext')actualCounts.cssciExt++;
  if(rec.d==='core')actualCounts.cscdCore++;
  if(rec.d==='ext')actualCounts.cscdExt++;
  if(rec.b)actualCounts.beike++;
  if(rec.z)actualCounts.cas++;
  if(rec.T)actualCounts.casTop++;
  if(rec.w)actualCounts.warning++;
  if(rec.c==='source'&&rec.d==='core')actualCounts.both++;
  const result=J.judge(key,actualCtx);
  assert.equal(result.record,rec,'Every canonical key must resolve to its own record');
  assert.ok(result.badges.length>0);
  for(const badge of result.badges)assert.ok(J.BADGE_KEYS.includes(badge.k));
  assert.ok(Object.keys(rec).every(k=>['n','i','j','c','d','b','z','M','W','T','w','y'].includes(k)));
}
assert.deepEqual(actualCounts,data.meta.counts);
console.log('✓ 判定、双库过滤、ISSN、Top、预警、自定义色、元数据计数均通过');
console.log('✓ '+actualCounts.total+' 条数据逐刊匹配和标签检查通过');
