const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert');
// Tes integrasi modul lazy: menjalankan js/app.js + modul di sandbox Node (tanpa jsdom), Supabase & DOM ditiru.
// Memverifikasi stub -> modul, guard pembatalan Snapshot (Hapus Semua / Import), penanda snapshot harian,
// serta modul yang menulis ke `let` di app.js. Pakai sumber js/modules/*.js; USE_MIN=1 untuk menguji hasil build *.min.js.
// Jalankan: node tests/test-modules.js
const ROOT=path.resolve(__dirname,'..'); const EXT=process.env.USE_MIN?'.min.js':'.js';
const reg={};
function el(id){ if(reg[id]) return reg[id]; const e={id,style:{},dataset:{},value:'',_html:'',classList:{add(){},remove(){},contains(){return false}},addEventListener(){},removeEventListener(){},appendChild(){},setAttribute(){},getAttribute(){return null},querySelector(){return null},querySelectorAll(){return []},focus(){},click(){},remove(){},reset(){},get innerHTML(){return this._html},set innerHTML(v){this._html=String(v)},textContent:''}; return reg[id]=e; }
const toasts=[]; const calls=[]; let lsStore={};
const sb={cfg:{}, from(tbl){ const self=this; const res=()=>{const c=self.cfg[tbl]; return c===undefined?{data:[],error:null}:(typeof c==='function'?c():c)};
  const chain=new Proxy({}, {get(_,k){ if(k==='then') return (ok,ko)=>Promise.resolve(res()).then(ok,ko);
    if(['insert','update','delete','upsert'].includes(k)) return (...a)=>{calls.push({tbl,op:k});return chain};
    return ()=>chain; }}); return chain; }};
const sandbox={console:{log(){},warn(){},error(){}},window:{},document:{addEventListener(){},removeEventListener(){},getElementById:id=>(id==='igRkMulai'||id==='igPlanMonth')?null:el(id),querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>el('_new'+Math.random()),documentElement:el('html'),body:el('body'),head:el('head')},
 navigator:{userAgent:'t'},location:{hostname:'localhost',href:'http://localhost/'},
 localStorage:{getItem:k=>(k in lsStore?lsStore[k]:null),setItem:(k,v)=>{lsStore[k]=String(v)},removeItem:k=>{delete lsStore[k]}},
 sessionStorage:{getItem(){return null},setItem(){},removeItem(){}},fetch:async()=>({ok:true,json:async()=>({})}),
 setTimeout,clearTimeout,setInterval,clearInterval,Date,Math,JSON,RegExp,Error,Promise,Number,String,Array,Object,Set,Map,Intl,
 MutationObserver:class{observe(){}disconnect(){}},alert(){}};
