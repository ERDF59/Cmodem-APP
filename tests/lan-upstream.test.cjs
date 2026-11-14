const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const acorn=require('../tools/node_modules/acorn'),walk=require('../tools/node_modules/acorn-walk'),{generate}=require('../tools/node_modules/astring');
const P=require('../app/src/main/assets/lan_api.js'),U=require('../app/src/main/assets/upstream_local.js');
const assets=path.resolve(__dirname,'../app/src/main/assets');
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
// Public half of the upstream protocol key; no private key fixture is needed.
const protocolSource=fs.readFileSync(path.join(assets,'upstream_local.js'),'utf8');
const protocolModulus=/var _0x24e1aa = 0x([0-9a-f]+)n;/.exec(protocolSource)[1];
const protocolPublicKey=crypto.createPublicKey({key:{kty:'RSA',n:Buffer.from(protocolModulus,'hex').toString('base64url'),e:'AQAB'},format:'jwk'});
function storage(){const map=new Map();return {get:k=>map.get(k)||'',set:(k,v)=>map.set(k,v),remove:k=>map.delete(k)};}
function engine(fetch){return U.create({account:{host:'http://192.168.8.1',name:'TEST'},address:P.address,storage:storage(),fetch,timer:(_,fn)=>queueMicrotask(fn)});}

function encryptedDevice({toolSession=true,publicInfo=true,result=0,heartbeatDelay=0,cachedLogin=false,evalJS=async()=>{}}={}){
  const token='0123456789abcdef0123456789abcdef',trace=[],bodies=[];let loggedIn=false,waits=heartbeatDelay;
  const wifi={
    'DeviceInfo.SerialNumber':'SN-TEST-001','DeviceInfo.Description':'LG6151M',
    'WiFi.SSID.1.SSID':'Main24','WiFi.SSID.5.SSID':'Main5','WiFi.SSID.3.SSID':'Guest24','WiFi.SSID.7.SSID':'Guest5',
    'WiFi.AccessPoint.1.Security.PreSharedKey':'Secret24','WiFi.AccessPoint.5.Security.PreSharedKey':'Secret5',
    'WiFi.AccessPoint.3.Security.PreSharedKey':'GuestSecret24','WiFi.AccessPoint.7.Security.PreSharedKey':'GuestSecret5',
    'WiFi.SSID.1.Enable':'1','WiFi.SSID.5.Enable':'1','WiFi.SSID.3.Enable':'0','WiFi.SSID.7.Enable':'0',
    'WiFi.AccessPoint.1.SSIDAdvertisementEnabled':'1','WiFi.AccessPoint.5.SSIDAdvertisementEnabled':'1',
    'WiFi.WifiBandSteering.Enable':'0','WiFi.X_FH_MultiLinkGroup.1.Enable':'0'
  };
  const seed='ABCDE',handshake={data:'Abc123'+crypto.publicEncrypt({key:protocolPublicKey,padding:crypto.constants.RSA_PKCS1_PADDING},Buffer.from(seed)).toString('base64')};
  const fetch=async(url,opt)=>{
    trace.push(new URL(url).pathname+new URL(url).search.split('&sessionid=')[0]);
    const reply=(status,data)=>({ok:status===200,status,text:async()=>typeof data==='string'?data:JSON.stringify(data)});
    if(opt.method!=='POST')assert.equal(opt.headers.Origin,undefined,'GET Origin causes firmware HTTP 204');
    if(url.includes('get_refresh_sessionid')){
      assert.equal(opt.headers['X-Requested-With'],'XMLHttpRequest');
      return url.includes('/api/')&&!toolSession?reply(404,''):reply(200,{sessionid:token});
    }
    if(url.includes('is_encrypt'))return reply(200,handshake);
    if(url.includes('other_logged'))return reply(200,{});
    if(url.includes('heartbeat'))return reply(200,loggedIn&&waits--<=0?'3':'0');
    if(url.includes('app_get_base_info'))return reply(200,publicInfo?{modelName:'LG6151M',NR_Band:'41',RSSI:'-70'}:{});
    if(opt.method==='POST'){
      const key=P.deriveKey(token,seed),dec=crypto.createDecipheriv('aes-128-cbc',Buffer.from(key),Buffer.from(P.IV));
      const request=JSON.parse(Buffer.concat([dec.update(Buffer.from(opt.body.slice(6),'hex')),dec.final()]).toString());
      bodies.push(request);
      if(url.includes('/sign/')){
        assert.equal(request.dataObj.username,'admin');assert.equal(request.dataObj.password,'TEST_ONLY');
        loggedIn=result===0;return reply(200,{result,user:3});
      }
      if(!loggedIn)return reply(403,'');
      let response={modelName:'LG6151M',NR_Band:'41',RSSI:'-70',brmac:'00:00:00:00:00:00'};
      if(request.ajaxmethod==='get_value_by_xmlnode'&&request.dataObj&&typeof request.dataObj==='object'){
        const values=request.dataObj;response={};
        for(const [key,path]of Object.entries(values))response[key]=wifi[path]??(path==='DeviceInfo.ModelName'?'LG6151M':'');
      }else if(request.ajaxmethod==='set_single_by_xmlnode'){
        wifi[request.dataObj.url]=String(request.dataObj.value);response={success:'true'};
      }else if(request.ajaxmethod==='set_value_by_xmlnode'){
        for(const [key,path]of Object.entries(request.dataObj.url||{}))wifi[path]=String(request.dataObj.value[key]);
        response={success:'true'};
      }
      const enc=crypto.createCipheriv('aes-128-cbc',Buffer.from(key),Buffer.from(P.IV));
      return reply(200,'Abc123'+Buffer.concat([enc.update(JSON.stringify(response)),enc.final()]).toString('hex'));
    }
    return reply(404,'');
  };
  const prefs=storage();if(cachedLogin)prefs.set('UPSTREAM_LOCAL_FH_LOGIN_AT_http://192.168.8.1',String(Date.now()));
  return {api:new P.LanApi({host:'192.168.8.1',name:'TEST',fetch,storage:prefs,evalJS,timer:(_,fn)=>queueMicrotask(fn)}),trace,bodies,wifi,prefs};
}

