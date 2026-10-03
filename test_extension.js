'use strict';
const {chromium}=require('playwright');
const fs=require('fs');
const path=require('path');
const os=require('os');
const assert=require('assert/strict');

async function invokeToolbar(context,worker,page){
  await page.bringToFront();
  const result=await worker.evaluate(async()=>{
    const tabs=await chrome.tabs.query({active:true,currentWindow:true});
    let timer;
    try{return await Promise.race([openSettingsForTab(tabs[0]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Toolbar handler did not finish')),10000);})]);}
    finally{clearTimeout(timer);}
  });
  const cdp=await context.browser().newBrowserCDPSession();
  const targets=await cdp.send('Target.getTargets');
  assert.equal(targets.targetInfos.filter(t=>t.url.endsWith('/popup/popup.html')).length,0,'No native popup may be created');
  await cdp.detach();
  return result;
}

async function settingsPage(context,source){
  for(let attempt=0;attempt<60;attempt++){
    const page=context.pages().find(p=>p.url().includes('/popup/popup.html?standalone=1'));
    if(page){await page.locator('body.ui-ready').waitFor();return page;}
    await source.waitForTimeout(50);
  }
  throw new Error('Standalone settings page did not open');
}

async function verifyRoundPanel(page){
  await page.locator('[data-vega-settings-host]').waitFor({state:'visible'});
  const frame=page.frames().find(f=>f.url().includes('embedded=1'));
  assert.ok(frame);
  await frame.locator('body.ui-ready').waitFor();
  const style=await page.locator('[data-vega-settings-host]').evaluate(host=>({radius:getComputedStyle(host).borderRadius,overflow:getComputedStyle(host).overflow,background:getComputedStyle(host).backgroundColor}));
  assert.deepEqual(style,{radius:'24px',overflow:'hidden',background:'rgba(0, 0, 0, 0)'});
  assert.equal(await frame.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor),'rgba(0, 0, 0, 0)');
  assert.equal(await frame.evaluate(()=>getComputedStyle(document.body).margin),'0px');
  return frame;
}

async function main(){
  const ext=path.resolve(process.env.VEGA_TEST_EXTENSION||path.join(__dirname,'extension'));
  const manifest=JSON.parse(fs.readFileSync(path.join(ext,'manifest.json'),'utf8'));
  assert.ok(!manifest.action.default_popup,'Toolbar must not open a native white window');
  assert.deepEqual(manifest.permissions,['storage','activeTab','scripting']);
  const restrictive=process.env.VEGA_TEST_RESTRICTIVE_CSP==='1';
  const shots=path.resolve(__dirname,'..','预览图');
  fs.mkdirSync(shots,{recursive:true});
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'vega-public-'));
  let launchExt=ext;
  const dynamic=process.env.VEGA_TEST_DYNAMIC_PANEL==='1';
  if(dynamic){
    // Simulate a tab whose old content scripts have no settings receiver yet.
    launchExt=path.join(profile,'extension-fixture');
    fs.cpSync(ext,launchExt,{recursive:true});
    const fixture=JSON.parse(JSON.stringify(manifest));
    fixture.content_scripts[0].js=fixture.content_scripts[0].js.filter(file=>file!=='settings-panel.js');
    fs.writeFileSync(path.join(launchExt,'manifest.json'),JSON.stringify(fixture));
  }
  let context;
  try{
    context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,args:['--disable-extensions-except='+launchExt,'--load-extension='+launchExt]});
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
    const id=new URL(worker.url()).hostname;
    const unsupported=await context.newPage();
    await unsupported.goto('about:blank');
    const restricted=await invokeToolbar(context,worker,unsupported);
    assert.equal(restricted.mode,'settings');
    const settings=await settingsPage(context,unsupported);
    assert.equal(await settings.locator('body').evaluate(el=>el.getBoundingClientRect().width),336);
    await settings.locator('#enabled').uncheck();
    await settings.locator('#enabled').check();
    await settings.locator('#thToggle').click();
    assert.equal(await settings.locator('#customColors input[type="color"]').count(),8);
    await settings.locator('#thToggle').click();
    await settings.screenshot({path:path.join(shots,'公开版_独立设置页.png')});
    await settings.close();
    console.log('✓ 受限页面打开独立设置页，设置可用且不创建原生白框弹窗');
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://kns.cnki.net/vega-test',route=>route.fulfill({contentType:'text/html; charset=utf-8',headers:restrictive?{'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'"}:{},body:`<!doctype html><meta charset="utf-8"><style>body{margin:80px;font:14px sans-serif;background:#eef4f7}td{padding:24px}button{pointer-events:none!important}</style><script>document.addEventListener('click',e=>{if(e.target.closest('button'))e.stopImmediatePropagation()},true)</script><table class="result-table-list"><tbody><tr><td class="source"><a href="#unexpected">经济研究</a></td></tr><tr><td class="source"><a href="#unexpected">Nature</a></td></tr><tr><td class="source"><a href="#unexpected">无法匹配的期刊</a></td></tr></tbody></table>`}));
    await page.goto('https://kns.cnki.net/vega-test');
    await page.locator('.vega-cssci-source').waitFor();
    if(dynamic)await worker.evaluate(async()=>{
      const tabs=await chrome.tabs.query({active:true,currentWindow:true});
      await chrome.scripting.executeScript({target:{tabId:tabs[0].id},func:()=>{
        chrome.runtime.onMessage.addListener(message=>['settingsPanelPing','openSettingsPanel'].includes(message&&message.type));
      }});
    });
    assert.equal(await page.locator('[data-vega-line]').count(),2);
    assert.equal(await page.locator('.vega-tag').count(),3);
    await page.locator('.vega-cssci-source').click();
    await page.locator('.vega-pop').waitFor({state:'visible'});
    assert.ok((await page.locator('.vega-pop').innerText()).includes('CSSCI'));
    assert.equal(await page.locator('.vega-pop button').count(),0);
    assert.equal(new URL(page.url()).hash,'');
    await page.locator('body').press('Escape');
    await page.locator('.vega-cas-1').click();
    await page.locator('.vega-pop').waitFor({state:'visible'});
    assert.ok((await page.locator('.vega-pop').innerText()).includes('Top'));
    assert.ok((await page.locator('.vega-pop').innerText()).includes('Vega v'+manifest.version));
    await page.locator('body').press('Escape');
    console.log('✓ 知网实际适配器仅显示公开收录标签，详情可读且无修改按钮');
    await page.bringToFront();
    assert.equal((await invokeToolbar(context,worker,page)).mode,'panel');
    await page.locator('[data-vega-settings-host]').waitFor({state:'visible'});
    const frame=await verifyRoundPanel(page);
    await frame.locator('body.ui-ready').waitFor();
    assert.equal(await frame.locator('.brand-motto').innerText(),'Verify, Evaluate, Grade, Assign');
    await page.waitForTimeout(200);
    await page.screenshot({path:path.join(shots,'公开版_完整圆角.png')});
    await frame.locator('#dbToggle').click();
    assert.equal(await frame.locator('#dbList input').count(),5);
    await frame.locator('.db-item').filter({has:frame.locator('input[data-db="beike"]')}).click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.vega-beike').count(),0);
    await frame.locator('.db-item').filter({has:frame.locator('input[data-db="beike"]')}).click();
    await page.locator('.vega-beike').waitFor();
    await frame.locator('#dbToggle').click();
    await frame.locator('#thToggle').click();
    assert.equal(await frame.locator('#customColors input[type="color"]').count(),8);
    const hex=frame.locator('.cc-hex[data-role="cssci"]');
    await hex.click();await hex.press('ControlOrMeta+A');await hex.pressSequentially('#228866');
    await page.waitForTimeout(200);
    assert.equal(await page.locator('html').getAttribute('data-vega-theme'),'custom');
    await frame.locator('#customReset').click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('html').getAttribute('data-vega-theme'),'vega');
    await frame.locator('#thToggle').click();
    await frame.locator('[data-ui="dark"]').click();
    assert.equal(await frame.locator('html').getAttribute('class'),'ui-dark');
    await page.screenshot({path:path.join(shots,'公开版_深色.png')});
    await frame.locator('[data-ui="light"]').click();
    await frame.locator('#enabled').uncheck();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('[data-vega-line]').count(),0);
    await frame.locator('#enabled').check();
    await page.locator('.vega-cssci-source').waitFor();
    await frame.locator('#rescan').click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('[data-vega-line]').count(),2);
    await frame.locator('body').press('Escape');
    await page.locator('[data-vega-settings-host]').waitFor({state:'detached'});
    console.log('✓ 工具栏圆角浮层、五项显示开关、八项自定义色、主题、启用开关、重新扫描');
    await page.reload();
    await page.locator('.vega-cssci-source').waitFor();
    assert.equal(await page.locator('[data-vega-line]').count(),2);
    const guide=await context.newPage();
    guide.on('pageerror',e=>errors.push(e.message));
    await guide.goto('chrome-extension://'+id+'/popup/guide.html');
    await guide.locator('#dsCard').waitFor({state:'visible'});
    assert.equal(await guide.locator('#allBadges .bd').count(),12);
    assert.equal(await guide.locator('#dsBody tr').count(),9);
    await guide.locator('#allBadges').screenshot({path:path.join(shots,'公开版_标签总览.png')});
    assert.equal((await invokeToolbar(context,worker,guide)).mode,'panel');
    const guideFrame=await verifyRoundPanel(guide);
    await guide.screenshot({path:path.join(shots,'公开版_说明页完整圆角.png')});
    await guideFrame.locator('body').press('Escape');
    await guide.locator('[data-vega-settings-host]').waitFor({state:'detached'});
    const blocked=await context.newPage();
    await blocked.route('https://www.cnki.net/vega-block-frame',route=>route.fulfill({
      contentType:'text/html',headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-src 'none'"},body:`<!doctype html><title>Vega blocked frame fixture</title><p>This page removes injected frames before they can initialize.</p><script>new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1&&node.hasAttribute('data-vega-settings-host'))node.remove()}).observe(document.documentElement,{childList:true});</script>`
    }));
    await blocked.goto('https://www.cnki.net/vega-block-frame');
    assert.equal((await invokeToolbar(context,worker,blocked)).mode,'settings');
    assert.equal(await blocked.locator('[data-vega-settings-host]').count(),0);
    const fallback=await settingsPage(context,blocked);
    await fallback.locator('#enabled').uncheck();
    await fallback.locator('#enabled').check();
    await fallback.close();
    await blocked.close();
    console.log('✓ 浮层未能初始化时移除空容器并打开独立设置页，无原生白框');
    // Embedded frames must still fit a narrow page instead of forcing native width.
    await page.setViewportSize({width:300,height:720});
    await page.bringToFront();
    await page.waitForTimeout(250);
    assert.equal((await invokeToolbar(context,worker,page)).mode,'panel');
    await page.locator('[data-vega-settings-host]').waitFor({state:'visible'});
    const narrow=page.frames().find(f=>f.url().includes('embedded=1'));
    await narrow.locator('body.ui-ready').waitFor();
    const narrowWidth=await narrow.evaluate(()=>({viewport:innerWidth,body:document.body.getBoundingClientRect().width}));
    assert.equal(narrowWidth.viewport,268);
    assert.equal(narrowWidth.body,268);
    await narrow.locator('body').press('Escape');
    await page.locator('[data-vega-settings-host]').waitFor({state:'detached'});
    console.log('✓ 扩展说明页完整圆角、窄屏内嵌尺寸正确，全程无原生弹窗');
    assert.equal(errors.length,0,errors.join(';'));
    console.log('✓ 刷新保留设置、说明页十二种标签和公开数据计数，无 JS 异常'+(restrictive?'（严格 CSP）':'')+(dynamic?'（未注入设置脚本的旧页面）':''));
  }finally{
    if(context)await context.close();
    if(path.dirname(path.resolve(profile))===path.resolve(os.tmpdir())&&path.basename(profile).startsWith('vega-public-'))fs.rmSync(profile,{recursive:true,force:true});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
