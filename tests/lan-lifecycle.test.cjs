const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const P=require('../app/src/main/assets/lan_api.js');
const assets=path.resolve(__dirname,'../app/src/main/assets');
const source=fs.readFileSync(path.join(assets,'lan_runtime.js'),'utf8');
// Enforce the real native bridge allowlist, not an unrestricted filesystem mock.
const bridgeSource=fs.readFileSync(path.resolve(__dirname,'../app/src/main/java/com/fhcpeboard/android/CoreJsInterface.kt'),'utf8');
const allowedAssets=new Set([...bridgeSource.match(/require\(name in setOf\(([^)]*)\)\)/)[1].matchAll(/"([^"]+)"/g)].map(m=>m[1]));
const profile={id:'test',host:'http://192.168.8.1',name:'TEST',username:'admin',password:'TEST_ONLY',refresh:true,refreshSec:5,reconnect:true,autoLogin:true,verified:true,authSchema:2};
const flush=()=>new Promise(r=>setImmediate(r));
const error=(code)=>Object.assign(Error(code),{code});
async function runtime(saved,bootErrors=[]){
  let now=1000,interval,stored=saved?JSON.stringify(saved):'';const nativeStore=new Map();
  const counts={login:0,probe:0,live:0,sample:0,actions:[]},calls=[],behavior={expired:false,errors:bootErrors.slice(),gate:null,renameFails:false,ca:'0',caReadMissing:false,caReject:false,badgeError:null,otaError:null};
  class Clock extends Date{static now(){return now;}}
  class Api{
    constructor(options){this.queue=Promise.resolve();this.line={label:'TEST',id:'fh_api_tmp',mode:options.fhLine==='air6'?'air6':'enc'};}
    serial(work){return P.LanApi.prototype.serial.call(this,work);}
    login(user,password){return this.serial(async()=>{counts.login++;counts.lastCredentials={user,password};const e=behavior.errors.shift();if(e)throw e;if(behavior.loginGate)await behavior.loginGate;behavior.expired=false;return {data:{modelName:'TEST'},line:this.line};});}
    probe(){return this.serial(async()=>{counts.probe++;if(behavior.probeGate)await behavior.probeGate;if(behavior.expired)throw error('SESSION_EXPIRED');});}
    speed(){const work=async()=>{counts.live++;if(behavior.gate)await behavior.gate;if(behavior.expired)throw error('SESSION_EXPIRED');return {up:1,down:2};};return this.line.mode==='air6'?work():this.serial(work);}
    sample(options={}){return this.serial(async()=>{counts.sample++;if(options.global&&this.line.mode==='air6'){counts.actions.push({action:'air6ReadControlSummary'});if(options.smsBadge)counts.actions.push({action:'smsBadgeProbe'});}if(behavior.sampleError)throw error(behavior.sampleError);if(behavior.sampleGate)await behavior.sampleGate;if(behavior.expired)throw error('SESSION_EXPIRED');return {deviceName:'TEST',deviceSN:'SN-123',rsrp:'-95'};});}
    action(msg){return this.serial(async()=>{counts.actions.push(msg);if(msg.action==='smsBadgeProbe'&&behavior.badgeError)throw error(behavior.badgeError);if(msg.action==='air6Ota'&&behavior.otaError)throw error(behavior.otaError);});}
    initialize(){return Promise.resolve();}
    post(method,data){counts.actions.push({method,data});if(method==='set_single_by_xmlnode'){if(behavior.renameFails)return Promise.reject(error('DEVICE_WRITE_REJECTED'));if(data.url.endsWith('CaEnable')&&!behavior.caReject)behavior.ca=data.value;return Promise.resolve({success:'true'});}if(method==='get_value_by_xmlnode')return Promise.resolve(data?.ca?(behavior.caReadMissing?{}:{ca:behavior.ca}):{name:'Living Room'});return Promise.resolve({success:'true'});}
    setReconnect(value){this.reconnect=value;}
  }
  const c={Date:Clock,JSON,Math,console,LanProtocol:{address:P.address,LanApi:Api},setInterval:(fn,ms)=>{assert.equal(ms,1000);interval=fn;},__nfetch:()=>{},__nloadHTML:async html=>{assert.ok(html.includes('localLoginModal'));return true;}};c.window=c;
  c.AndroidCore={nativePing:()=>JSON.stringify({ok:true,ver:'1.4.2-local-36'}),assetRead:n=>{assert.ok(allowedAssets.has(n),'AndroidCore.assetRead rejects '+n);return fs.readFileSync(path.join(assets,n),'utf8');},kcGet:k=>k==='LAN_PROFILES_V1'?stored:nativeStore.get(k)||'',kcSet:(k,v)=>{if(k==='LAN_PROFILES_V1')stored=v;else nativeStore.set(k,v);},kcRemove:k=>nativeStore.delete(k),clearCaches:()=>{let count=0;for(const key of [...nativeStore.keys()])if(key.startsWith('UPSTREAM_LOCAL_DEVICE_')||key.startsWith('UPSTREAM_LOCAL_WIFI_CACHE_')){nativeStore.delete(key);count++;}return count;},log:message=>{throw Error(message);}};
  c.__nevalJS=async code=>{const name=/typeof (\w+)==='function'/.exec(code)?.[1];if(name){const t={console,[name]:value=>calls.push({name,value})};vm.runInNewContext(code,t);}return true;};
  vm.createContext(c);vm.runInContext(source,c);await flush();
  return {c,counts,calls,behavior,nativeStore,at:t=>now=t,saved:()=>JSON.parse(stored),send:(action,extra={})=>c.__onPageMessage(JSON.stringify({action,...extra})),login:async p=>{await c.__onPageMessage(JSON.stringify({action:'lanLogin',profile:p||profile}));await flush();},tick:async t=>{now=t;assert.ok(interval);await interval();await flush();},native:async v=>{await c.__lanActive(v);await flush();}};
}
test('resume probes a healthy session without resubmitting a password',async()=>{
  const h=await runtime();await h.login({...profile,refresh:false});await h.native(false);h.at(3000);await h.native(true);assert.equal(h.counts.probe,1);assert.equal(h.counts.login,1);
});