test('encrypted admin login does not require an unavailable plaintext tool-session endpoint',async()=>{
  const h=encryptedDevice({toolSession:false,publicInfo:false});
  assert.equal((await h.api.login('admin','TEST_ONLY')).result,0);
  assert.equal(h.trace.filter(p=>p.startsWith('/fh_api/sign/DO_WEB_LOGIN')).length,1);
});

test('public base-info is not treated as an authenticated login or allowed to skip DO_WEB_LOGIN',async()=>{
  const h=encryptedDevice();assert.equal((await h.api.login('admin','TEST_ONLY')).result,0);
  assert.equal(h.trace.filter(p=>p.startsWith('/fh_api/sign/DO_WEB_LOGIN')).length,1);
});

test('delayed heartbeat is retried without resubmitting the password',async()=>{
  const h=encryptedDevice({heartbeatDelay:1});assert.equal((await h.api.login('admin','TEST_ONLY')).result,0);
  assert.equal(h.trace.filter(p=>p.startsWith('/fh_api/sign/DO_WEB_LOGIN')).length,1);
});

test('cached login timestamp cannot skip authentication in a new native cookie session',async()=>{
  const h=encryptedDevice({cachedLogin:true});await h.api.login('admin','TEST_ONLY');
  assert.equal(h.trace.filter(p=>p.startsWith('/fh_api/sign/DO_WEB_LOGIN')).length,1);
});

