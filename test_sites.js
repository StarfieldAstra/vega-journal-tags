'use strict';
const assert=require('assert/strict');
const fs=require('fs');
const path=require('path');
const {extractSiteKey,resolveSite}=require('./extension/sites/index.js');
const origin='https://webvpn.sxufe.edu.cn';
const target='https://kns.cnki.net/kns8s/defaultresult/index';
for(const href of [
  origin+'/_webvpn_*!f/'+target+'?kw=vega-fixture',
  origin+'/_webvpn_*!f/'+encodeURIComponent(target),
  origin+'/_webvpn_*!f/'+encodeURIComponent(encodeURIComponent(target)),
  origin+'/https/77726476706e69737468656265737421/kns.cnki.net/kns8s/defaultresult/index',
  origin+'/_webvpn_*!f/'+target+'/%ZZ',
  origin+'/_webvpn_*!f/https://kns.cnki.net:443/kns8s/defaultresult/index',
]){
  assert.equal(extractSiteKey(href),'kns.cnki.net');
  assert.equal(resolveSite(href).id,'cnki');
}
for(const href of [origin+'/',origin+'/login?next='+encodeURIComponent(target),origin+'/_webvpn_*!f/https://kns.cnki.net.evil.test/index','https://example.org/path/kns.cnki.net/index'])assert.equal(resolveSite(href),null);
assert.equal(resolveSite('https://kns.cnki.net/path/sciencedirect.com').id,'cnki');
assert.doesNotThrow(()=>extractSiteKey('%%%'));
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'extension/manifest.json'),'utf8'));
const match=origin+'/*';
assert.ok(manifest.host_permissions.includes(match));
assert.ok(manifest.content_scripts.some(entry=>entry.matches.includes(match)&&entry.all_frames&&entry.js.includes('content.js')));
assert.ok(manifest.web_accessible_resources.some(entry=>entry.matches.includes(match)&&entry.resources.includes('data/journals.json')));
assert.ok(!manifest.action.default_popup);
console.log('✓ WebVPN literal, encoded, malformed, port and legacy paths resolve CNKI; login and spoofed targets stay inactive.');
console.log('✓ WebVPN host permission, automatic frame injection and data resources are declared; no native popup.');
