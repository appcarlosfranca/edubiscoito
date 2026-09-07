const CACHE='edu-biscoito-v3.4-shell';
const APP_SHELL=[
  './','./index.html','./manifest.json',
  './favicon.ico','./favicon-32.png','./favicon-96.png',
  './eb-apple-touch-v34.png','./eb-icon-192-v34.png','./eb-icon-512-v34.png',
  './eb-icon-maskable-192-v34.png','./eb-icon-maskable-512-v34.png'
];
const DB_NAME='edu-biscoito-sync-db';
const DB_VERSION=2;

async function cacheShell(){
  const cache=await caches.open(CACHE);
  // index é obrigatório; os demais não podem derrubar a instalação se algum host atrasar/404.
  let indexResponse=await fetch('./index.html',{cache:'reload'}).catch(()=>null);
  if(!indexResponse?.ok) indexResponse=await caches.match('./index.html',{ignoreSearch:true});
  if(!indexResponse) throw new Error('index.html indisponível para cache offline');
  await cache.put('./index.html',indexResponse.clone());
  await Promise.allSettled(APP_SHELL.filter(x=>x!=='./index.html').map(async asset=>{
    const response=await fetch(asset,{cache:'reload'});
    if(response?.ok) await cache.put(asset,response.clone());
  }));
  return cache;
}

self.addEventListener('install',event=>{
  event.waitUntil(cacheShell().then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE&&k.startsWith('edu-biscoito-')).map(k=>caches.delete(k)));
    await self.clients.claim();
    const clients=await self.clients.matchAll({includeUncontrolled:true,type:'window'});
    clients.forEach(client=>client.postMessage({type:'OFFLINE_READY'}));
  })());
});

self.addEventListener('message',event=>{
  if(event.data?.type==='CACHE_APP_SHELL'){
    event.waitUntil(cacheShell().then(async()=>{
      const clients=await self.clients.matchAll({includeUncontrolled:true,type:'window'});
      clients.forEach(client=>client.postMessage({type:'OFFLINE_READY'}));
    }));
  }
  if(event.data?.type==='SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin) return;

  if(event.request.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        // Rede primeiro com timeout curto; se não houver internet abre a cópia local imediatamente.
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),2200);
        const response=await fetch(event.request,{signal:controller.signal});
        clearTimeout(timer);
        if(response?.ok){
          const cache=await caches.open(CACHE);
          await cache.put('./index.html',response.clone());
          return response;
        }
      }catch{}
      return (await caches.match('./index.html',{ignoreSearch:true})) || (await caches.match('./',{ignoreSearch:true})) || Response.error();
    })());
    return;
  }

  event.respondWith((async()=>{
    const cached=await caches.match(event.request,{ignoreSearch:true});
    if(cached) return cached;
    try{
      const response=await fetch(event.request);
      if(response?.ok){
        const cache=await caches.open(CACHE);
        await cache.put(event.request,response.clone());
      }
      return response;
    }catch{
      return new Response('',{status:503,statusText:'Offline'});
    }
  })());
});

self.addEventListener('sync',event=>{
  if(event.tag==='edu-biscoito-sync') event.waitUntil(flushQueue());
});

function openDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains('queue')) db.createObjectStore('queue',{keyPath:'id'});
      if(!db.objectStoreNames.contains('config')) db.createObjectStore('config',{keyPath:'key'});
      if(!db.objectStoreNames.contains('app_state')) db.createObjectStore('app_state',{keyPath:'key'});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
function readQueueAndConfig(db){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['queue','config'],'readonly');
    const q=tx.objectStore('queue').getAll();
    const c=tx.objectStore('config').get('sync');
    tx.oncomplete=()=>resolve({events:(q.result||[]).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))),cfg:c.result?.value||{}});
    tx.onerror=()=>reject(tx.error);
  });
}
function deleteMany(db,ids){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('queue','readwrite');
    const store=tx.objectStore('queue');
    ids.forEach(id=>store.delete(id));
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error);
  });
}
async function flushQueue(){
  const db=await openDb();
  const {events,cfg}=await readQueueAndConfig(db);
  if(!cfg.enabled||!cfg.endpoint||!events.length) return;
  const headers={'Content-Type':'application/json'};
  if(cfg.token) headers.Authorization=`Bearer ${cfg.token}`;
  const response=await fetch(cfg.endpoint,{
    method:'POST',headers,
    body:JSON.stringify({source:'edu-biscoito-v3.4',deviceId:cfg.deviceId||null,sentAt:new Date().toISOString(),events})
  });
  if(!response.ok) throw new Error(`HTTP ${response.status}`);
  await deleteMany(db,events.map(e=>e.id));
  const clients=await self.clients.matchAll({includeUncontrolled:true,type:'window'});
  clients.forEach(client=>client.postMessage({type:'edu-biscoito-sync-complete',count:events.length,at:new Date().toISOString()}));
}