test('persistent zero heartbeat is reported accurately and never marked connected',async()=>{
  const h=encryptedDevice({heartbeatDelay:10});
  await assert.rejects(h.api.login('admin','TEST_ONLY'),error=>error.reason==='session'&&error.message.includes('心跳 0')&&error.diagnostic.stage==='会话验证');
  assert.equal(h.trace.filter(p=>p.startsWith('/fh_api/sign/DO_WEB_LOGIN')).length,1);
});

test('wrong credentials are rejected even if anonymous device info is readable',async()=>{
  const h=encryptedDevice({result:4});await assert.rejects(h.api.login('admin','TEST_ONLY'),{code:'AUTH_REJECTED',reason:'login'});
  assert.equal(h.trace.filter(p=>p.startsWith('/fh_api/sign/DO_WEB_LOGIN')).length,1);
});

test('complete overview is decoded and mapped by the upstream local sampler',async()=>{
  const h=encryptedDevice();await h.api.login('admin','TEST_ONLY');
  const data=await h.api.sample();assert.equal(typeof data,'object');assert.ok('rsrp' in data);assert.ok(h.trace.some(p=>p.includes('FHAPIS')));
});
test('local carrier aggregation toggle writes the upstream local XML path',async()=>{
  const h=encryptedDevice();await h.api.login('admin','TEST_ONLY');await h.api.action({action:'toggleCA',switch:'1'});
  const request=h.bodies.find(body=>body.ajaxmethod==='set_single_by_xmlnode'&&body.dataObj?.url==='X_FH_MobileNetwork.NetworkInfo.CaEnable');
  assert.ok(request);assert.equal(request.dataObj.value,'1');
});

test('sample reads serial number and device description through local XML',async()=>{
  const h=encryptedDevice();await h.api.login('admin','TEST_ONLY');
  const data=await h.api.sample();
  const query=h.bodies.find(body=>body.ajaxmethod==='get_value_by_xmlnode'&&body.dataObj?.serialNumber);
  assert.deepEqual(query.dataObj,{serialNumber:'DeviceInfo.SerialNumber',deviceName:'DeviceInfo.Description'});
  assert.equal(data.deviceSN,'SN-TEST-001');assert.equal(data.deviceName,'LG6151M');
});


test('upstream Wi-Fi view reads 2.4G, 5G, guest, steering and MLO through encrypted local XML',async()=>{
  const calls=[],h=encryptedDevice({evalJS:async code=>calls.push(code)});
  assert.equal(h.api.engine.storageKeys.wifi,'UPSTREAM_LOCAL_WIFI_CACHE');
  await h.api.login('admin','TEST_ONLY');await h.api.action({action:'wifiLoad'});
  const result=calls.find(code=>code.includes('window.wifiData && window.wifiData('));assert.ok(result);
  const data=JSON.parse(result.slice(result.indexOf('window.wifiData && window.wifiData(')+'window.wifiData && window.wifiData('.length).split(');')[0]);
  assert.equal(data.ok,true);assert.equal(data.main.ssid2g.ssid,'Main24');assert.equal(data.main.ssid5g.ssid,'Main5');
  assert.equal(data.guest.ssid2g.ssid,'Guest24');assert.equal(data.guest.ssid5g.ssid,'Guest5');
  assert.equal(data.main.sta,false);assert.equal(data.main.mlo,false);
  assert.ok(h.prefs.get(h.api.engine.storageKeys.wifi),'Wi-Fi PSKs are cached under Android Keystore encrypted profile keys');
  assert.ok(h.bodies.some(body=>body.ajaxmethod==='get_value_by_xmlnode'));
  assert.ok(!JSON.stringify(h.bodies).match(/GET_WIFI_LIST_INFO|home\.mifon/i));
});