test('automatic recovery of the same device does not reset its open settings UI',async()=>{
 const h=await runtime();await h.login({...profile,fhLine:'air6'});const resets=h.calls.filter(v=>v.name==='lanDeviceType').length;
 h.behavior.expired=true;await h.native(false);await h.native(true);assert.equal(h.counts.login,2);assert.equal(h.calls.filter(v=>v.name==='lanDeviceType').length,resets);
 await h.login({...profile,id:'second',host:'http://192.168.9.1',fhLine:'air6'});assert.equal(h.calls.filter(v=>v.name==='lanDeviceType').length,resets+1);
});

test('temporary automatic authentication failure does not open configuration or stop retries',async()=>{
 const h=await runtime();await h.login();h.behavior.expired=true;h.behavior.errors.push(error('NETWORK'));await h.native(false);await h.native(true);
 const failure=h.calls.filter(v=>v.name==='lanLoginState'&&v.value.automatic&&v.value.error).at(-1);assert.equal(failure.value.open,false);
 await h.tick(100000);assert.equal(h.counts.login,3);
});

test('explicit device switch waits for automatic login rather than silently dropping the click',async()=>{
 const h=await runtime();await h.login();h.behavior.expired=true;await h.tick(2000);let release;h.behavior.loginGate=new Promise(r=>release=r);const auto=h.tick(7000);await flush();
 const manual=h.login({...profile,id:'second',host:'http://192.168.9.1',password:'SECOND'});await flush();release();await Promise.all([auto,manual]);assert.equal(h.counts.lastCredentials.password,'SECOND');assert.equal(h.saved().activeId,'second');
});
test('resume relogs an expired session even when refresh is disabled',async()=>{
  const h=await runtime();await h.login({...profile,refresh:false});await h.native(false);h.behavior.expired=true;h.at(3000);await h.native(true);assert.equal(h.counts.login,2);
});
test('native pause cannot be overridden by stale page-visible events',async()=>{
  const h=await runtime();await h.login();await h.native(false);await h.send('lanVisibility',{visible:true});await h.tick(30000);assert.equal(h.counts.live,0);await h.send('lanVisibility',{visible:false});await h.native(true);assert.equal(h.counts.probe,0);await h.send('lanVisibility',{visible:true});assert.equal(h.counts.probe,1);
});
test('transient login failure retries with backoff, authentication rejection does not',async()=>{
  const h=await runtime();h.behavior.errors.push(error('NETWORK'),error('NETWORK'));await h.login();await h.tick(5999);assert.equal(h.counts.login,1);await h.tick(6000);assert.equal(h.counts.login,2);await h.tick(16000);assert.equal(h.counts.login,3);
  const bad=await runtime();bad.behavior.errors.push(error('AUTH_REJECTED'));await bad.login();await bad.tick(100000);await bad.native(false);await bad.native(true);assert.equal(bad.counts.login,1);
});
test('authentication rejection revokes persisted auto-login trust across cold starts',async()=>{
  const h=await runtime({profiles:[profile],activeId:profile.id},[error('AUTH_REJECTED')]);assert.equal(h.counts.login,1);assert.equal(h.saved().profiles[0].verified,false);assert.equal(h.saved().profiles[0].fhLine,'');
  const cold=await runtime(h.saved());assert.equal(cold.counts.login,0);assert.ok(cold.calls.some(c=>c.name==='lanLoginState'&&c.value.configured&&c.value.open));
});
test('non-retryable automatic protocol failures open configuration instead of leaving a dead dashboard',async()=>{
  const h=await runtime({profiles:[profile],activeId:profile.id},[error('PROTOCOL')]);
  const failure=h.calls.filter(c=>c.name==='lanLoginState'&&c.value.automatic&&c.value.error).at(-1);
  assert.equal(failure.value.open,true);assert.equal(h.counts.login,1);await h.tick(100000);assert.equal(h.counts.login,1);
});
test('upstream save and relogin messages are atomic and use new credentials',async()=>{
  const h=await runtime();const a=h.send('saveLocalAccounts',{accounts:[{host:'192.168.8.1',user:'admin',pass:'NEW_TEST'}],activeIndex:0});const b=h.send('reloginNow');await Promise.all([a,b]);assert.equal(h.counts.login,1);assert.equal(h.counts.lastCredentials.password,'NEW_TEST');assert.equal(h.saved().profiles[0].verified,true);
});
test('save-only does not claim login and verified flags are invalidated on credentials change',async()=>{
  const h=await runtime();await h.login();await h.send('saveLocalAccounts',{accounts:[{...profile,user:'admin',pass:'OTHER_TEST',password:'OTHER_TEST'}],activeIndex:0});assert.equal(h.saved().profiles[0].verified,false);const cold=await runtime(h.saved());assert.equal(cold.counts.login,1);
});
test('blank saved password preserves an existing account password',async()=>{
  const h=await runtime();await h.login();await h.send('saveLocalAccounts',{accounts:[{id:profile.id,host:profile.host,user:profile.username,pass:''}],activeIndex:0});assert.equal(h.saved().profiles[0].password,'TEST_ONLY');
});
test('current-schema verified profiles cold start automatically logs in',async()=>{
  const h=await runtime({profiles:[profile],activeId:profile.id});assert.equal(h.counts.login,1);assert.equal(h.saved().profiles[0].id,profile.id);
  assert.ok(!h.calls.some(c=>c.name==='lanLoginState'&&c.value.open),'successful auto-login must never show a login frame');
});
test('legacy profiles discard cached routing trust and authenticate afresh',async()=>{
  const legacy={...profile,authSchema:undefined,fhLine:'pro2'};const h=await runtime({profiles:[legacy],activeId:legacy.id});
  assert.equal(h.counts.login,1);assert.equal(h.saved().profiles[0].verified,true);assert.equal(h.saved().profiles[0].authSchema,2);
  assert.ok(h.calls.some(c=>c.name==='lanLoginState'&&c.value.configured&&!c.value.open));
});
test('successful login persists the selected local protocol to speed up the next startup',async()=>{
  const h=await runtime();await h.login();
  assert.equal(h.saved().profiles[0].fhLine,'pro2');
  assert.equal(h.calls.filter(c=>c.name==='lineConfigResult').at(-1).value.accounts[0].fhLine,'pro2');
});
test('first setup opens configuration while saved valid profiles auto-login regardless of legacy toggle',async()=>{
  for(const saved of [undefined,{profiles:[{...profile,verified:false}],activeId:profile.id},{profiles:[{...profile,autoLogin:false}],activeId:profile.id}]){
    const h=await runtime(saved);assert.equal(h.counts.login,saved?1:0);assert.equal(h.calls.some(c=>c.name==='lanLoginState'&&c.value.open),!saved);
  }
});
test('automatic login failure opens the dialog only after the attempt fails',async()=>{
  const h=await runtime({profiles:[profile],activeId:profile.id},[error('AUTH_REJECTED')]);
  const states=h.calls.filter(c=>c.name==='lanLoginState');
  const opening=states.findIndex(c=>c.value.open);
  assert.equal(h.counts.login,1);assert.ok(opening>0);assert.ok(states[opening].value.error);
  assert.ok(states.slice(0,opening).some(c=>c.value.busy));
});
test('refresh, reconnect and auto-login options apply without overwriting credentials',async()=>{
  const h=await runtime();await h.login();await h.send('lanOptions',{id:profile.id,refresh:false,reconnect:false,autoLogin:false});await h.tick(2000);assert.equal(h.counts.live,0);assert.equal(h.saved().profiles[0].password,profile.password);assert.equal(h.saved().profiles[0].verified,true);const cold=await runtime(h.saved());assert.equal(cold.counts.login,1);h.behavior.expired=true;await h.native(false);await h.native(true);assert.equal(h.counts.login,1);
});
test('speed targets 1 second while full overview follows the selected refresh interval',async()=>{
  const h=await runtime();await h.login();await h.tick(2000);await h.tick(3000);await h.tick(4000);assert.equal(h.counts.live,3);assert.equal(h.counts.sample,1);await h.tick(5999);assert.equal(h.counts.sample,1);await h.tick(6000);assert.equal(h.counts.sample,2);
});
test('global refresh never slows after inactivity and supports disabling',async()=>{
 const h=await runtime();await h.login({...profile,refreshSec:3});
 for(const t of [4000,7000,10000,31000,34000,37000]){const before=h.counts.sample;await h.tick(t);assert.equal(h.counts.sample,before+1);}
 await h.send('lanAutoRefresh',{id:profile.id,sec:0});const before=h.counts.sample;await h.tick(100000);assert.equal(h.counts.sample,before);assert.ok(h.counts.live>0);
});

