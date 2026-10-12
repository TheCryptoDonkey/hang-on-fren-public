import {chromium} from 'playwright';
import jsQR from 'jsqr';
import {PNG} from 'pngjs';
import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
const origin='https://hang-on-fren.playechoseven.com';
const csp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https: wss:; worker-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'";
const root=resolve('dist');const files=new Map();
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav'};
const server=createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  if(!files.has(file))files.set(file,await readFile(file));
  res.writeHead(200,{'content-type':mime[extname(file)]??'application/octet-stream'});res.end(files.get(file));
 }catch{res.writeHead(404).end();}
});
const version=JSON.parse(await readFile(resolve(root,'version.json'),'utf8'));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const fixtureOrigin='http://127.0.0.1:'+server.address().port;
let b;const results=[];
try{
b=await chromium.launch(process.env.HOF_QR_CHROMIUM?{executablePath:process.env.HOF_QR_CHROMIUM}:{});
for(const {width,enhancementUnavailable} of [...[320,390,1180].map(width=>({width,enhancementUnavailable:false})),{width:390,enhancementUnavailable:true}]){
 let blockedEncoderRequests=0;
 const c=await b.newContext({viewport:{width,height:820}});c.setDefaultTimeout(15000);c.setDefaultNavigationTimeout(30000);
 await c.addInitScript(()=>{const send=WebSocket.prototype.send;WebSocket.prototype.send=function(raw){try{if(JSON.parse(raw)[0]==='EVENT')throw new Error('Fixture blocks public event writes')}catch(e){if(e.message==='Fixture blocks public event writes')return;}return send.call(this,raw)}});
 await c.addInitScript(()=>{window.__fixturePaintedText=[];const draw=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...rest){const value=String(text);if(!window.__fixturePaintedText.includes(value))window.__fixturePaintedText.push(value);return draw.call(this,text,...rest);};});
 await c.route('**/*',async r=>{
  const q=r.request();if(q.method()!=='GET')return r.abort();const u=new URL(q.url());if(enhancementUnavailable&&/\/assets\/qrcode-[^/]+\.js$/.test(u.pathname)){blockedEncoderRequests++;return r.abort();}
  if(u.origin===origin&&!u.pathname.startsWith('/api/')){const response=await r.fetch({url:fixtureOrigin+u.pathname+u.search,timeout:5000});return r.fulfill({response,headers:{...response.headers(),'content-security-policy':csp}});}return r.abort();
 });
 await c.routeWebSocket('**/*',socket=>socket.onMessage(()=>{}));
 const p=await c.newPage();await p.goto(origin,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__fixturePaintedText.some(text=>text.includes('TAP TO RIDE')));
 for(const method of enhancementUnavailable?['remote-signet']:['remote-signet','nostrconnect']){
  await p.keyboard.press('n');if(method==='nostrconnect')await p.locator('[data-action="advanced"]').click();await p.locator(`button[data-choice="${method}"]`).click();
  const id=method==='remote-signet'?'signet-login-qr':'signet-login-nc-qr';const source=method==='remote-signet'?'signet-login-open-signet':'signet-login-nc-uri';
  await p.locator('#'+id).waitFor({state:'visible'});
  if(!enhancementUnavailable)await p.waitForFunction(id=>document.getElementById(id)?.getAttribute('aria-label'),id);
  const payload=await p.locator('#'+source).evaluate(e=>e instanceof HTMLAnchorElement?e.getAttribute('href'):e.value);
  if(enhancementUnavailable){
    assert(blockedEncoderRequests>0,'The fallback control must actually block the optional encoder request');
    const link=new URL(payload);assert.equal(link.origin,'https://mysignet.app');assert.equal(link.searchParams.get('origin'),origin);assert(await p.locator('#'+source).isVisible());
    results.push({viewport:width,method,optionalEncoderUnavailable:true,blockedEncoderRequests,publishedApprovalLinkAvailable:true,qrScanQualified:false,actualSdkDialog:true,physicalCamera:false});
    await p.locator('#signet-login-dialog [data-action="cancel"]').click();await p.locator('#'+id).waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>localStorage.getItem('signet:login.pubkey')),null);continue;
  }
  const canvas=p.locator('#'+id);const raster=await canvas.evaluate(c=>({width:c.width,height:c.height,data:Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data),bounds:{width:c.getBoundingClientRect().width,x:c.getBoundingClientRect().x}}));
  const decoded=jsQR(new Uint8ClampedArray(raster.data),raster.width,raster.height);assert.equal(decoded?.data,payload,'Backing QR must decode to the exact SDK payload');
  const png=PNG.sync.read(await canvas.screenshot());const painted=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);assert.equal(painted?.data,payload,'Displayed QR must decode to the exact SDK payload');
  assert(raster.bounds.x>=0&&raster.bounds.x+raster.bounds.width<=width+1,'Whole QR fits viewport');
  if(method==='remote-signet'){const link=new URL(payload);assert.equal(link.origin,'https://mysignet.app');assert.equal(link.searchParams.get('origin'),origin);}
  const result={viewport:width,method,rawExactPayload:true,paintedExactPayload:true,backingPixels:raster.width,paintedPixels:png.width,wholeQrFits:true,publicWritesBlocked:true,actualSdkDialog:true,physicalCamera:false};results.push(result);console.log(JSON.stringify(result));
  await p.locator('#signet-login-dialog [data-action="cancel"]').click();await p.locator('#'+id).waitFor({state:'hidden'});
  assert.equal(await p.evaluate(()=>localStorage.getItem('signet:login.pubkey')),null);
 }
 await c.close();
}
await writeFile('qr-browser-proof.json',JSON.stringify({complete:true,sourceRevision:version.revision??null,build:version.build,productionDeployment:false,actualPublisherOriginWithLocalBuiltAssets:true,externalNetwork:false,physicalAcceptance:false,results},null,2)+'\n');
}finally{await b?.close();const closed=new Promise(resolve=>server.close(resolve));server.closeAllConnections();await closed;}