test('upstream Wi-Fi edits write by encrypted LAN XML and verify local readback',async()=>{
  const calls=[],h=encryptedDevice({evalJS:async code=>calls.push(code)});
  await h.api.login('admin','TEST_ONLY');
  await h.api.action({action:'wifiSetMain',patch:{ssid2g:{ssid:'NewMain24',pwd:'NewSecret24'}}});
  assert.equal(h.wifi['WiFi.SSID.1.SSID'],'NewMain24');assert.equal(h.wifi['WiFi.AccessPoint.1.Security.PreSharedKey'],'NewSecret24');
  const saved=calls.find(code=>code.includes('window.wifiSetResult && window.wifiSetResult('));assert.ok(saved);assert.match(saved,/ok:\s*true/);
  await h.api.action({action:'wifiSetGuest',band:'5g',patch:{ssid:'Guest5New',enable:true}});
  assert.equal(h.wifi['WiFi.SSID.7.SSID'],'Guest5New');assert.equal(h.wifi['WiFi.SSID.7.Enable'],'1');
  assert.ok(!JSON.stringify(h.bodies).match(/GET_WIFI_LIST_INFO|SET_WIFI_INFO_LIST|GET_GUEST_WIFI_LIST_INFO/i));
  assert.ok(h.bodies.some(body=>body.ajaxmethod==='set_value_by_xmlnode'||body.ajaxmethod==='set_single_by_xmlnode'));
});

test('local timed-reboot writes use the local XML method; cloud reboot command is pruned',()=>{
  const source=fs.readFileSync(path.join(assets,'upstream_local.js'),'utf8');
  assert.match(source,/DeviceInfo\.TimedReboot\.1\.enable/);
  assert.match(source,/setRebootInfo/);
  assert.doesNotMatch(source,/SET_HG_REBOOT_INFO|RP_HG_REBOOT|home\.mifon\.com/);
});

test('upstream personalization restores on startup without any device/network access',async()=>{
  const prefs=storage(),calls=[];
  const options={account:{host:'192.168.8.1'},address:P.address,storage:prefs,fetch:()=>{throw Error('Preferences must be offline');},evalJS:async js=>calls.push(js)};
  const first=U.create(options);await first.action({action:'setHomeCards',key:'header',value:'pro'});await first.action({action:'setUiPrefs',key:'diag',value:1});
  calls.length=0;await U.create(options).initialize();
  assert.ok(calls.some(js=>js.includes('homeCardsResult')&&js.includes('"header":"pro"')));
  assert.ok(calls.some(js=>js.includes('uiPrefsResult')&&js.includes('"diag":1')));
});

test('all shipped upstream declarations match the reproducible local specialization manifest',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../docs/upstream-local-manifest.json'),'utf8'));
  const source=fs.readFileSync(path.join(assets,'upstream_local.js'),'utf8'),ast=acorn.parse(source,{ecmaVersion:'latest'});
  assert.equal(hash(source),manifest.artifactSha256);assert.ok(manifest.declarations.length>=220);
  let body;walk.simple(ast,{FunctionExpression(n){if(n.body.body.some(s=>s.type==='FunctionDeclaration'&&s.id.name==='_0x58da7d'))body=n.body;}});
  assert.ok(body);const found=new Map();
  for(const n of body.body){if(n.type==='FunctionDeclaration')found.set(n.id.name,n);if(n.type==='VariableDeclaration')for(const d of n.declarations)found.set(d.id.name,{...n,declarations:[d]});}
  for(const item of manifest.declarations){assert.ok(found.has(item.name));assert.equal(hash(generate(found.get(item.name))),item.sha256,item.name);}
});

test('upstream retains six local profiles, including the non-probed plain fallback',()=>{
  const profiles=engine(()=>{throw Error('unexpected IO');}).profiles;
  assert.deepEqual(profiles.map(p=>p.id),['fh_api_tmp','api_tmp','api_tmp_plain','fh_api_tool','fh_api_direct','root_tmp']);
  assert.equal(profiles[2].probe,false);
  for(const p of profiles){assert.ok(p.sid.startsWith('/'));assert.ok(p.dataObj.startsWith('/'));assert.ok(!/https?:/.test(JSON.stringify(p)));}
});