test('global full refresh runs on settings while live speed stays overview-only',async()=>{
 const h=await runtime();await h.login();await h.send('switchPage',{page:'settings'});await h.tick(6000);assert.equal(h.counts.sample,2);assert.equal(h.counts.live,0);await h.send('switchPage',{page:'overview'});await h.tick(11000);assert.equal(h.counts.sample,3);
});

test('SMS cache persists per CPE account and restores only inside the same scope',async()=>{
  const h=await runtime(),payload=JSON.stringify({t:123,recv:[{msg_content:'A'}],send:[{msg_content:'B'}]});await h.login();await h.send('smsCacheSave',{payload});
  const firstKey=[...h.nativeStore.keys()].find(key=>key.endsWith('_SMS_CACHE_V1'));assert.ok(firstKey);assert.equal(h.nativeStore.get(firstKey),payload);
  await h.send('smsCacheLoad');assert.equal(h.calls.filter(c=>c.name==='smsCacheLoaded').at(-1).value,payload);
  const other={...profile,id:'second',host:'http://192.168.9.1'};await h.send('saveLocalAccounts',{accounts:[profile,other],activeIndex:1});await h.send('reloginNow');await h.send('smsCacheLoad');assert.equal(h.calls.filter(c=>c.name==='smsCacheLoaded').at(-1).value,null);
  await h.send('smsCacheSave',{payload:JSON.stringify({t:456,recv:[{msg_content:'C'}],send:[]})});assert.equal([...h.nativeStore.keys()].filter(key=>key.endsWith('_SMS_CACHE_V1')).length,2);
});
test('clear cache removes encrypted device caches but preserves profiles and preferences',async()=>{
  const h=await runtime(),payload=JSON.stringify({t:123,recv:[{msg_content:'A'}],send:[]});await h.login();await h.send('smsCacheSave',{payload});
  h.nativeStore.set('UPSTREAM_LOCAL_WIFI_CACHE_TEST','WIFI');h.nativeStore.set('UPSTREAM_LOCAL_UI_PREFS_','PREFS');await h.send('clearCacheFiles');
  assert.equal([...h.nativeStore.keys()].some(key=>key.endsWith('_SMS_CACHE_V1')),false);assert.equal(h.nativeStore.has('UPSTREAM_LOCAL_WIFI_CACHE_TEST'),false);assert.equal(h.nativeStore.get('UPSTREAM_LOCAL_UI_PREFS_'),'PREFS');
  assert.equal(h.saved().profiles[0].password,profile.password);const result=h.calls.filter(c=>c.name==='localCacheCleared').at(-1).value;assert.equal(result.ok,true);assert.ok(result.count>=2);
});
test('legacy refresh preference migrates to an explicit auto-refresh interval',async()=>{
  const on=await runtime({profiles:[{...profile,refreshSec:undefined,refresh:true}],activeId:profile.id});assert.equal(on.saved().profiles[0].refreshSec,5);
  const off=await runtime({profiles:[{...profile,refreshSec:undefined,refresh:false}],activeId:profile.id});assert.equal(off.saved().profiles[0].refreshSec,0);
});
test('slow requests cannot accumulate overlapping polling ticks',async()=>{
  const h=await runtime();await h.login();let release;h.behavior.gate=new Promise(r=>release=r);const job=h.tick(2000);await flush();await h.tick(3000);await h.tick(4000);assert.equal(h.counts.live,1);release();await job;
});
test('test connection neither saves nor falsely marks selected account connected',async()=>{
  const h=await runtime();await h.send('testLocalConnection',{host:'192.168.8.1',user:'admin',pass:'TEST_ONLY'});assert.equal(h.counts.login,1);assert.ok(h.calls.some(c=>c.name==='localTestResult'&&c.value.ok));assert.ok(!h.calls.some(c=>c.name==='lanLoginState'&&c.value.success));assert.throws(()=>h.saved());
});
test('removing the active account cancels pending recovery',async()=>{
  const h=await runtime();await h.login();await h.send('saveLocalAccounts',{accounts:[],activeIndex:0});await h.tick(100000);await h.native(false);await h.native(true);assert.equal(h.counts.login,1);
});
test('local feature actions go to imported upstream dispatcher, not capture adapters',async()=>{
  const h=await runtime();await h.login();await h.send('sendAtCommand',{cmd:'AT'});assert.equal(h.counts.actions.at(-1).action,'sendAtCommand');assert.ok(!/lan_queries|LanModel|lan_model/.test(source));
});
test('carrier aggregation write is verified and releases the UI operation lock',async()=>{
  const h=await runtime();await h.login();await h.send('toggleCA',{switch:'1'});
  assert.ok(h.counts.actions.some(c=>c.method==='set_single_by_xmlnode'&&c.data.url==='X_FH_MobileNetwork.NetworkInfo.CaEnable'&&c.data.value==='1'));
  assert.ok(h.counts.actions.some(c=>c.method==='get_value_by_xmlnode'&&c.data.ca==='X_FH_MobileNetwork.NetworkInfo.CaEnable'));
  assert.ok(h.calls.some(c=>c.name==='caLocalResult'&&c.value.ok&&c.value.value==='1'));
  await h.send('toggleCA',{switch:'0'});assert.equal(h.calls.filter(c=>c.name==='caLocalResult').at(-1).value.value,'0');
});
test('CA missing readback, rejected state and offline attempts release the operation without false success',async()=>{
  const h=await runtime();await h.send('toggleCA',{switch:'1'});assert.equal(h.calls.filter(c=>c.name==='caLocalResult').at(-1).value.ok,false);
  await h.login();h.behavior.caReadMissing=true;await h.send('toggleCA',{switch:'1'});assert.equal(h.counts.actions.some(c=>c.method==='set_single_by_xmlnode'),false);
  h.behavior.caReadMissing=false;h.behavior.caReject=true;await h.send('toggleCA',{switch:'1'});const failure=h.calls.filter(c=>c.name==='caLocalResult').at(-1).value;assert.equal(failure.ok,false);assert.equal(failure.value,'0');
  await h.tick(2000);assert.equal(h.counts.login,1);assert.equal(h.counts.live,1,'device rejection does not drop a healthy session');
});
test('saving another selected profile stops all traffic to the previous device until login',async()=>{
  const h=await runtime();await h.login();await h.send('saveLocalAccounts',{accounts:[profile,{host:'192.168.9.1',user:'admin',pass:'SECOND'}],activeIndex:1});
  await h.tick(100000);assert.equal(h.counts.live,0);assert.equal(h.counts.login,1);await h.send('reloginNow');assert.equal(h.counts.login,2);assert.equal(h.counts.lastCredentials.password,'SECOND');
});
test('editing a profile identity never inherits the other users password',async()=>{
  const h=await runtime();await h.login();await h.send('saveLocalAccounts',{accounts:[{id:profile.id,host:profile.host,user:'superadmin',pass:''}],activeIndex:0});assert.equal(h.saved().profiles[0].password,'');assert.equal(h.saved().profiles[0].verified,false);
});
test('save-only switching to a previously verified profile waits for explicit login',async()=>{
  const other={...profile,id:'second',host:'http://192.168.9.1'};
  const h=await runtime({profiles:[profile,other],activeId:profile.id});assert.equal(h.counts.login,1);
  await h.send('saveLocalAccounts',{accounts:[profile,other],activeIndex:1});await h.tick(100000);await h.native(false);await h.native(true);assert.equal(h.counts.login,1);
  await h.send('reloginNow');assert.equal(h.counts.login,2);
});
test('switch login waits for the previous devices in-flight polling request',async()=>{
  const h=await runtime();await h.login();let release;h.behavior.gate=new Promise(r=>release=r);
  const poll=h.tick(2000);await flush();await h.send('saveLocalAccounts',{accounts:[profile,{host:'192.168.9.1',user:'admin',pass:'SECOND'}],activeIndex:1});
  const login=h.send('reloginNow');await flush();assert.equal(h.counts.login,1);release();await Promise.all([poll,login]);assert.equal(h.counts.login,2);
});
test('overview and identity screen receive the device serial and name values',async()=>{
  const h=await runtime();await h.login();const overview=h.calls.find(c=>c.name==='updateData'&&c.value.deviceSN);assert.equal(overview.value.deviceSN,'SN-123');assert.equal(overview.value.deviceName,'TEST');
});


