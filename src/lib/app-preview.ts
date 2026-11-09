import { cloudFetch } from './cloud-vms';

const engines = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
let active = 0;
const queue: (() => void)[] = [];

async function limited<T>(capture: () => Promise<T>): Promise<T> {
  await new Promise<void>(resolve => {
    const start = () => { active++; resolve(); };
    if (active < 2) start(); else queue.push(start);
  });
  try { return await capture(); }
  finally { active--; queue.shift()?.(); }
}

/** Capture the authenticated worker/app target, never the shared VM viewer URL. */
export function captureCloudAppPreview(vmId: string, worker: string, app: string, startUrl?: string | null, signal?: AbortSignal): Promise<string> {
  if (!/^[\w-]{1,40}$/.test(app) || !/^[A-Za-z0-9_-]{1,80}$/.test(worker)) return Promise.reject(new Error('This app has no isolated preview target'));
  const key = JSON.stringify([vmId, worker, app]);
  const current = pending.get(key);
  if (current) return current;
  const result = limited(async () => {
    const check = () => { if (signal?.aborted) throw new Error('App preview cancelled'); };
    check();
    const engine = 'vm';
    const send = async (calls: { method: string; params?: Record<string, unknown> }[]) => {
      check();
      const response = await cloudFetch(`/api/cloud-vms/${encodeURIComponent(vmId)}/browser-control`, {
        method: 'POST', body: JSON.stringify({ engine, worker, app, calls, create: false }), signal,
      });
      check();
      if (!response.ok) throw new Error(response.data?.error || 'App preview is not ready');
      const error = response.data?.results?.find((item: { error?: string }) => item?.error)?.error;
      if (error) throw new Error(error);
      return response.data;
    };
    let provider = engines.get(key);
    if (!provider) {
      // A thumbnail may capture an existing app, but must not start another VM browser.
      const state = await send([{ method: 'Runtime.evaluate', params: { expression: '({width:innerWidth,height:innerHeight,dpr:devicePixelRatio||1})', returnByValue: true } }]);
      provider = state.engine || 'browserbase';
      engines.set(key, provider!);
    }
    const screenshot = await send([{ method: provider === 'vps' || provider === 'vm' ? 'ef.desktopScreenshot' : 'Page.captureScreenshot',
      params: provider === 'vps' || provider === 'vm' ? {} : { format: 'jpeg', quality: 45, captureBeyondViewport: false } }]);
    const data = screenshot.results?.[0]?.data;
    if (typeof data !== 'string' || !data.length) throw new Error('No app image was captured');
    return `data:image/${provider === 'vps' || provider === 'vm' ? 'png' : 'jpeg'};base64,${data}`;
  }).catch(error => { engines.delete(key); throw error; }).finally(() => { pending.delete(key); });
  pending.set(key, result);
  return result;
}

/** This program executes inside Alpine through the existing worker VM bridge. */
export const LOCAL_APP_PREVIEW_SCRIPT = String.raw`
(async()=>{
 const fs=require('fs'),spec=JSON.parse(Buffer.from(process.argv[1],'base64').toString('utf8'));
 const base='http://127.0.0.1:19222';
 if(typeof WebSocket==='undefined')throw Error('The Alpine Node runtime needs WebSocket support');
 async function connection(url){
  const ws=new WebSocket(url),pending=new Map();let id=0;
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=()=>reject(Error('Alpine browser is unavailable'));});
  ws.onmessage=e=>{const data=JSON.parse(e.data);const job=pending.get(data.id);if(job){pending.delete(data.id);clearTimeout(job.timer);data.error?job.reject(Error(data.error.message)):job.resolve(data.result)}};
  return {close:()=>ws.close(),call:(method,params={})=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(Error('Alpine screenshot timed out'))},15000);pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));})};
 }
 const request=async route=>{const res=await fetch(base+route);if(!res.ok)throw Error('Alpine browser is unavailable');return res.json()};
 let pages=(await request('/json/list')).filter(p=>p.type==='page'&&!p.url.startsWith('devtools:'));
 const file=require('path').join(require('os').tmpdir(),'everfern-preview-'+spec.worker+'.json');let saved={};try{saved=JSON.parse(fs.readFileSync(file,'utf8'))}catch{}
 const host=url=>{try{return new URL(url).hostname}catch{return ''}};
 let page=spec.app==='chrome'?pages[0]:pages.find(p=>p.id===saved[spec.app]);
 if(!page)page=pages.find(p=>host(p.url)===host(spec.url)&&!Object.values(saved).includes(p.id));
 if(!page){
  const browser=await connection((await request('/json/version')).webSocketDebuggerUrl);
  try{const target=await browser.call('Target.createTarget',{url:spec.url,background:true});pages=await request('/json/list');page=pages.find(p=>p.id===target.targetId)}finally{browser.close()}
 }
 if(!page)throw Error('The Alpine app has not opened yet');
 saved[spec.app]=page.id;fs.writeFileSync(file,JSON.stringify(saved));
 const cdp=await connection(page.webSocketDebuggerUrl);
 try{
  const layout=await cdp.call('Page.getLayoutMetrics');const viewport=layout.cssVisualViewport||layout.visualViewport;
  const params={format:'jpeg',quality:45,captureBeyondViewport:false};
  if(viewport?.clientWidth&&viewport?.clientHeight)params.clip={x:viewport.pageX||0,y:viewport.pageY||0,width:viewport.clientWidth,height:viewport.clientHeight,scale:Math.min(1,520/viewport.clientWidth)};
  const image=await cdp.call('Page.captureScreenshot',params);console.log(JSON.stringify({image:'data:image/jpeg;base64,'+image.data}));
 }finally{cdp.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});`;

export async function captureLocalAppPreview(worker: string, app: string, startUrl: string, signal?: AbortSignal): Promise<string> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(worker) || !/^https?:\/\//i.test(startUrl)) throw new Error('Invalid Alpine app target');
  const api = typeof window !== 'undefined' ? (window as any).electronAPI?.workers : null;
  if (!api?.vmExec) throw new Error('The Alpine VM bridge is unavailable');
  const encode = (value: string) => btoa(Array.from(new TextEncoder().encode(value), byte => String.fromCharCode(byte)).join(''));
  const spec = encode(JSON.stringify({ worker, app, url: startUrl }));
  const program = encode(LOCAL_APP_PREVIEW_SCRIPT);
  return limited(async () => {
    if (signal?.aborted) throw new Error('App preview cancelled');
    const result = await api.vmExec(worker, `node -e "eval(Buffer.from('${program}','base64').toString('utf8'))" '${spec}'`);
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Alpine capture is not ready');
    const image = JSON.parse(result.stdout.trim().split('\n').pop()).image;
    if (typeof image !== 'string' || !image.startsWith('data:image/jpeg;base64,')) throw new Error('No Alpine image was captured');
    return image;
  });
}