test('upstream automatic detection selects each probe-enabled local route without remote IO',async()=>{
  const profiles=engine(()=>{}).profiles,token='0123456789abcdef0123456789abcdef';
  for(const target of profiles.filter(p=>p.probe!==false)){
    const requests=[],reply=(status,data)=>({ok:status===200,status,text:async()=>typeof data==='string'?data:JSON.stringify(data)});
    const api=new P.LanApi({host:'192.168.8.1',name:'TEST',timer:(_,fn)=>queueMicrotask(fn),fetch:async url=>{
      assert.ok(url.startsWith('http://192.168.8.1/'));const p=new URL(url);requests.push(p.pathname+p.search);
      if(p.pathname+p.search===target.sid)return reply(200,{sessionid:token});
      return reply(404,'');
    }});
    assert.equal((await api.engine.line()).id,target.id,target.id);
    assert.ok(requests.includes(target.sid));
  }
});

test('tool-route rejection without remaincount is not misreported as rate limiting',async()=>{
  const token='0123456789abcdef0123456789abcdef',reply=(status,data)=>({ok:status===200,status,text:async()=>typeof data==='string'?data:JSON.stringify(data)});
  const create=loginReply=>new P.LanApi({host:'192.168.8.1',name:'TEST',timer:(_,fn)=>queueMicrotask(fn),fetch:async(url,opt)=>{
    const parsed=new URL(url),path=parsed.pathname+parsed.search;
    if(path==='/fh_api/tmp/FHTOOLAPIS?ajaxmethod=get_refresh_sessionid')return reply(200,{sessionid:token});
    if(opt.method==='POST'&&parsed.pathname==='/fh_api/tmp/FHTOOLAPIS')return reply(200,loginReply);
    return reply(404,'');
  }});
  await assert.rejects(create({result:4}).login('admin','WRONG_TEST_ONLY'),error=>error.reason==='login'&&!/次数受限/.test(error.message));
  await assert.rejects(create({result:4,remaincount:0}).login('admin','WRONG_TEST_ONLY'),error=>error.reason==='limited'&&/次数受限/.test(error.message));
});

test('upstream encrypted packets and response decoding match independent AES vectors',()=>{
  const instance=engine(()=>{}),token='0123456789abcdef0123456789abcdef',seed='ABCDE';
  const request={ajaxmethod:'get_value_by_xmlnode',dataObj:{ModelName:'DeviceInfo.ModelName'},sessionid:token};
  const packet=instance.codec.pack(request,token,seed),cipher=crypto.createCipheriv('aes-128-cbc',Buffer.from(packet.key),Buffer.from(P.IV));
  const expected=Buffer.concat([cipher.update(JSON.stringify(request)),cipher.final()]).toString('hex');
  assert.equal(packet.body.slice(6),expected);
  assert.deepEqual(instance.codec.unpack(packet.body,packet.key),request);
});

test('upstream plaintext webpage mode sends structured JSON rather than derived-key ciphertext',async()=>{
  const sent=[],token='0123456789abcdef0123456789abcdef';
  const api=new P.LanApi({host:'192.168.8.1',name:'TEST',fhLine:'pro',timer:(_,fn)=>queueMicrotask(fn),fetch:async(url,opt)=>{
    const reply=data=>({ok:true,status:200,text:async()=>JSON.stringify(data)});
    if(url.includes('app_get_base_info'))return reply({modelName:'LG6151M'}); // not a session16 model
    if(url.includes('get_refresh_sessionid'))return reply({sessionid:token});
    if(opt.method==='POST'){const req=JSON.parse(opt.body);sent.push(req);return reply({ModelName:'LG6151M'});}
    throw Error('Unexpected local path');
  }});
  const result=await api.post('get_value_by_xmlnode',{ModelName:'DeviceInfo.ModelName'});
  assert.equal(result.ModelName,'LG6151M');assert.equal(sent[0].ajaxmethod,'get_value_by_xmlnode');assert.equal(sent[0].sessionid,token);
});