test('saving a new profile does not log in until restart and preserves old reconnect options',async()=>{
  const h=await runtime();await h.send('saveLocalAccounts',{accounts:[{host:'192.168.1.1',user:'root',pass:'TEST'}],activeIndex:0});assert.equal(h.counts.login,0);const cold=await runtime(h.saved());assert.equal(cold.counts.login,1);
  await h.login({...profile,reconnect:false});await h.send('saveLocalAccounts',{accounts:[{id:profile.id,host:profile.host,user:profile.username,pass:profile.password}],activeIndex:0});assert.equal(h.saved().profiles[0].reconnect,false);
});
test('disabling reconnect cancels a pending retry and remains disabled across resume',async()=>{
  const h=await runtime();await h.login();h.behavior.expired=true;await h.tick(2000);
  await h.send('lanOptions',{id:profile.id,reconnect:false});await h.tick(100000);await h.native(false);await h.native(true);assert.equal(h.counts.login,1);assert.equal(h.saved().profiles[0].reconnect,false);
});
test('reconnect switch applies without waiting for slow device actions',async()=>{
  const h=await runtime();await h.login();let release;h.behavior.gate=new Promise(r=>release=r);
  const job=h.send('speedPoll');await flush();await h.send('lanOptions',{id:profile.id,reconnect:false});assert.equal(h.saved().profiles[0].reconnect,false);
  h.behavior.expired=true;release();await job;await h.tick(100000);await h.native(false);await h.native(true);assert.equal(h.counts.login,1);
});
test('header profile switching logs in the persisted destination without overwriting other profiles',async()=>{
  const other={...profile,id:'air6',host:'http://192.168.1.1',username:'root',password:'OTHER',reconnect:false,autoLogin:false};
  const h=await runtime({profiles:[{...profile,autoLogin:false},other],activeId:profile.id});await h.send('lanSwitchProfile',{id:'air6'});
  assert.equal(h.counts.lastCredentials.user,'root');assert.equal(h.counts.lastCredentials.password,'OTHER');assert.equal(h.saved().activeId,'air6');assert.equal(h.saved().profiles.find(p=>p.id===profile.id).password,profile.password);
});

