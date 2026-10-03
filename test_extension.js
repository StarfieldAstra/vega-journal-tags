'use strict';
const {chromium}=require('playwright');
const fs=require('fs');
const path=require('path');
const os=require('os');
const assert=require('assert/strict');

async function nativePopup(context,worker,page){
  await page.bringToFront();
  await worker.evaluate(()=>chrome.action.openPopup());
  const cdp=await context.browser().newBrowserCDPSession();
  let target;
  for(let attempt=0;attempt<40;attempt++){
    const targets=await cdp.send('Target.getTargets');
    target=targets.targetInfos.find(t=>t.url.endsWith('/popup/popup.html'));
    if(target)break;
    await page.waitForTimeout(50);
  }
  assert.ok(target,'Native toolbar popup must stay open on unsupported pages');
  const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});
  let nextId=0;
  async function send(method,params){
    const id=++nextId;
    const answer=new Promise((resolve,reject)=>{
      const listener=event=>{
        if(event.sessionId!==sessionId)return;
        const message=JSON.parse(event.message);
        if(message.id!==id)return;
        clearTimeout(timer);cdp.off('Target.receivedMessageFromTarget',listener);
        message.error?reject(new Error(JSON.stringify(message.error))):resolve(message.result);
      };
      const timer=setTimeout(()=>{cdp.off('Target.receivedMessageFromTarget',listener);reject(new Error('Native popup CDP timeout'));},5000);
      cdp.on('Target.receivedMessageFromTarget',listener);
    });
    await cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})});
    return answer;
  }
  async function evaluate(fn){
    const result=await send('Runtime.evaluate',{expression:'('+fn.toString()+')()',returnByValue:true,awaitPromise:true});
    assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  await evaluate(async()=>{
    for(let attempt=0;attempt<80&&!document.body.classList.contains('ui-ready');attempt++)await new Promise(resolve=>setTimeout(resolve,50));
    if(!document.body.classList.contains('ui-ready'))throw new Error('Native popup did not initialize');
  });
  return {evaluate,async screenshot(file){const result=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(file,Buffer.from(result.data,'base64'));},async close(){await cdp.send('Target.closeTarget',{targetId:target.targetId});await cdp.detach();}};
}

async function verifyNativePopup(context,worker,page,shots,name){
  const popup=await nativePopup(context,worker,page);
  const bounds=await popup.evaluate(()=>({
    viewport:innerWidth,body:document.body.getBoundingClientRect().width,
    shell:document.querySelector('.shell').getBoundingClientRect().width,
    scroll:document.querySelector('.shell').scrollWidth,
    mottoRight:document.querySelector('.brand-motto').getBoundingClientRect().right,
    embedded:document.documentElement.dataset.embedded,
  }));
  for(const dimension of ['viewport','body','shell'])assert.ok(Math.abs(bounds[dimension]-336)<=1,dimension+': '+JSON.stringify(bounds));
  assert.equal(bounds.embedded,'false');
  assert.ok(bounds.scroll<=336&&bounds.mottoRight<=336,'Native popup must not overflow horizontally');
  await popup.screenshot(path.join(shots,name+'.png'));
  await popup.evaluate(()=>document.querySelector('#enabled').click());
  assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('enabled')).enabled),false);
  await popup.evaluate(()=>document.querySelector('#enabled').click());
  assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('enabled')).enabled),true);
  await popup.evaluate(()=>document.querySelector('#thToggle').click());
  assert.equal(await popup.evaluate(()=>document.querySelectorAll('#customColors input[type="color"]').length),8);
  assert.equal(await popup.evaluate(()=>innerWidth),336);
  await popup.close();
}

async function main(){
  const ext=path.resolve(process.env.VEGA_TEST_EXTENSION||path.join(__dirname,'extension'));
  const manifest=JSON.parse(fs.readFileSync(path.join(ext,'manifest.json'),'utf8'));
  const restrictive=process.env.VEGA_TEST_RESTRICTIVE_CSP==='1';
  const shots=path.resolve(__dirname,'..','预览图');
  fs.mkdirSync(shots,{recursive:true});
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'vega-public-'));
  let context;
  try{
    context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,args:['--disable-extensions-except='+ext,'--load-extension='+ext]});
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
    const id=new URL(worker.url()).hostname;
    const unsupported=await context.newPage();
    await unsupported.goto('about:blank');
    await verifyNativePopup(context,worker,unsupported,shots,'公开版_原生弹窗');
    console.log('✓ 未适配页面的真实工具栏弹窗宽度 336px，标语完整、开关与自定义色可用');
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://kns.cnki.net/vega-test',route=>route.fulfill({contentType:'text/html; charset=utf-8',headers:restrictive?{'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'"}:{},body:`<!doctype html><meta charset="utf-8"><style>body{margin:80px;font:14px sans-serif;background:#eef4f7}td{padding:24px}button{pointer-events:none!important}</style><script>document.addEventListener('click',e=>{if(e.target.closest('button'))e.stopImmediatePropagation()},true)</script><table class="result-table-list"><tbody><tr><td class="source"><a href="#unexpected">经济研究</a></td></tr><tr><td class="source"><a href="#unexpected">Nature</a></td></tr><tr><td class="source"><a href="#unexpected">无法匹配的期刊</a></td></tr></tbody></table>`}));
    await page.goto('https://kns.cnki.net/vega-test');
    await page.locator('.vega-cssci-source').waitFor();
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
    await worker.evaluate(async()=>await chrome.action.openPopup());
    await page.locator('[data-vega-settings-host]').waitFor({state:'visible'});
    const frame=page.frames().find(f=>f.url().includes('embedded=1'));
    assert.ok(frame);
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
    await verifyNativePopup(context,worker,guide,shots,'公开版_说明页工具栏弹窗');
    // Embedded frames must still fit a narrow page instead of forcing native width.
    await page.setViewportSize({width:300,height:720});
    await page.bringToFront();
    await page.waitForTimeout(250);
    await worker.evaluate(()=>chrome.action.openPopup());
    await page.locator('[data-vega-settings-host]').waitFor({state:'visible'});
    const narrow=page.frames().find(f=>f.url().includes('embedded=1'));
    await narrow.locator('body.ui-ready').waitFor();
    const narrowWidth=await narrow.evaluate(()=>({viewport:innerWidth,body:document.body.getBoundingClientRect().width}));
    assert.equal(narrowWidth.viewport,268);
    assert.equal(narrowWidth.body,268);
    await narrow.locator('body').press('Escape');
    await page.locator('[data-vega-settings-host]').waitFor({state:'detached'});
    console.log('✓ 扩展说明页回退弹窗和窄屏网页内嵌面板尺寸正确');
    assert.equal(errors.length,0,errors.join(';'));
    console.log('✓ 刷新保留设置、说明页十二种标签和公开数据计数，无 JS 异常'+(restrictive?'（严格 CSP）':''));
  }finally{
    if(context)await context.close();
    if(path.dirname(profile)===os.tmpdir()&&path.basename(profile).startsWith('vega-public-'))fs.rmSync(profile,{recursive:true,force:true});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