test('upstream session16 webpage mode uses the original first-16 session key and IV',async()=>{
  const token='0123456789abcdef0123456789abcdef',iv='pqrstuvwxyz{|}~'+String.fromCharCode(127);let verified=false;
  const api=new P.LanApi({host:'192.168.8.1',name:'TEST',fhLine:'pro',timer:(_,fn)=>queueMicrotask(fn),fetch:async(url,opt)=>{
    const reply=data=>({ok:true,status:200,text:async()=>typeof data==='string'?data:JSON.stringify(data)});
    if(url.includes('app_get_base_info'))return reply({modelName:'LG6121H'});
    if(url.includes('get_refresh_sessionid'))return reply({sessionid:token});
    if(opt.method==='POST'){
      const dec=crypto.createDecipheriv('aes-128-cbc',Buffer.from(token.slice(0,16)),Buffer.from(iv));
      const request=JSON.parse(Buffer.concat([dec.update(Buffer.from(opt.body,'hex')),dec.final()]).toString());
      assert.equal(request.ajaxmethod,'get_value_by_xmlnode');verified=true;
      const enc=crypto.createCipheriv('aes-128-cbc',Buffer.from(token.slice(0,16)),Buffer.from(iv));
      return reply(Buffer.concat([enc.update(JSON.stringify({ModelName:'LG6121H'})),enc.final()]).toString('hex'));
    }
    throw Error('Unexpected local path');
  }});
  assert.equal((await api.post('get_value_by_xmlnode',{ModelName:'DeviceInfo.ModelName'})).ModelName,'LG6121H');assert.equal(verified,true);
});