test('refresh interval persists across cold starts and disabled full refresh stays off on resume',async()=>{
 const h=await runtime();await h.login();await h.send('lanAutoRefresh',{id:profile.id,sec:8});
 const cold=await runtime(h.saved());assert.equal(cold.counts.sample,1);await cold.tick(8999);assert.equal(cold.counts.sample,1);await cold.tick(9000);assert.equal(cold.counts.sample,2);
 await cold.send('lanAutoRefresh',{id:profile.id,sec:0});await cold.native(false);await cold.tick(50000);await cold.native(true);assert.equal(cold.counts.sample,2);
 await cold.send('switchPage',{page:'control'});await cold.send('switchPage',{page:'overview'});await cold.tick(50001);assert.equal(cold.counts.sample,2);
});
test('slow full refresh schedules next interval after completion without overlapping live samples',async()=>{
 const h=await runtime();await h.login();await h.send('lanAutoRefresh',{id:profile.id,sec:3});let release;h.behavior.sampleGate=new Promise(r=>release=r);
 const job=h.tick(4000);await flush();await h.tick(6000);await h.tick(9000);assert.equal(h.counts.sample,2);assert.equal(h.counts.live,0);
 h.at(10000);release();await job;h.behavior.sampleGate=null;await h.tick(12999);assert.equal(h.counts.sample,2);await h.tick(13000);assert.equal(h.counts.sample,3);
});
test('turning off full refresh during an in-flight request prevents subsequent polls',async()=>{
 const h=await runtime();await h.login();let release;h.behavior.sampleGate=new Promise(r=>release=r);const job=h.tick(6000);await flush();
 await h.send('lanAutoRefresh',{id:profile.id,sec:0});release();await job;h.behavior.sampleGate=null;await h.tick(20000);assert.equal(h.counts.sample,2);assert.ok(h.counts.live>0);
});

