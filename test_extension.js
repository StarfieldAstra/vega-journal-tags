/** Real MV3 injection against intercepted CNKI and school WebVPN fixtures. */
'use strict';
const {chromium}=require('playwright');
const path=require('path');
const fs=require('fs');
const os=require('os');
const assert=require('assert/strict');

async function main(){
  const ext=path.resolve(process.env.VEGA_TEST_EXTENSION||path.join(__dirname,'extension'));
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'vega-vpn-'));
  const origin='https://webvpn.sxufe.edu.cn';
  const vpn=origin+'/_webvpn_*!f/https://kns.cnki.net/kns8s/defaultresult/index?kw=vega-fixture';
  const nested=origin+'/_webvpn_*!f/https://kns.cnki.net/kns8s/result?vega-child=1';
  const restrictive=process.env.VEGA_TEST_RESTRICTIVE_CSP==='1';
  const body='<!doctype html><meta charset="utf-8"><style>body{margin:50px;font:14px sans-serif;background:#eef4f7}td{padding:20px}button{pointer-events:none!important}</style><script>document.addEventListener("click",e=>{if(e.target.closest("button"))e.stopImmediatePropagation()},true)</script><table class="result-table-list"><tbody><tr><td class="source"><a href="#unexpected">经济研究</a></td></tr><tr><td class="source"><a href="#unexpected">经济研究</a></td></tr></tbody></table>';
  let context;
  try{
    context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,args:['--disable-extensions-except='+ext,'--load-extension='+ext]});
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
    const errors=[];
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    const headers=restrictive?{'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'"}:{};
    await context.route(vpn,route=>route.fulfill({contentType:'text/html; charset=utf-8',headers,body}));
    await context.route(nested,route=>route.fulfill({contentType:'text/html; charset=utf-8',headers,body}));
    await context.route('https://kns.cnki.net/vega-test',route=>route.fulfill({contentType:'text/html; charset=utf-8',headers,body}));
    await page.goto(vpn);
    // No toolbar click or activeTab grant: automatic host injection must work.
    await page.locator('.vega-sxufe-a1').first().waitFor();
    assert.equal(await page.locator('.vega-sxufe-a1').count(),2);
    console.log('✓ 学校 WebVPN 路径自动注入、离线数据加载、学校标签显示');
    await page.locator('.vega-sxufe-a1').first().click();
    await page.locator('.vega-lv-btn[title="降一级"]').click();
    await page.locator('.vega-sxufe-a2').first().waitFor();
    assert.equal(await page.locator('.vega-sxufe-a2').count(),2);
    assert.equal(new URL(page.url()).hash,'');
    for(const level of ['A3','A4','B1','A1','A2']){
      await page.locator('.vega-lv-opt[data-lv="sxufe|'+level+'"]').click();
      await page.locator('.vega-sxufe-'+level.toLowerCase()).first().waitFor();
      assert.equal(await page.locator('.vega-sxufe-'+level.toLowerCase()).count(),2);
      assert.equal(await page.locator('.vega-pop').count(),1);
    }
    await page.locator('.vega-lv-btn[title="升一级"]').click();
    await page.locator('.vega-sxufe-a1').first().waitFor();
    await page.locator('.vega-lv-btn[title="降一级"]').click();
    await page.locator('.vega-grade-status').filter({hasText:'已保存'}).waitFor();
    const stored=await worker.evaluate(async()=>await chrome.storage.local.get('ruleOv'));
    assert.ok(Object.values(stored.ruleOv).some(v=>v.sxufe==='A2'));
    await page.reload();
    await page.locator('.vega-sxufe-a2').first().waitFor();
    console.log('✓ 五个档位、升降级、同刊多行联动及刷新持久化（含页面事件/样式干扰）');
    const direct=await context.newPage();
    await direct.goto('https://kns.cnki.net/vega-test');
    await direct.locator('.vega-sxufe-a2').first().waitFor();
    console.log('✓ 代理与直连知网共享本地手动级别');
    const parent=await context.newPage();
    const parentUrl=origin+'/_webvpn_*!f/https://kns.cnki.net/vega-parent';
    await context.route(parentUrl,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Vega nested results</title><iframe style="width:90vw;height:500px" src="'+nested+'"></iframe>'}));
    await parent.goto(parentUrl);
    const child=parent.frames().find(frame=>frame.url()===nested)||await parent.waitForEvent('framenavigated',{predicate:frame=>frame.url()===nested});
    await child.locator('.vega-sxufe-a2').first().waitFor();
    await child.locator('.vega-sxufe-a2').first().click();
    await child.locator('.vega-lv-opt[data-lv="sxufe|B1"]').click();
    await direct.locator('.vega-sxufe-b1').first().waitFor();
    await page.locator('.vega-sxufe-b1').first().waitFor();
    await parent.bringToFront();
    const opened=await worker.evaluate(async()=>{
      const tabs=await chrome.tabs.query({active:true,currentWindow:true});
      return await openSettingsForTab(tabs[0]);
    });
    assert.equal(opened.mode,'panel');
    await parent.locator('[data-vega-settings-host]').waitFor({state:'visible'});
    assert.equal(await child.locator('[data-vega-settings-host]').count(),0);
    const settings=parent.frames().find(frame=>frame.url().includes('embedded=1'));
    await settings.locator('body.ui-ready').waitFor();
    const shots=path.resolve(__dirname,'..','预览图');fs.mkdirSync(shots,{recursive:true});
    await parent.screenshot({path:path.join(shots,'统一版_WebVPN嵌套结果.png')});
    console.log('✓ WebVPN 嵌套结果自动标注、跨页级别同步、设置只在顶层打开');
    const login=await context.newPage();
    await context.route(origin+'/',route=>route.fulfill({contentType:'text/html; charset=utf-8',body}));
    await login.goto(origin+'/');
    await login.waitForTimeout(400);
    assert.equal(await login.locator('.vega-tag').count(),0);
    assert.equal(errors.length,0,errors.join(';'));
    console.log('✓ WebVPN 登录页不误标注'+(restrictive?'；严格 CSP 回归通过':''));
  }finally{
    if(context)await context.close();
    if(path.dirname(path.resolve(profile))===path.resolve(os.tmpdir())&&path.basename(profile).startsWith('vega-vpn-'))fs.rmSync(profile,{recursive:true,force:true});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