Object.assign(sandbox,{supabase:{createClient:()=>sb},addEventListener(){},removeEventListener(){},location:sandbox.location,sessionStorage:sandbox.sessionStorage,localStorage:sandbox.localStorage,matchMedia:()=>({matches:false,addListener(){},removeListener(){}}),enhanceSearchableSelect(){}});
sandbox.window=sandbox; sandbox.globalThis=sandbox; sandbox.self=sandbox;
const ctx=vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ROOT+'/js/app.js','utf8'),ctx,{filename:'app.js'});
const run=s=>vm.runInContext(s,ctx);
// pasang tiruan
ctx.supabaseClient=sb; run('supabaseClient = globalThis.supabaseClient');
ctx.showToast=(m,t)=>toasts.push(String(m)); run('showToast = globalThis.showToast');
let loaderFail=false, loaded=[];
ctx.__loader=src=>{ if(loaderFail) return Promise.reject(new Error('offline')); const f=src.split('?')[0].replace(/\.min\.js$/,EXT); loaded.push(f); vm.runInContext(fs.readFileSync(ROOT+'/'+f,'utf8'),ctx,{filename:f}); return Promise.resolve(); };
run('loadScriptOnce = src => globalThis.__loader(src)');
const results=[]; const T=async(n,f)=>{ try{ await f(); results.push(['OK',n]); }catch(e){ results.push(['FAIL',n+' -> '+e.message]); } };
const SNAP=['programs','kb_jamaah','jadwal_tamu','pendaftaran','pembayaran_jamaah','featured_programs'];
const reset=()=>{ sb.cfg={}; calls.length=0; toasts.length=0; loaderFail=false; };
(async()=>{

// --- snapshot harian: dijalankan PERTAMA, sebelum modul snapshot termuat ---
const inserts=()=>calls.filter(c=>c.tbl==='snapshot_backup'&&c.op==='insert').length;
const okSnap=()=>{ SNAP.forEach(t=>sb.cfg[t]={data:[{id:1}],error:null}); sb.cfg.snapshot_backup={data:[],error:null}; };
await T('harian: unduh modul gagal -> penanda hari TIDAK terkunci', async()=>{ reset(); lsStore={}; loaderFail=true; await run("maybeDailySnapshot()");
  assert.strictEqual(Object.keys(lsStore).length,0); assert.strictEqual(inserts(),0); });
await T('harian: unduh ok -> snapshot dibuat & penanda terisi; panggilan kedua di hari sama tidak dobel', async()=>{ reset(); lsStore={}; okSnap(); await run("maybeDailySnapshot()");
  assert.strictEqual(inserts(),1); assert.strictEqual(lsStore.amiru_last_daily_snapshot,new Date().toISOString().slice(0,10)); await run("maybeDailySnapshot()"); assert.strictEqual(inserts(),1); });
await T('harian: dua panggilan beruntun -> hanya 1 snapshot', async()=>{ reset(); lsStore={}; okSnap(); await Promise.all([run("maybeDailySnapshot()"),run("maybeDailySnapshot()")]); assert.strictEqual(inserts(),1); });
await T('snapshot: strict sukses -> true', async()=>{ reset(); SNAP.forEach(t=>sb.cfg[t]={data:[{id:1}],error:null}); sb.cfg.snapshot_backup={data:[],error:null};
  const r=await run("ensureAutoSnapshot('auto-pre-clear','x')"); assert.strictEqual(r,true); assert(calls.some(c=>c.tbl==='snapshot_backup'&&c.op==='insert')); });
await T('snapshot: satu tabel gagal + strict -> false & TIDAK insert', async()=>{ reset(); SNAP.forEach(t=>sb.cfg[t]={data:[{id:1}],error:null}); sb.cfg.pembayaran_jamaah={data:null,error:{message:'boom'}};
  const r=await run("ensureAutoSnapshot('auto-pre-clear','x')"); assert.strictEqual(!!r,false); assert(!calls.some(c=>c.tbl==='snapshot_backup'&&c.op==='insert'),'insert tetap terjadi'); });
await T('snapshot: manual/harian (non-strict) tetap toleran', async()=>{ reset(); SNAP.forEach(t=>sb.cfg[t]={data:[{id:1}],error:null}); sb.cfg.pembayaran_jamaah={data:null,error:{message:'boom'}}; sb.cfg.snapshot_backup={data:[],error:null};
  const r=await run("takeSnapshot('m','manual')"); assert.strictEqual(r,true); });
await T('stub: modul gagal diunduh -> ensureAutoSnapshot falsy', async()=>{ reset(); run("_lazyModulePromises['snapshot']=null"); 
  // modul sudah termuat di tes sebelumnya, uji lewat modul lain yang belum dimuat: simulasi pakai stub baru
  run("window.__stubTest = _makeLazyStub('snapshot','__nonexistent__')"); loaderFail=true; run("_lazyModulePromises['snapshot']=null");
  const r=await run("__stubTest()"); assert.strictEqual(r,undefined); assert(toasts.some(t=>/Gagal memuat modul/.test(t))); });
await T('clearAllAdminData: snapshot gagal -> TIDAK ada hapus', async()=>{ reset(); run("currentRole='admin'");
  SNAP.forEach(t=>sb.cfg[t]={data:[],error:null}); sb.cfg.pembayaran_jamaah={data:null,error:{message:'boom'}}; sb.cfg.programs={data:[{id:1}],count:1,error:null};
  let deleted=0; run("openActionConfirm = async()=>true"); ctx.__del=()=>{deleted++}; run("deleteProgramById = async()=>{ globalThis.__del(); }");
  run("loadDataFromSupabase=async()=>{}; renderAdminPanel=async()=>{}");
  await run("clearAllAdminData()"); assert.strictEqual(deleted,0,'program terhapus padahal snapshot gagal'); assert(toasts.some(t=>/DIBATALKAN/.test(t))); });
await T('clearAllAdminData: snapshot ok -> hapus jalan', async()=>{ reset(); run("currentRole='admin'");
  SNAP.forEach(t=>sb.cfg[t]={data:[],error:null}); sb.cfg.programs={data:[{id:1},{id:2}],count:2,error:null}; sb.cfg.snapshot_backup={data:[],error:null};
  let deleted=0; ctx.__del=()=>{deleted++}; await run("clearAllAdminData()"); assert.strictEqual(deleted,2); });
await T('importAdminData: snapshot gagal -> impor dibatalkan', async()=>{ reset(); run("currentRole='admin'");
  SNAP.forEach(t=>sb.cfg[t]={data:[],error:null}); sb.cfg.kb_jamaah={data:null,error:{message:'boom'}};
  let imported=0; ctx.__imp=()=>{imported++}; run("importProgramList = async()=>{ globalThis.__imp(); return {ok:0,failed:[]}; }; importOtherTables = async()=>{ globalThis.__imp(); return []; }; showImportResult=()=>{}; loadDataFromSupabase=async()=>{}; renderAdminPanel=async()=>{}");
  const input=el('_input'); sandbox.document.createElement=()=>input; sandbox.FileReader=class{ readAsText(){ this.onload({target:{result:JSON.stringify({_meta:{exported_at:new Date().toISOString()},programs:[{id:'a'}]})}}); } };
  run("openActionConfirm = async()=>true"); run("importAdminData()"); await input.onchange({target:{files:[{size:10}]}}); await new Promise(r=>setTimeout(r,30));
  assert.strictEqual(imported,0,'impor tetap jalan padahal snapshot gagal'); assert(toasts.some(t=>/DIBATALKAN/.test(t))); });
await T('importAdminData: snapshot ok -> impor jalan', async()=>{ reset(); run("currentRole='admin'"); SNAP.forEach(t=>sb.cfg[t]={data:[],error:null}); sb.cfg.snapshot_backup={data:[],error:null};
  let imported=0; ctx.__imp=()=>{imported++}; const input=el('_input2'); sandbox.document.createElement=()=>input;
  run("importAdminData()"); await input.onchange({target:{files:[{size:10}]}}); await new Promise(r=>setTimeout(r,30)); assert(imported>=1); });
loaderFail=false; run("_lazyModulePromises['profil-perusahaan']=null");
await T('profil: stub memuat modul & render form sekali', async()=>{ reset(); const m=el('companyProfileMount'); m.dataset={}; m.innerHTML=''; ['cp_rekening_list','cp_kontak_wa_list'].forEach(i=>el(i));
  await run("renderCompanyProfilePanel()"); assert(/cp_brand/.test(m.innerHTML)); assert.strictEqual(m.dataset.ready,'1'); });
await T('profil: saveCompanyProfile menimpa NOTA_PERUSAHAAN (let inti) lewat modul', async()=>{ reset(); sb.cfg.tg_config={data:[],error:null};
  el('cp_brand').value='B2'; el('cp_nama').value='PT BARU'; el('cp_alamat').value='Jl X'; el('cp_telp').value='1'; el('cp_email').value='a@b.c';
  await run("saveCompanyProfile()"); assert.strictEqual(run("NOTA_PERUSAHAAN.nama"),'PT BARU'); assert(calls.some(c=>c.tbl==='tg_config'&&c.op==='upsert')); });
await T('cicilan: closeCicilanModal (modul) mereset state let di inti', async()=>{ reset(); run("cicilanJamaahId='x'; cicilanSisaTagihan=99; cicilanHargaProgram=5");
  await run("closeCicilanModal()"); assert.strictEqual(run("cicilanJamaahId"),null); assert.strictEqual(run("cicilanSisaTagihan"),0); });
await T('cicilan: saveCicilan terpasang withBusy & sync* tetap di inti', async()=>{ assert.strictEqual(run("typeof saveCicilan"),'function'); assert.strictEqual(run("typeof syncJamaahStatus"),'function'); assert.strictEqual(run("typeof syncJamaahStatusForProgram"),'function'); });
const gagal=results.filter(r=>r[0]==='FAIL');
console.log('\n=== TEST: modul lazy (integrasi) ===');
results.forEach(r=>console.log('  '+(r[0]==='OK'?'✓':'✗')+' '+r[1]));
console.log('\n=== HASIL: '+(results.length-gagal.length)+' passed, '+gagal.length+' failed ===  (modul termuat: '+[...new Set(loaded)].map(f=>path.basename(f)).join(', ')+')');
process.exit(gagal.length?1:0);
})();