test('testing another configuration never resumes the old account implicitly',async()=>{
 const h=await runtime({profiles:[profile],activeId:profile.id});assert.equal(h.counts.login,1);await h.send('testLocalConnection',{host:'192.168.1.1',user:'root',pass:'TEST_OTHER'});assert.equal(h.counts.login,2);await h.native(false);await h.native(true);await h.tick(100000);assert.equal(h.counts.login,2);
});

test('configuration editing blocks foreground recovery and stale automatic login completion',async()=>{
 const h=await runtime();await h.login();h.behavior.expired=true;await h.tick(2000);let release;h.behavior.loginGate=new Promise(r=>release=r);
 const pending=h.tick(7000);await flush();const successes=h.calls.filter(c=>c.name==='lanLoginState'&&c.value.success).length;
 await h.send('lanProfileEditing',{open:true});await h.native(false);await h.native(true);release();await pending;h.behavior.loginGate=null;
 assert.equal(h.calls.filter(c=>c.name==='lanLoginState'&&c.value.success).length,successes);await h.tick(100000);assert.equal(h.counts.login,2);
 await h.send('reloginNow');assert.equal(h.counts.login,3);assert.equal(h.calls.filter(c=>c.name==='lanLoginState'&&c.value.success).length,successes+1);
});

test('opening editor pauses new retries while saved custom names survive restart',async()=>{
 const h=await runtime();await h.login();await h.send('lanProfileEditing',{open:true});h.behavior.expired=true;await h.tick(100000);await h.native(false);await h.native(true);assert.equal(h.counts.login,1);
 await h.send('saveLocalAccounts',{accounts:[{...profile,name:'家里 Air6',nameCustom:true}],activeIndex:0});const cold=await runtime(h.saved());assert.equal(cold.saved().profiles[0].name,'家里 Air6');assert.equal(cold.saved().profiles[0].nameCustom,true);
});
test('offline settings finish their own UI callbacks rather than leaving a spinner locked',async()=>{
 const h=await runtime();for(const [action,callback,extra] of [['air6WifiLoad','air6WifiData',{}],['air6AdvancedSave','air6AdvancedData',{kind:'usb',value:'ep'}],['air6ExtraSave','air6ExtraData',{kind:'storage',mode:'SIM'}],['sendAtCommand','atResult',{}],['rebootDevice','air6RebootResult',{}]]){await h.send(action,{requestId:'offline',...extra});const result=h.calls.filter(c=>c.name===callback).at(-1);assert.equal(result.value.ok,false);assert.equal(result.value.requestId,'offline');}
});

test('offline SMS list and detail requests return completion errors to the inbox',async()=>{
 const h=await runtime();for(const [action,type]of [['smsList','list'],['smsGet','get']]){await h.send(action);const result=h.calls.filter(c=>c.name==='smsUpdate').at(-1);assert.equal(result.value.type,type);assert.match(result.value.error,/登录/);}
});