test('shipped assets contain no remote-account/activation endpoints or runtime-download hooks',()=>{
  for(const name of fs.readdirSync(assets).filter(n=>/\.(js|html)$/.test(n))){
    const source=fs.readFileSync(path.join(assets,name),'utf8');
    assert.ok(!/home\.mifon\.com|invokeService|userLogin|activateWithCode|submitActivateCode|激活码|SYMMETRIC_KEY|fetchCloudPayload|shell_runtime\.enc|raw\.githubusercontent\.com/.test(source),name);
  }
  const html=fs.readFileSync(path.join(assets,'fhcpeweb.html'),'utf8');
  assert.ok(!/id=["'](?:accountConfigModal|acActivateModal)["']/.test(html));
  assert.ok(fs.readFileSync(path.join(assets,'core.html'),'utf8').indexOf('upstream_local.js')<fs.readFileSync(path.join(assets,'core.html'),'utf8').indexOf('lan_api.js'));
  const tree=require('../tools/node_modules/parse5').parse(html);let scripts='';(function visit(n){if(n.tagName==='script')scripts+=(n.childNodes||[]).map(c=>c.value||'').join('\\n');(n.childNodes||[]).forEach(visit);})(tree);
  assert.ok(!/submitActivateCode|openActivateModal|saveAccountConfig|setLineMode|selectDevice/.test(scripts),'remote account/configuration writes are pruned');
  assert.ok(scripts.includes('wifiSubmitMain')&&scripts.includes('wifiSubmitGuest'),'upstream Wi-Fi editors are present');
});


test('disabled reconnect blocks internal tool authentication after expiry but explicit login still works',async()=>{
  const token='0123456789abcdef0123456789abcdef';let expired=false,logins=0;
  const reply=data=>({ok:true,status:200,text:async()=>JSON.stringify(data)});
  const api=new P.LanApi({host:'192.168.8.1',timer:(_,fn)=>queueMicrotask(fn),fetch:async(url,opt)=>{
    const p=new URL(url);if(p.pathname!=='/fh_api/tmp/FHTOOLAPIS')return {ok:false,status:404,text:async()=>''};
    if(p.searchParams.get('ajaxmethod')==='get_refresh_sessionid')return reply({sessionid:token});
    if(opt.method==='POST'){const body=JSON.parse(opt.body);if(body.ajaxmethod==='app_do_login'){logins++;expired=false;return reply({result:0});}if(body.ajaxmethod==='app_get_login_status')return reply({login_status:expired?0:1});}
    if(p.searchParams.get('ajaxmethod')==='app_get_base_info')return reply(expired?{}:{modelName:'TEST',NR_Band:'41',RSSI:'-80'});
    return reply({});
  }});
  await api.login('admin','TEST');assert.equal(logins,1);api.setReconnect(false);expired=true;
  const now=Date.now;Date.now=()=>now()+600000;
  try{await api.sample().catch(()=>{});await api.probe().catch(()=>{});}finally{Date.now=now;}
  assert.equal(logins,1,'internal tool fallback must not post the password');
  await api.login('admin','TEST');assert.equal(logins,2,'manual login remains available');
});

test('header network label: NSA before SA, 5GA only from NR carrier aggregation (3CC, or 2CC >= 200 MHz)',()=>{
 const m=engine(()=>{}).codec.networkMode,nr=(...mhz)=>mhz.map(v=>({band:'N41',bandwidth:v+'MHz'}));
 assert.equal(m('NR-NSA',[]),'5G NSA');assert.equal(m('NSA',[]),'5G NSA');assert.equal(m('NR-SA',[]),'5G SA');assert.equal(m('SA',[]),'5G SA');assert.equal(m('LTE',[]),'4G');
 // A count without carrier data (the old upstream signature) never yields 5GA.
 assert.equal(m('NR-SA',4),'5G SA');
 assert.equal(m('NR-SA',nr(100,100)),'5GA','2CC with 200 MHz');
 assert.equal(m('NR-SA',nr(100,60)),'5G SA','2CC below 200 MHz');
 assert.equal(m('NR-SA',nr(100,30,60)),'5GA','3CC regardless of width');
 assert.equal(m('NR-NSA',[{band:'B3',bandwidth:'20MHz'},...nr(100,100)]),'5GA','NR carriers under NSA');
 assert.equal(m('NR-NSA',[{band:'B3',bandwidth:'20MHz'},{band:'B1',bandwidth:'20MHz'},...nr(100)]),'5G NSA','LTE anchors never count');
 assert.equal(m('LTE',nr(100,100,100)),'4G','5GA requires a 5G registration');
 assert.equal(m('NR-SA',[{band:'N41',bandwidth:'100MHz'},{band:'N78',bandwidth:'--'}]),'5G SA','unknown bandwidth never satisfies 2CC');
 assert.equal(m('NR-SA',[{band:'N41',bandwidth:'DL 100MHz / UL 100MHz'},{band:'N78',bandwidth:'100MHz'}]),'5GA','PCC label carries DL/UL');
 // Unreported mode is unknown, not 5G SA.
 assert.equal(m('',[]),'--');assert.equal(m(undefined,nr(100,100,100)),'--');
});
test('FiberHome build: unreported WorkMode no longer defaults to SA or is guessed from the band number',()=>{
 const source=fs.readFileSync(path.join(assets,'upstream_local.js'),'utf8');
 assert.ok(!/'WorkMode':[^,\n]*\|\|\s*'SA'/.test(source),'no SA default');
 assert.ok(!/WorkMode[^\n]*<\s*0x28\s*\?\s*'LTE'/.test(source),'no band-number guess');
 assert.ok(!/_0x64e5ff\([^)]*\["length"\]\)/.test(source),'mode label receives the carrier list');
});


test('device addresses accept http/https, IPv4/IPv6 literals and DNS names, nothing else',()=>{
 for(const [input,expected] of [
  ['192.168.1.1','http://192.168.1.1'],['http://192.168.1.1/cgi-bin/luci/','http://192.168.1.1'],['100.127.255.255:8080/cgi-bin/luci','http://100.127.255.255:8080'],
  ['8.8.8.8','http://8.8.8.8'],['2409:8a00:0:0::0001','http://[2409:8a00::1]'],['[2409:8A00::1]:8443','http://[2409:8a00::1]:8443'],['fd00::1','http://[fd00::1]'],
  ['air6.erdf123.xyz','http://air6.erdf123.xyz'],['https://air6.erdf123.xyz','https://air6.erdf123.xyz'],['HTTPS://Air6.ERDF123.xyz:443/cgi-bin/luci/','https://air6.erdf123.xyz'],
  ['http://192.168.1.1/cgi-bin/luci/admin/modem/cmodem','http://192.168.1.1'],['https://例子.公司/cgi-bin/luci/admin/status/overview','https://xn--fsqu00a.xn--55qx5d'],
  ['https://air6.erdf123.xyz:8443','https://air6.erdf123.xyz:8443'],['http://air6.erdf123.xyz:80','http://air6.erdf123.xyz'],['air6.erdf123.xyz.','http://air6.erdf123.xyz'],
  ['https://192.168.1.1','https://192.168.1.1'],['https://[2409:8a00::1]:8443/','https://[2409:8a00::1]:8443'],['xn--fiqs8s.xn--55qx5d','http://xn--fiqs8s.xn--55qx5d']
 ])assert.equal(P.address(input),expected,input);
 for(const input of ['','localhost','foo.localhost','router','1.2.3','a..b.com','-bad.com','exa_mple.com','ftp://a.com','https://u:p@a.com','http://1.2.3.4@8.8.8.8/',
  'a.com/path','a.com?x=1','https://a.com/cgi-bin/luci?next=1','1.2.3.4/other','1.2.3.999','1.2.3.4:0','a.com:65536',
  '127.0.0.1','0.0.0.0','0.1.2.3','169.254.1.1','224.0.0.1','255.255.255.255','::1','::','fe80::1','[fe80::1]:80','ff02::1','::ffff:192.168.1.1','2409::1%wlan0','2409:::1'])assert.throws(()=>P.address(input),input);
 assert.match((()=>{try{P.address('ftp://a.com');}catch(e){return e.message;}})(),/https/);
});
test('tunnel and reverse-proxy gateway errors are temporary network errors, not login failures',async()=>{
 const core=fs.readFileSync(path.join(assets,'core.html'),'utf8');
 const script=core.slice(core.indexOf('<script>')+8,core.indexOf('</script>'));
 let status=530;const c={setTimeout,clearTimeout,JSON,Error,Object,Map,Promise,AndroidCore:{fetch:(id)=>setImmediate(()=>c.__fetchText(id,status,'error code: 1033'))}};c.window=c;
 require('node:vm').createContext(c);require('node:vm').runInContext(script,c);
 for(status of [530,502,503,504,522,524])await assert.rejects(c.__nfetch('u',{}),e=>e.code==='NETWORK'&&/隧道或代理/.test(e.message)&&e.message.includes(String(status)),String(status));
 status=404;const r=await c.__nfetch('u',{});assert.equal(r.status,404);
});
test('native transport failures surface as readable network errors',async()=>{
 const core=fs.readFileSync(path.join(assets,'core.html'),'utf8');
 const script=core.slice(core.indexOf('<script>')+8,core.indexOf('</script>'));
 const replies={},c={setTimeout,clearTimeout,JSON,Error,Object,Map,Promise,AndroidCore:{fetch:(id,url)=>setImmediate(()=>c.__fetchText(id,0,replies[url]||''))}};c.window=c;
 require('node:vm').createContext(c);require('node:vm').runInContext(script,c);
 for(const [code,text] of [['DNS_FAILED',/域名无法解析/],['TLS_CERT_FAILED',/证书/],['TLS_FAILED',/HTTPS/]]){replies['u'+code]=code;
  await assert.rejects(c.__nfetch('u'+code,{}),e=>e.code==='NETWORK'&&text.test(e.message),code);}
 const plain=await c.__nfetch('none',{});assert.equal(plain.status,0);assert.equal(plain.ok,false);
});