test('Air6 startup reads control summaries even before visiting the control tab',async()=>{
 const h=await runtime({profiles:[{...profile,fhLine:'air6'}],activeId:profile.id});assert.ok(h.counts.actions.some(v=>v.action==='air6ReadControlSummary'));await h.send('switchPage',{page:'control'});assert.ok(h.counts.actions.some(v=>v.action==='switchPage'&&v.page==='control'));
});
test('Air6 startup prioritizes unread SMS and OTA badges before the full dashboard',async()=>{
 const h=await runtime();await h.login({...profile,fhLine:'air6',refresh:false,refreshSec:0});
 assert.deepEqual(h.counts.actions.slice(0,3).map(v=>[v.action,v.kind||'']),[['smsBadgeProbe',''],['air6Ota','status'],['air6ReadControlSummary','']]);
 assert.equal(h.counts.sample,1);await h.tick(30000);assert.equal(h.counts.actions.filter(v=>v.action==='smsBadgeProbe').length,1);
 await h.tick(31000);assert.equal(h.counts.actions.filter(v=>v.action==='smsBadgeProbe').length,2);assert.equal(h.counts.actions.filter(v=>v.action==='air6Ota').length,1);
 await h.send('switchPage',{page:'sms'});await h.tick(61000);assert.equal(h.counts.actions.filter(v=>v.action==='smsBadgeProbe').length,2,'the open inbox owns its own refresh');
 await h.tick(601000);assert.equal(h.counts.actions.filter(v=>v.action==='air6Ota').length,2,'OTA status is rechecked after ten minutes');
 const fh=await runtime();await fh.login({...profile,fhLine:'pro2'});assert.equal(fh.counts.actions.some(v=>v.action==='smsBadgeProbe'||v.action==='air6Ota'),false);
});
test('badge probe failures never turn a successful Air6 login into a login failure',async()=>{
 const h=await runtime();h.behavior.badgeError='NETWORK';h.behavior.otaError='NETWORK';await h.login({...profile,fhLine:'air6'});
 assert.equal(h.counts.login,1);assert.equal(h.counts.sample,1);assert.ok(h.calls.some(c=>c.name==='lanLoginState'&&c.value.success));assert.equal(h.calls.some(c=>c.name==='lanLoginState'&&c.value.error),false);
});


test('foreground resume runs one global refresh without logging in again',async()=>{
 for(const page of ['control','neighbor','settings']){const h=await runtime();await h.login({...profile,fhLine:'air6'});await h.send('switchPage',{page});const before=h.counts.sample;await h.send('lanVisibility',{visible:false});await h.native(false);await h.native(true);await h.send('lanVisibility',{visible:true});await h.send('lanVisibility',{visible:true});assert.equal(h.counts.login,1);assert.equal(h.counts.sample,before+1);assert.ok(h.calls.some(c=>c.name==='lanGlobalRefresh'));}
});

test('a data parsing failure after authentication keeps the session and does not reopen login',async()=>{
 const h=await runtime();h.behavior.sampleError='PROTOCOL';await h.login();assert.equal(h.counts.login,1);assert.ok(h.calls.some(c=>c.name==='lanLoginState'&&c.value.success));assert.ok(!h.calls.some(c=>c.name==='lanLoginState'&&c.value.error&&c.value.open));await h.native(false);await h.native(true);assert.equal(h.counts.login,1);h.behavior.sampleError=null;await h.tick(100000);assert.ok(h.calls.some(c=>c.name==='updateData'));
});

test('live speed polling stops outside the overview page and while backgrounded',async()=>{
 const h=await runtime();await h.login({...profile,refreshSec:0});const base=h.counts.live;
 await h.tick(5000);assert.ok(h.counts.live>base,'overview polls live speed');
 await h.send('switchPage',{page:'control'});const onControl=h.counts.live;await h.tick(8000);await h.tick(9000);assert.equal(h.counts.live,onControl);
 await h.send('switchPage',{page:'overview'});await h.native(false);const hidden=h.counts.live;await h.tick(20000);await h.tick(21000);assert.equal(h.counts.live,hidden);
});
test('unchanged full samples do not redraw the overview but still deliver speed',async()=>{
 const h=await runtime();await h.login({...profile,refreshSec:3,refresh:false});const draws=()=>h.calls.filter(c=>c.name==='updateData').length,first=draws();
 await h.tick(10000);await h.tick(20000);assert.equal(draws(),first,'identical device data is not re-rendered');
 assert.equal(h.calls.filter(c=>c.name==='probeResult'&&c.value===true).length,1,'online state is reported once');
 await h.send('refresh',{page:'overview'});assert.equal(draws(),first+1,'manual refresh always redraws');
});

test('cell page gets global samples and stops them when disabled',async()=>{
 const h=await runtime();await h.login({...profile,refreshSec:3});await h.send('switchPage',{page:'neighbor'});const entry=h.counts.sample;await h.tick(2000);assert.equal(h.counts.sample,entry);await h.tick(4000);assert.equal(h.counts.sample,entry+1);await h.send('lanAutoRefresh',{id:profile.id,sec:0});await h.tick(40000);assert.equal(h.counts.sample,entry+1);
});

test('settings page reports the running app version',async()=>{
 const h=await runtime();await h.send('initFlow',{page:'overview'});assert.equal(h.calls.filter(c=>c.name==='setAppVersions').at(-1).value.launcher,'Android LOCAL-36');
});

test('SMS automatic refresh follows its own 10 second interval and native foreground gate',async()=>{
 const h=await runtime();await h.login({...profile,fhLine:'air6',refreshSec:0});await h.send('switchPage',{page:'sms'});
 const polls=()=>h.calls.filter(c=>c.name==='lanAutoRefreshSms').length;
 await h.tick(10999);assert.equal(polls(),0);await h.tick(11000);assert.equal(polls(),1);await h.tick(21000);assert.equal(polls(),2);
 await h.native(false);await h.tick(50000);assert.equal(polls(),2);await h.native(true);assert.equal(h.calls.filter(c=>c.name==='lanResumeSms').length,1);
 await h.send('switchPage',{page:'settings'});await h.tick(61000);assert.equal(polls(),2);
});
test('OTA dialog polling is fresh, stops on background or close, and cannot be postponed by render',async()=>{
 const h=await runtime();await h.login({...profile,fhLine:'air6',refreshSec:0});await h.send('switchPage',{page:'settings'});await h.send('lanOtaWatch',{open:true,busy:true});
 const polls=()=>h.counts.actions.filter(v=>v.action==='air6Ota'&&v.fresh===true).length;
 h.at(2000);await h.send('lanOtaWatch',{open:true,busy:true});await h.tick(3000);assert.equal(polls(),1);
 await h.native(false);await h.tick(10000);assert.equal(polls(),1);await h.native(true);assert.equal(polls(),2);
 await h.send('lanOtaWatch',{open:false});await h.tick(15000);assert.equal(polls(),2);
});
test('offline OTA request releases the UI pending state',async()=>{
 const h=await runtime();await h.send('air6Ota',{kind:'check'});const reply=h.calls.find(c=>c.name==='air6OtaData');assert.equal(reply.value.ok,false);assert.equal(reply.value.kind,'check');
});

test('backgrounding during a heartbeat prevents the remainder of that polling cycle',async()=>{
 const h=await runtime();await h.login({...profile,fhLine:'air6',refreshSec:0});let release;h.behavior.probeGate=new Promise(r=>release=r);const pendingTick=h.tick(22000);await flush();const before={actions:h.counts.actions.length,sample:h.counts.sample,live:h.counts.live};await h.native(false);release();await pendingTick;assert.equal(h.counts.actions.length,before.actions);assert.equal(h.counts.sample,before.sample);assert.equal(h.counts.live,before.live);
});

test('3/5/8 seconds refresh all data on every foreground page with no idle slowdown',async()=>{
 for(const sec of [3,5,8])for(const page of ['overview','neighbor','control','sms','settings']){
  const h=await runtime();await h.login({...profile,fhLine:'air6',refresh:false,refreshSec:sec});await h.send('switchPage',{page});
  for(let i=1;i<=15;i++){const due=1000+i*sec*1000,before=h.counts.sample;await h.tick(due-1);assert.equal(h.counts.sample,before);await h.tick(due);assert.equal(h.counts.sample,before+1);}
  assert.equal(h.calls.filter(c=>c.name==='lanGlobalRefresh').length,15);assert.equal(h.counts.actions.filter(a=>a.action==='air6ReadControlSummary').length,16);
  await h.native(false);const before=h.counts.sample;await h.tick(200000);assert.equal(h.counts.sample,before);
 }
});

test('slow reads skip overlapping periods and resume on the fixed cadence',async()=>{
 const h=await runtime();await h.login({...profile,refresh:false,refreshSec:3});let release;h.behavior.sampleGate=new Promise(r=>release=r);const job=h.tick(4000);await flush();await h.tick(7000);assert.equal(h.counts.sample,2);h.at(8500);release();await job;h.behavior.sampleGate=null;await h.tick(9999);assert.equal(h.counts.sample,2);await h.tick(10000);assert.equal(h.counts.sample,3);
});

test('Air6 live speed runs every second on all foreground pages independently of global samples',async()=>{
 const h=await runtime();await h.login({...profile,fhLine:'air6',refreshSec:5});await h.send('switchPage',{page:'settings'});
 await h.tick(2000);await h.tick(3000);await h.tick(4000);await h.tick(5000);assert.equal(h.counts.live,4);
 let release;h.behavior.sampleGate=new Promise(r=>release=r);const job=h.tick(6000);await flush();assert.equal(h.counts.sample,2);await h.tick(7000);await h.tick(8000);assert.equal(h.counts.live,7,'speed is not held behind the slow full sample');release();await job;h.behavior.sampleGate=null;
 await h.native(false);const before=h.counts.live;await h.tick(9000);assert.equal(h.counts.live,before);
});

test('a sub-period read started after its deadline does not discard the next tick',async()=>{
 const h=await runtime();await h.login({...profile,refresh:false,refreshSec:3});let release;h.behavior.sampleGate=new Promise(r=>release=r);
 const job=h.tick(4800);await flush();h.at(7500);release();await job;h.behavior.sampleGate=null;await h.tick(7800);assert.equal(h.counts.sample,3,'2.7-second request must not turn 3-second polling into 6 seconds');
});

test('a sub-second speed request started late does not become a two-second poll',async()=>{
 const h=await runtime();await h.login({...profile,fhLine:'air6',refreshSec:0});let release;h.behavior.gate=new Promise(r=>release=r);const job=h.tick(2800);await flush();h.at(3200);release();await job;h.behavior.gate=null;await h.tick(3800);assert.equal(h.counts.live,2);
});
