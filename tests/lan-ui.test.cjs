const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const html=require('../tools/node_modules/parse5'),acorn=require('../tools/node_modules/acorn'),{generate}=require('../tools/node_modules/astring');
const walk=require('../tools/node_modules/acorn-walk');
const assets=path.resolve(__dirname,'../app/src/main/assets');
function page(file){const tree=html.parse(fs.readFileSync(file,'utf8'));let scripts='',modal;function walk(n){if(n.attrs?.some(a=>a.name==='id'&&a.value==='localLoginModal'))modal=n;if(n.tagName==='script')scripts+=n.childNodes.map(n=>n.value||'').join('')+'\n';(n.childNodes||[]).forEach(walk);}walk(tree);return {tree,scripts,modal,functions:new Map(acorn.parse(scripts,{ecmaVersion:'latest'}).body.filter(n=>n.type==='FunctionDeclaration').map(n=>[n.id.name,n]))};}
const shipped=page(path.join(assets,'fhcpeweb.html')),original=page(path.resolve(__dirname,'../tools/.upstream-cache/upstream.html'));
const localFunctions=['_esc','openLocalLoginModal','closeLocalLoginModal','localAcctLabel','renderLocalAccounts','toggleLocalAcctList','selectLocalAccount','deleteLocalAccountAt','_saveLocalAccountCore','loginLocalAccount','testLocalConnection'];
const localWifiFunctions=['openWifiModal','closeWifiModal','reloadWifi','wifiSubmitMain','wifiSubmitGuest','wifiToggleMain','wifiToggleMainBand','wifiToggleGuest'];
test('local login DOM and all local login handlers are imported unchanged from upstream',()=>{
  assert.equal(html.serializeOuter(shipped.modal),html.serializeOuter(original.modal));
  for(const name of localFunctions)assert.equal(generate(shipped.functions.get(name)),generate(original.functions.get(name)),name);
});
test('Wi-Fi settings DOM and editing handlers are restored unchanged from upstream',()=>{
  const find=(tree,id)=>{let found;function visit(n){if(n.attrs?.some(a=>a.name==='id'&&a.value===id))found=n;(n.childNodes||[]).forEach(visit);}visit(tree);return found;};
  for(const id of ['wifiSettingRow','wifiModal','wifiModalBody','wifiInputDialog'])assert.equal(html.serializeOuter(find(shipped.tree,id)),html.serializeOuter(find(original.tree,id)),id);
  for(const name of localWifiFunctions)assert.equal(generate(shipped.functions.get(name)),generate(original.functions.get(name)),name);
});
test('entire dashboard is the reproducible upstream UI artifact, not the old skin',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../docs/upstream-ui-manifest.json'),'utf8'));
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(assets,'fhcpeweb.html'))).digest('hex'),manifest.artifactSha256);
  for(const id of ['localLoginModal','wifiSettingRow','wifiModal','atModal','csSheetCard','devSwitchOverlay'])assert.ok(fs.readFileSync(path.join(assets,'fhcpeweb.html'),'utf8').includes('id="'+id+'"'),id);
});
test('every static UI action has a local runtime, UI adapter or upstream handler',()=>{
  const actions=new Set();walk.simple(acorn.parse(shipped.scripts,{ecmaVersion:'latest'}),{CallExpression(n){if(n.callee.name==='sendToScriptable'&&n.arguments[0]?.type==='Literal')actions.add(n.arguments[0].value);}});
  const implementation=['upstream_local.js','lan_runtime.js','lan_ui.js'].map(n=>fs.readFileSync(path.join(assets,n),'utf8')).join('\n');
  for(const action of actions)assert.ok(implementation.includes("'"+action+"'")||implementation.includes('"'+action+'"'),action);
  assert.ok(!fs.existsSync(path.join(assets,'lan_queries.json')));assert.ok(!fs.existsSync(path.join(assets,'lan_model.js')));
});
test('remote-only reboot/account writes do not appear as live UI actions',()=>{
  const blocked=new Set(['setLineMode','selectDevice','saveAccountConfig','activateWithCode']);
  const actions=new Set();walk.simple(acorn.parse(shipped.scripts,{ecmaVersion:'latest'}),{CallExpression(n){if(n.callee.name==='sendToScriptable'&&n.arguments[0]?.type==='Literal')actions.add(n.arguments[0].value);}});
  for(const action of blocked)assert.ok(!actions.has(action),action);
});
function view(){
  const nodes=new Map(),sent=[],wifiResults=[];
  function element(){const classes=new Set();return {style:{},dataset:{},childNodes:[],scrollTop:0,value:'',disabled:false,textContent:'',innerHTML:'',checked:true,parentNode:{appendChild:n=>nodes.set(n.id,n)},classList:{contains:c=>classes.has(c),add:c=>classes.add(c),remove:c=>classes.delete(c)},querySelector:()=>null,querySelectorAll:()=>[],appendChild(n){this.childNodes.push(n);nodes.set(n.id,n);},insertBefore(n){this.appendChild(n);},replaceChildren(...children){this.childNodes=children;},addEventListener(name,fn){this['on'+name]=fn;},click(){}};}
  const documentElement=element(),body=element(),frames=[];
  const doc={head:element(),body,createElement:()=>element(),activeElement:null,visibilityState:'visible',addEventListener(){},getElementById:id=>{if(['smsListContainer','localNewProfileBtn','localSaveProfileBtn'].includes(id))return nodes.get(id)||null;if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);}};
  const c={document:doc,console,setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:callback=>{frames.push(callback);return frames.length;},activePageId:'overview',scrollY:0,showPage:page=>c.activePageId=page,scrollTo:(_,y)=>c.scrollY=y,_localAccounts:[],_localActiveIndex:0,_localSaveSilent:false,_wifiLoadCache(){return null;},_wifiSaveCache(){},wifiSetResult:value=>{wifiResults.push(value);if(value?.ok&&value.phase==='done')c.reloadWifi();},reloadWifi:()=>c.sendToScriptable('wifiLoad'),_mAdd(){},_mDel(){},showUpdateToast(){},renderLocalSwitchList(){},closeDevSwitchModal(){},_spStop(){},_ppStop(){},_spStart(){},_ppStart(){},_spArm(){},_ppArm(){},_probeNet(){},AndroidBoard:{postMessage:raw=>sent.push(JSON.parse(raw))}};c.window=c;doc.documentElement=documentElement;vm.createContext(c);
  vm.runInContext(localFunctions.map(n=>generate(shipped.functions.get(n))).join('\n'),c);
  c.URL=URL;vm.runInContext(fs.readFileSync(path.join(assets,'device_address.js'),'utf8'),c);
  vm.runInContext(fs.readFileSync(path.join(assets,'lan_ui.js'),'utf8'),c);return {c,nodes,sent,wifiResults,frames};
}
test('late account synchronization cannot erase a login error',()=>{
  const {c,nodes}=view();c.lanLoginState({error:true,open:true,message:'HTTP 204 TEST'});c.lineConfigResult({accounts:[{id:'p',host:'192.168.8.1',user:'admin',pass:'TEST_ONLY'}],activeIndex:0});assert.equal(nodes.get('localTestMsg').textContent,'HTTP 204 TEST');
});
test('save acknowledgement never falsely closes the login dialog or reports success',()=>{
  const {c,nodes,sent}=view();c.lanLoginState({open:true});c.localAccountsSaved({ok:true});assert.equal(nodes.get('localLoginModal').classList.contains('active'),true);assert.equal(sent.at(-1).action,'getLineConfig');c.lanLoginState({success:true});assert.equal(nodes.get('localLoginModal').classList.contains('active'),false);
});
test('original login emits save then relogin, and repeated clicks do not resubmit login',()=>{
  const {c,nodes,sent}=view();c.document.getElementById('localHost').value='192.168.8.1';c.document.getElementById('localUser').value='admin';c.document.getElementById('localPass').value='TEST_ONLY';c.loginLocalAccount();c.loginLocalAccount();assert.equal(sent.filter(x=>x.action==='reloginNow').length,1);assert.deepEqual(sent.slice(0,2).map(x=>x.action),['saveLocalAccounts','reloginNow']);
});
test('checkbox options persist without overwriting other credential fields',()=>{
  const {c,nodes,sent}=view();c.lineConfigResult({accounts:[{id:'p',host:'192.168.8.1',user:'admin',pass:'TEST_ONLY'}]});nodes.get('lanRefresh').checked=false;nodes.get('lanRefresh').onchange();assert.deepEqual(sent.at(-1),{action:'lanOptions',id:'p',refresh:false,reconnect:true});
});
test('auto refresh UI restores each profile and sends the selected interval',()=>{
  const {c,nodes,sent}=view();c.lineConfigResult({accounts:[{id:'p',host:'192.168.8.1',user:'admin',pass:'TEST_ONLY',refreshSec:8}],activeIndex:0});
  assert.ok(nodes.has('autoRefreshRow'));assert.equal(nodes.get('autoRefreshVal').textContent,'8 秒');assert.equal(nodes.get('arPillTxt').textContent,'8s');
  nodes.get('arOpt3').onclick();assert.deepEqual(sent.at(-1),{action:'lanAutoRefresh',id:'p',sec:3});assert.equal(c._localAccounts[0].refreshSec,3);
});
test('runtime status is an overview card and the existing online count moves into the old entry',()=>{
  const {c,nodes,sent}=view();c.document.body.dataset.lanDevice='air6';c.__lanAir6Layout(true);c.updateData({deviceOnline:true,deviceName:'Air6',deviceModel:'Air6',cpuUsage:'3',ramUsage:'40',swVersion:'OpenWrt SNAPSHOT',air6Kernel:'6.18.55',modemTemp:'61°',uptimeText:'1d 14h 10m'});
  assert.equal(nodes.get('lanRuntimeCpu').textContent,'3.0%');assert.equal(nodes.get('lanRuntimeRam').textContent,'40.0%');assert.equal(nodes.get('lanRuntimeUptime').textContent,'1d 14h 10m');assert.equal(sent.length,0);
  const css=fs.readFileSync(path.join(assets,'android_ui.css'),'utf8');assert.match(css,/#lanRuntimeUptime\s*\{[^}]*white-space:nowrap/);
  const code=fs.readFileSync(path.join(assets,'lan_ui.js'),'utf8');assert.match(code,/insertAdjacentElement\?\.\('afterend',runtimeCard\)/);assert.match(code,/gaugeCard\?\.parentNode\?\.insertBefore\?\.\(runtimeCard,gaugeCard\)/);assert.match(code,/headerArrow\.replaceChildren\(proDeviceCount\)/);assert.doesNotMatch(code,/lan-runtime-title/);assert.doesNotMatch(code,/openLocalDeviceDetails/);
});

test('each tab restores its own scroll offset; backend showPage on same tab does not jump',()=>{
  const {c}=view();c.scrollY=180;c.showPage('control');assert.equal(c.scrollY,0);
  c.scrollY=420;c.showPage('control');assert.equal(c.scrollY,420);
  c.showPage('overview');assert.equal(c.scrollY,180);
  c.showPage('control');assert.equal(c.scrollY,420);
  c.showPage('settings');assert.equal(c.scrollY,0);
});
test('SMS switch resets its fixed list before display and never inherits document scroll',()=>{
  const {c,nodes,frames}=view(),list=c.document.createElement();nodes.set('smsListContainer',list);list.scrollTop=96;c.scrollY=420;
  c.showPage('sms');
  assert.equal(c.scrollY,420,'document scroll is untouched while the fixed SMS surface is shown');
  assert.equal(c.document.documentElement.scrollTop,0);
  assert.equal(c.document.body.scrollTop,0);
  assert.equal(list.scrollTop,0);
  assert.equal(c.document.documentElement.classList.contains('__sms-transition'),true);
  assert.equal(frames.length,1,'SMS insertion waits for the first paint/layout barrier');
  frames[0]();
  assert.equal(frames.length,2,'SMS removal waits for a second paint/layout barrier');
  frames[1]();
  assert.equal(c.document.documentElement.classList.contains('__sms-transition'),false);
});
test('Android consumes native system/IME insets rather than relying on WebView env values',()=>{
  const native=fs.readFileSync(path.resolve(__dirname,'../app/src/main/java/com/fhcpeboard/android/MainActivity.kt'),'utf8');
  assert.ok(native.includes('setOnApplyWindowInsetsListener(root)'));assert.ok(native.includes('root.setPadding(bars.left, bars.top, bars.right, bars.bottom)'));
  assert.ok(native.includes('WindowInsetsCompat.Type.ime()'));assert.ok(!native.includes('cssPx(insetTopPx'));
  const runtime=fs.readFileSync(path.join(assets,'lan_runtime.js'),'utf8');assert.ok(runtime.includes("N.assetRead('android_ui.css')"));
});
test('clipped cards allow gesture chaining while the document and modal contain overscroll',()=>{
  const css=fs.readFileSync(path.join(assets,'android_ui.css'),'utf8');
  assert.match(css,/\*\s*\{\s*overscroll-behavior:auto;/);
  assert.match(css,/html\s*\{[^}]*overscroll-behavior:none;/);
  assert.match(css,/\.lock-modal-content,\s*\.diag-list\s*\{\s*overscroll-behavior:contain;/);
  assert.match(css,/#page-control \.row-right > span\s*\{[^}]*white-space:nowrap;/);
});
test('sms page is opaque during tab switches',()=>{
  const css=fs.readFileSync(path.join(assets,'android_ui.css'),'utf8');
  assert.match(css,/#page-sms,\s*body\.has-wallpaper #page-sms\s*\{\s*background:var\(--ios-bg\) !important;/);
  assert.match(css,/html\.__sms-transition body::after\s*\{[^}]*position:fixed;[^}]*inset:0;[^}]*z-index:500;[^}]*pointer-events:none;/);
});
function inboxRefreshView(){
  const hint={style:{display:'none'}},skeleton={style:{display:'none'}},rows=[{textContent:'SYNTHETIC MESSAGE'}],sent=[];
  const list={scrollTop:120,querySelector:selector=>selector==='.sms-row'?rows[0]||null:null};
  let now=1000;
  class Clock extends Date{static now(){return now;}}
  const c={Date:Clock,smsConversations:{convs:[{number:'TEST'}]},smsLoadedAt:1000,smsCacheLoadLock:false,smsListInflight:false,smsLoadingMore:false,smsForceFresh:false,smsDiffing:false,
    document:{getElementById:id=>({smsListHint:hint,smsSkeleton:skeleton,smsListContainer:list})[id]},
    sendToScriptable:action=>sent.push(action),_dotSet(){},showUpdateToast(){}};
  vm.createContext(c);
  vm.runInContext(['smsOnEnter','smsEnterSms','smsLoadList','smsShowSkeleton','smsHideLoading'].map(n=>generate(shipped.functions.get(n))).join('\n'),c);
  return {c,hint,skeleton,rows,list,sent,at:value=>now=value};
}
test('return to an expired inbox refreshes in place without inserting skeleton rows',()=>{
  const h=inboxRefreshView();h.at(32001);h.c.smsOnEnter();
  assert.deepEqual(h.sent,['smsList']);assert.equal(h.c.smsDiffing,true);assert.equal(h.c.smsListInflight,true);
  assert.equal(h.skeleton.style.display,'none');assert.equal(h.rows.length,1);assert.equal(h.list.scrollTop,120);
  h.c.smsOnEnter();assert.equal(h.sent.length,1,'repeated entry cannot start overlapping loads');
});
test('fresh inbox reentry is quiet and manual refresh keeps old messages visible',()=>{
  const h=inboxRefreshView();h.at(21000);h.c.smsOnEnter();assert.equal(h.sent.length,0);
  h.c.smsLoadList();assert.deepEqual(h.sent,['smsList']);assert.equal(h.skeleton.style.display,'none');assert.equal(h.list.scrollTop,120);
});
test('first inbox load still displays a skeleton and requests the device list',()=>{
  const h=inboxRefreshView();h.c.smsConversations=null;h.rows.length=0;h.c.smsOnEnter();
  assert.deepEqual(h.sent,['smsCacheLoad']);assert.equal(h.c.smsCacheLoadLock,true);assert.equal(h.skeleton.style.display,'');
  h.c.smsHideLoading();assert.equal(h.skeleton.style.display,'none');
});
test('network status and chevron are anchored at the row right edge independently of the subtitle',()=>{
  const css=fs.readFileSync(path.join(assets,'android_ui.css'),'utf8');
  assert.match(css,/#page-control #netSettingRow\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(88px,40%\);/);
  assert.match(css,/#page-control #netSettingRow \.row-right\s*\{[^}]*position:static;/);
  assert.match(css,/#page-control #netSettingRow #netSettingText\s*\{[^}]*white-space:normal;[^}]*text-align:right;/);
});
test('rainbow card preset remains visibly multicolor in Android dark mode',()=>{
  const css=fs.readFileSync(path.join(assets,'android_ui.css'),'utf8');
  assert.match(css,/html\[data-theme=dark\] body\.card-header-pro #caRowCard/);
  assert.match(css,/rgba\(var\(--g1rgb,0,199,190\),\.25\)/);
  assert.match(css,/rgba\(var\(--g2rgb,10,132,255\),\.27\)/);
  assert.match(css,/rgba\(var\(--g3rgb,123,97,255\),\.23\)/);
  assert.match(css,/rgba\(var\(--g4rgb,255,159,0\),\.18\)/);
  assert.match(css,/linear-gradient\(145deg,#1a232a,#1a2028 52%,#24212b\)/);
});
test('Air6 rainbow header keeps long carrier names complete on one line by shrinking its CPE image',()=>{
  const css=fs.readFileSync(path.join(assets,'android_ui.css'),'utf8');
  assert.match(css,/body\[data-lan-device=air6\]\.card-header-pro \.hc-img\s*\{[^}]*width:68px!important;[^}]*height:86px!important;[^}]*object-fit:contain;/);
  assert.match(css,/body\[data-lan-device=air6\]\.card-header-pro \.hc-op\s*\{[^}]*max-width:none;[^}]*white-space:nowrap;[^}]*overflow:visible;[^}]*text-overflow:clip;/);
  assert.match(css,/body\[data-lan-device=air6\]\.card-header-pro #hcArrow\s*\{[^}]*background:transparent!important;[^}]*border-radius:0!important;[^}]*box-shadow:none!important/);
});
test('device name is read-only and comes from the CPE data response',()=>{
  const htmlText=fs.readFileSync(path.join(assets,'fhcpeweb.html'),'utf8');
  assert.ok(!htmlText.includes('renameModalOverlay'));
  assert.ok(!htmlText.includes('renameInput'));
  assert.ok(!fs.readFileSync(path.join(assets,'lan_ui.js'),'utf8').includes('renameDevice'));
  assert.ok(!fs.readFileSync(path.join(assets,'lan_runtime.js'),'utf8').includes("case 'renameDevice'"));
  assert.match(htmlText,/document\.getElementById\("setDeviceName"\)\.textContent = e\.deviceName \|\| "--"/);
  assert.match(htmlText,/id="setDeviceName"/);
  assert.doesNotMatch(htmlText,/id="setDeviceName"[^>]*onclick=/);
});
test('local login exposes an explicit new-profile action and CA remains a local action',()=>{
  const ui=fs.readFileSync(path.join(assets,'lan_ui.js'),'utf8');
  assert.match(ui,/localNewProfileBtn/);assert.match(ui,/startNewLocalProfile/);
  const runtime=fs.readFileSync(path.join(assets,'lan_runtime.js'),'utf8');
  assert.match(runtime,/case 'toggleCA'/);
  const htmlText=fs.readFileSync(path.join(assets,'fhcpeweb.html'),'utf8');
  assert.match(htmlText,/id="caSwitch"/);
});
test('new local profile clears fields without overwriting saved profiles',()=>{
  const {c,nodes}=view();c.lineConfigResult({accounts:[{id:'one',host:'192.168.8.1',user:'admin',pass:'KEEP'}],activeIndex:0});
  c.startNewLocalProfile();assert.equal(c._localActiveIndex,-1);assert.equal(nodes.get('localHost').value,'192.168.8.1');assert.equal(nodes.get('localUser').value,'admin');assert.equal(nodes.get('localPass').value,'');
  assert.equal(c._localAccounts.length,1);assert.equal(c._localAccounts[0].pass,'KEEP');
});
test('new profile draft survives a late native configuration callback',()=>{
  const {c,nodes}=view(),accounts=[{id:'one',host:'192.168.8.1',user:'admin',pass:'KEEP'}];
  c.lineConfigResult({accounts,activeIndex:0});nodes.get('localNewProfileBtn').onclick();
  nodes.get('localUser').value='superadmin';nodes.get('localUser').oninput();
  c.lineConfigResult({accounts,activeIndex:0});
  assert.equal(c._localActiveIndex,-1);assert.equal(nodes.get('localUser').value,'superadmin');assert.equal(nodes.get('localPass').value,'');
  assert.equal(nodes.get('localAcctCurrent').textContent,'新增配置（尚未保存）');
});
test('standalone save keeps distinct users on the same gateway and does not log in',()=>{
  const {c,nodes,sent}=view();c.lineConfigResult({accounts:[{id:'one',host:'http://192.168.8.1',user:'admin',pass:'KEEP',autoLogin:false}],activeIndex:0});
  c.startNewLocalProfile();nodes.get('localUser').value='superadmin';nodes.get('localPass').value='NEW';nodes.get('localSaveProfileBtn').onclick();
  const saved=sent.filter(x=>x.action==='saveLocalAccounts');assert.equal(saved.length,1);assert.equal(saved[0].accounts.length,2);assert.equal(saved[0].accounts[0].user,'admin');assert.equal(saved[0].accounts[0].pass,'KEEP');assert.equal(saved[0].activeIndex,1);
  assert.equal(sent.some(x=>x.action==='reloginNow'),false);
  c.localAccountsSaved({ok:true});c.lineConfigResult({accounts:saved[0].accounts.map((a,i)=>({...a,id:i?'two':'one'})),activeIndex:1});
  c.selectLocalAccount(0);assert.equal(nodes.get('localPass').value,'KEEP');
  c.selectLocalAccount(1);assert.equal(nodes.get('localPass').value,'NEW');
});
test('equivalent gateway spelling updates the same profile and invalid address cannot trigger login',()=>{
  const {c,nodes,sent}=view();c.lineConfigResult({accounts:[{id:'one',host:'http://192.168.8.1',user:'admin',pass:'KEEP'}],activeIndex:0});
  nodes.get('localHost').value='192.168.8.1/';nodes.get('localPass').value='';c.saveLocalProfile();assert.equal(c._localAccounts.length,1);
  c.localAccountsSaved({ok:true});nodes.get('localHost').value='https://example.com';c.loginLocalAccount();assert.equal(sent.some(x=>x.action==='reloginNow'),false);
});
test('edited credentials survive a callback even after the input loses focus',()=>{
  const {c,nodes}=view(),accounts=[{id:'one',host:'192.168.8.1',user:'admin',pass:'KEEP'}];c.lineConfigResult({accounts,activeIndex:0});
  nodes.get('localPass').value='EDIT';nodes.get('localPass').oninput();c.document.activeElement=null;c.lineConfigResult({accounts,activeIndex:0});assert.equal(nodes.get('localPass').value,'EDIT');
});

test('manual editor ignores late automatic login states and saves a custom profile name',()=>{
 const {c,nodes,sent}=view();c.lineConfigResult({accounts:[{id:'one',host:'192.168.1.1',user:'root',pass:'OLD'}],activeIndex:0});c.openLocalLoginModal();
 assert.ok(sent.some(x=>x.action==='lanProfileEditing'&&x.open));nodes.get('localPass').value='EDIT';nodes.get('localPass').oninput();nodes.get('localProfileName').value='家里 Air6';
 c.lanLoginState({automatic:true,success:true,busy:true,profiles:[{id:'other',host:'192.168.8.1',username:'admin',password:'OTHER'}],activeId:'other'});
 assert.equal(nodes.get('localPass').value,'EDIT');assert.equal(nodes.get('localLoginModal').classList.contains('active'),true);c.saveLocalProfile();const account=sent.findLast(x=>x.action==='saveLocalAccounts').accounts[0];assert.equal(account.name,'家里 Air6');assert.equal(account.nameCustom,true);
 c.closeLocalLoginModal();assert.equal(sent.at(-1).action,'lanProfileEditing');assert.equal(sent.at(-1).open,false);
});

test('editing credentials after successful login cannot retain stale native credential aliases',()=>{
  const {c,nodes,sent}=view();
  c.lanLoginState({success:true,profiles:[{id:'one',host:'http://192.168.1.1',username:'root',password:'OLD',fhLine:'air6'}],activeId:'one'});
  c.selectLocalAccount(0);nodes.get('localPass').value='NEW';c.saveLocalProfile();
  const saved=sent.findLast(x=>x.action==='saveLocalAccounts').accounts[0];
  assert.equal(saved.user,'root');assert.equal(saved.pass,'NEW');assert.equal(saved.username,undefined);assert.equal(saved.password,undefined);assert.equal(saved.fhLine,'air6');
  c.localAccountsSaved({ok:true});c.lineConfigResult({accounts:[{...saved,username:'root',password:'OLD'}],activeIndex:0});
  nodes.get('localPass').value='NEWER';c.saveLocalProfile();
  const next=sent.findLast(x=>x.action==='saveLocalAccounts').accounts[0];
  assert.equal(next.pass,'NEWER');assert.equal(next.password,undefined);
});
test('CA completion discards deferred old status before applying confirmed state',()=>{
  const {c,nodes}=view();c._caPendingPush='0';c._netOpEnd=()=>{if(c._caPendingPush!==null)nodes.get('caSwitch').checked=c._caPendingPush==='1';};
  c.caLocalResult({ok:true,value:'1'});assert.equal(nodes.get('caSwitch').checked,true);assert.equal(c._caPendingPush,null);
});
test('successful device switching clears the previous CPE Wi-Fi and SMS memory',()=>{
  const {c}=view();Object.assign(c,{__lanWifiScope:'http://192.168.8.1|admin',wifiPending:{},wifiEditing:{},wifiState:{ok:true},
    smsConversations:{convs:[{}]},smsLoadedAt:1000,smsChat:{},smsListEdit:true,smsSelected:{one:true},smsChatSelected:{one:true},
    smsPendingRecv:[{}],smsPendingSend:[{}],smsDetailsAcc:{recv:[{}],send:[{}]},smsCurBatchRecv:[{}],smsCurBatchSend:[{}],smsDeletedIdx:{recv:{one:true},send:{}},
    smsLoadingMore:true,smsDiffing:true,smsCacheLoadLock:true,smsForceFresh:true,smsListInflight:true,smsLoadEndAt:1000,
    smsCurRetry:2,smsLostCount:3,smsBatchDone:3,smsRenderLimit:30,smsRowsAnimated:true,smsRenderScrollT:1,
    _wifiSummaryReset:()=>c.wifiState=null,closeWifiModal(){},smsClearRetry(){},closeSmsChat(){},closeSmsCompose(){}});
  c.lanLoginState({success:true,profiles:[{id:'new',host:'http://192.168.9.1',username:'admin'}],activeId:'new'});
  assert.equal(c.__lanWifiScope,'http://192.168.9.1|admin');assert.equal(c.wifiState,null);assert.equal(c.wifiPending,null);assert.equal(c.smsConversations,null);assert.equal(c.smsLoadedAt,0);assert.equal(c.smsListInflight,false);assert.equal(c.smsDetailsAcc.recv.length,0);
  c.smsConversations={convs:[{}]};c.lanLoginState({success:true,profiles:[{id:'new',host:'http://192.168.9.1',username:'admin'}],activeId:'new'});assert.equal(c.smsConversations.convs.length,1,'same-device relogin keeps the rendered inbox');
});
test('clear-cache callback resets in-memory SMS and Wi-Fi state',()=>{
  const {c,nodes}=view(),list=c.document.createElement(),badge=c.document.createElement();nodes.set('smsListContainer',list);nodes.set('smsBadge',badge);
  Object.assign(c,{wifiPending:{},wifiEditing:{},wifiState:{ok:true},smsConversations:{convs:[{}]},smsLoadedAt:1000,smsChat:{},smsListEdit:true,smsSelected:{one:true},smsChatSelected:{one:true},smsPendingRecv:[{}],smsPendingSend:[{}],smsDetailsAcc:{recv:[{}],send:[{}]},smsCurBatchRecv:[{}],smsCurBatchSend:[{}],smsDeletedIdx:{recv:{one:true},send:{}},smsLoadingMore:true,smsDiffing:true,smsCacheLoadLock:true,smsForceFresh:true,smsListInflight:true,smsLoadEndAt:1000,smsCurRetry:2,smsLostCount:3,smsBatchDone:3,smsRenderLimit:30,smsRowsAnimated:true,smsRenderScrollT:1,_wifiSummaryReset:()=>c.wifiState=null,closeWifiModal(){},smsClearRetry(){},closeSmsChat(){},closeSmsCompose(){}});
  c.localCacheCleared({ok:true,count:4});assert.equal(c.wifiState,null);assert.equal(c.wifiPending,null);assert.equal(c.smsConversations,null);assert.equal(c.smsLoadedAt,0);assert.equal(c.smsListInflight,false);assert.equal(c.smsDetailsAcc.recv.length,0);assert.equal(list.innerHTML,'');assert.equal(badge.style.display,'none');
  const native=fs.readFileSync(path.resolve(__dirname,'../app/src/main/java/com/fhcpeboard/android/NativeStore.kt'),'utf8'),bridge=fs.readFileSync(path.resolve(__dirname,'../app/src/main/java/com/fhcpeboard/android/CoreJsInterface.kt'),'utf8');
  assert.match(native,/fun clearCaches\(\): Int/);assert.match(native,/key\.startsWith\("UPSTREAM_LOCAL_DEVICE_"\)/);assert.match(native,/key\.startsWith\("UPSTREAM_LOCAL_WIFI_CACHE_"\)/);assert.match(bridge,/fun clearCaches\(\): Int = NativeStore\.clearCaches\(\)/);
});
test('Wi-Fi PSK cache uses the Android Keystore bridge instead of localStorage',()=>{
  const cached=[],legacy=new Map([['cpe_wifi_cache_v1','{"ok":true}'],['CPE_WIFI_CACHE','{"ok":true}']]),nodes=new Map(),element=()=>({style:{},dataset:{},childNodes:[],checked:true,classList:{contains:()=>false},parentNode:{appendChild(){}},appendChild(){},insertBefore(){},replaceChildren(){},querySelectorAll:()=>[],addEventListener(){}});
  const doc={head:{appendChild(){}},body:{appendChild(){}},getElementById:id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:()=>element(),addEventListener(){}};
  const c={window:null,document:doc,localStorage:{removeItem:key=>legacy.delete(key)},console,setTimeout(){},clearTimeout(){},_wifiLoadCache(){return null;},_wifiSaveCache(){},AndroidBoard:{postMessage(){},wifiCacheGet:scope=>(c.scope=scope,cached[0]||''),wifiCacheSet:(scope,value)=>(c.scope=scope,cached[0]=value)}};c.window=c;
  c.__lanWifiScope='192.168.8.1|admin';
  c._localAccounts=[];c._localActiveIndex=-1;
  vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(assets,'device_address.js'),'utf8'),c);vm.runInContext(fs.readFileSync(path.join(assets,'lan_ui.js'),'utf8'),c);
  c._wifiSaveCache({ok:true,main:{ssid2g:{ssid:'main',pwd:'TEST_PSK'}}});
  assert.match(cached[0],/TEST_PSK/);assert.deepEqual(JSON.parse(cached[0]),{ok:true,main:{ssid2g:{ssid:'main',pwd:'TEST_PSK'}}});
  assert.equal(c.scope,'192.168.8.1|admin','cache belongs to selected CPE/account');
  assert.equal(legacy.size,0,'retire the former plaintext Wi-Fi caches');
  const native=fs.readFileSync(path.resolve(__dirname,'../app/src/main/java/com/fhcpeboard/android/BoardJsInterface.kt'),'utf8');
  assert.ok(native.includes('NativeStore.kcSet(wifiCacheKey(scope), value)'));
});
test('local Wi-Fi write success completes upstream pending state and triggers readback',()=>{
  const {c,wifiResults,sent}=view();c.wifiSetResult({ok:true});
  assert.deepEqual(JSON.parse(JSON.stringify(wifiResults.at(-1))),{ok:true,phase:'done'});
  assert.equal(sent.at(-1).action,'wifiLoad');
});


test('opening or filling configuration does not log in and exposes no startup toggle',()=>{
  const {c,nodes,sent}=view();c.lineConfigResult({accounts:[{id:'p',host:'192.168.8.1',user:'admin',pass:'TEST'}]});c.lanShowLogin();c.startNewLocalProfile();assert.ok(!nodes.get('lanAutoLogin'));assert.ok(!sent.some(m=>m.action==='reloginNow'||m.action==='lanSwitchProfile'));assert.ok(!nodes.get('lanConnectSaved'));
});
test('pending reconnect change survives a stale profile callback and persists on acknowledgement',()=>{
  const {c,nodes,sent}=view(),a={id:'p',host:'192.168.8.1',user:'admin',pass:'TEST',reconnect:true,autoLogin:false};
  c.lineConfigResult({accounts:[{...a}]});nodes.get('lanReconnect').checked=false;nodes.get('lanReconnect').onchange();
  c.lineConfigResult({accounts:[{...a}]});assert.equal(nodes.get('lanReconnect').checked,false);assert.equal(c._localAccounts[0].reconnect,false);
  c.lanOptionsSaved({id:'p',refresh:true,reconnect:false,autoLogin:false});assert.equal(nodes.get('lanReconnect').checked,false);
  assert.equal(sent.find(m=>m.action==='lanOptions').reconnect,false);
});
test('header account selection sends one stable profile id and prevents double submission',()=>{
  const {c,sent}=view();c.lineConfigResult({accounts:[{id:'a',host:'192.168.8.1',user:'admin',pass:'TEST'},{id:'b',host:'192.168.1.1',user:'root',pass:'TEST'}]});
  c._pickLocalDev(1);c._pickLocalDev(0);assert.deepEqual(sent.filter(m=>m.action==='lanSwitchProfile'),[{action:'lanSwitchProfile',id:'b'}]);
  assert.ok(!sent.some(m=>m.action==='saveLocalAccounts'));assert.ok(!sent.some(m=>m.action==='reloginNow'));
});

test('deleting an earlier account retains the selected device and deleting the last clears credentials',()=>{
 const {c,nodes,sent}=view();const accounts=[{id:'a',host:'192.168.8.1',user:'admin',pass:'A'},{id:'b',host:'192.168.1.1',user:'root',pass:'B'},{id:'c',host:'192.168.9.1',user:'admin',pass:'C'}];c.lineConfigResult({accounts,activeIndex:1});c.deleteLocalAccountAt(0);assert.equal(c._localActiveIndex,0);assert.equal(c._localAccounts[0].id,'b');assert.equal(nodes.get('localPass').value,'B');assert.equal(sent.at(-1).activeIndex,0);
 c.deleteLocalAccountAt(1);c.deleteLocalAccountAt(0);assert.equal(c._localActiveIndex,-1);assert.equal(nodes.get('localPass').value,'');assert.equal(nodes.get('localHost').value,'');
});


test('configuration accepts a shared-address LuCI link and saves only its canonical device origin',()=>{
 const {c,nodes,sent}=view();c.document.getElementById('localHost').value='http://100.69.191.69/cgi-bin/luci/';c.document.getElementById('localUser').value='root';c.document.getElementById('localPass').value='TEST';c.saveLocalProfile();const saved=sent.find(x=>x.action==='saveLocalAccounts');assert.equal(saved.accounts[0].host,'http://100.69.191.69');
 c.localAccountsSaved({ok:true});nodes.get('localHost').value='100.69.191.69';c.saveLocalProfile();assert.equal(c._localAccounts.length,1);
});


test('foreground visual restoration clears interrupted SMS transition without resetting the page or scroll',()=>{
 const {c,frames,sent}=view();c.showPage('sms');assert.equal(c.document.documentElement.classList.contains('__sms-transition'),true);c.__lanRestoreVisuals();assert.equal(c.document.documentElement.classList.contains('__sms-transition'),false);assert.equal(c.activePageId,'sms');const count=sent.length;c._visResumeRefresh();assert.equal(sent.length,count);frames[0]();frames[1]();assert.equal(c.document.documentElement.classList.contains('__sms-transition'),false);
});

test('native HTML readiness is completed by page load rather than an early fixed delay',()=>{
 const native=fs.readFileSync(path.resolve(__dirname,'../app/src/main/java/com/fhcpeboard/android/MainActivity.kt'),'utf8');const loading=native.slice(native.indexOf('fun loadBoardHtml'),native.indexOf('private fun isBoardDocument'));assert.ok(!loading.includes('postDelayed'));assert.ok(native.includes('override fun onPageFinished'));assert.ok(native.includes('window.__lanRestoreVisuals'));
});


test('testing another endpoint does not rename the selected saved profile',()=>{
 const {c}=view();c.lineConfigResult({accounts:[{id:'p',name:'KEEP',host:'192.168.1.1',user:'root',pass:'TEST'}],activeIndex:0});c.localTestResult({ok:true,model:'OTHER_DEVICE'});assert.equal(c._localAccounts[0].name,'KEEP');
});

test('native fetch timeout is reported as a network error to connection recovery',async()=>{
 const script=fs.readFileSync(path.join(assets,'core.html'),'utf8').split('<script>')[1].split('</script>')[0],c={setTimeout:()=>1,clearTimeout(){},AndroidCore:{fetch(){throw Error('设备请求超时');}}};c.window=c;vm.runInNewContext(script,c);await assert.rejects(c.__nfetch('http://192.168.1.1',{}),e=>e.code==='NETWORK');
});

test('cell-page partial refreshes keep the header network label from the last full sample',()=>{
 const nodes=new Map(),seen=[];
 function element(){return {style:{},textContent:'',classList:{contains:()=>false,add(){},remove(){}},setAttribute(){},appendChild(){},querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};}
 const doc={body:element(),head:element(),documentElement:element(),createElement:element,addEventListener(){},getElementById:id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);}};
 const code=fs.readFileSync(path.join(assets,'lan_ui.js'),'utf8');
 const start=code.indexOf('  const runtimeCard='),end=code.indexOf('  const headerArrow=');assert.ok(start>0&&end>start);
 const c={document:doc,el:id=>doc.getElementById(id),_mAdd(){},_mDel(){},updateData:data=>seen.push(data)};c.window=c;vm.createContext(c);
 vm.runInContext(code.slice(start,end),c);
 c.updateData({deviceOnline:true,mode:'5GA',rsrp:'-80'});
 c.updateData({mode:'--',rsrp:'-90'});c.updateData({mode:'4G',rsrp:'-91'});
 assert.deepEqual(seen.map(d=>d.mode),['5GA','5GA','5GA']);assert.equal(seen[2].rsrp,'-91','other partial fields still apply');
 c.updateData({deviceOnline:true,mode:'5G SA'});c.updateData({mode:'--'});
 assert.deepEqual(seen.slice(3).map(d=>d.mode),['5G SA','5G SA']);
 c.updateData({smsTabEnabled:'1'});assert.equal(seen.at(-1).mode,undefined,'settings payloads gain no mode');
});

test('login page saves IPv6 and public IPv4 device addresses in canonical form',()=>{
 const {c,nodes}=view();
 nodes.get('localHost').value='[2409:8A00::1]:8080';nodes.get('localUser').value='root';nodes.get('localPass').value='TEST_ONLY';c.saveLocalProfile();c.localAccountsSaved({ok:true});
 nodes.get('localHost').value='36.112.1.2';nodes.get('localUser').value='admin';nodes.get('localPass').value='TEST_ONLY';c.saveLocalProfile();c.localAccountsSaved({ok:true});
 nodes.get('localHost').value='https://Air6.erdf123.xyz/cgi-bin/luci/';nodes.get('localUser').value='root';nodes.get('localPass').value='TEST_ONLY';c.saveLocalProfile();
 assert.deepEqual(c._localAccounts.map(a=>a.host),['http://[2409:8a00::1]:8080','http://36.112.1.2','https://air6.erdf123.xyz']);
 assert.equal(nodes.get('localHost').placeholder,'192.168.8.1、IPv6 或域名');
});

test('SMS list opens a normalized full-screen conversation with per-message actions',()=>{
 const shippedFns=['parseSmsTime','formatSmsTime','smsDayLabel','smsCheckSvg','smsCircleCheck','escapeHtml'].map(n=>generate(shipped.functions.get(n))).join('\n');
 function node(tag){const n={tagName:tag,children:[],dataset:{},style:{},attrs:{},className:'',textContent:'',innerHTML:'',scrollTop:0,
  classList:{add:c=>{if(!n.className.split(' ').includes(c))n.className=(n.className+' '+c).trim();},remove:c=>{n.className=n.className.split(' ').filter(v=>v!==c).join(' ');},toggle(c,on){const has=n.className.split(' ').includes(c);if(on===undefined?!has:on)this.add(c);else this.remove(c);return !has;},contains:c=>n.className.split(' ').includes(c)},
  setAttribute(k,v){n.attrs[k]=v;},appendChild(ch){ch.parentNode=n;n.children.push(ch);return ch;},insertBefore(ch,ref){ch.parentNode=n;n.children.splice(Math.max(0,n.children.indexOf(ref)),0,ch);return ch;},remove(){if(n.parentNode)n.parentNode.children=n.parentNode.children.filter(c=>c!==n);},
  querySelector(sel){return n.querySelectorAll(sel)[0]||null;},
  querySelectorAll(sel){const classes=sel.split(',').map(s=>s.trim().replace(/^\./,''));const out=[];(function walk(p){for(const c of p.children){if(classes.some(k=>c.className.split(' ').includes(k)))out.push(c);walk(c);}})(n);return out;}};return n;}
 const list=node('div'),root=node('div'),chat=node('div'),chatBody=node('div'),chatTitle=node('span'),chatEdit=node('span'),chatActions=node('div'),chatInput=node('div');root.appendChild(list);const sent=[],toasts=[],nodes=new Map([['smsChat',chat],['smsChatBody',chatBody],['smsChatTitle',chatTitle],['smsChatEditBtn',chatEdit],['smsChatActions',chatActions],['smsChatInputBar',chatInput]]);chat.style.display='none';chatBody.clientHeight=100;chatBody.scrollHeight=100;
 const doc={getElementById:id=>id==='smsListContainer'?list:id==='smsViewTabs'?root.children.find(c=>c.id==='smsViewTabs')||null:nodes.get(id)||null,createElement:tag=>{const n=node(tag);Object.defineProperty(n,'id',{get(){return n._id;},set(v){n._id=v;}});return n;},body:node('body')};doc.body.dataset.lanDevice='air6';
 const storage=new Map();
 const c={console,document:doc,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},navigator:{},confirm:()=>true,
  sendToScriptable:(a,d)=>sent.push({a,d}),showUpdateToast:(m)=>toasts.push(m),updateSmsBadge(){},smsShowSkeleton(){},smsShowHintText(t){c.hint=t;},smsHideLoading(){},_dotSet(){},
  renderSmsList(){c.upstreamRendered=(c.upstreamRendered||0)+1;},smsAppendMore(){},smsBatchOp(){c.upstreamBatch=true;},toggleSmsListEdit(){c.smsListEdit=!c.smsListEdit;},closeSmsChat(){chat.style.display='none';c.smsChat=null;},smsBuildConversations(){},openSmsCompose(){}};
 c.window=c;vm.createContext(c);vm.runInContext(shippedFns,c);
 vm.runInContext('var smsDetailsAcc={recv:[{Index:"r1",Sender:"+8613810010086",Msg:"余额提醒",Recvtime:"2026-11-12 09:00:00",Isopened:"0"},{Index:"r2",Sender:"10010",Msg:"流量提醒",Recvtime:"2026/11/11 08:00:00",Isopened:"1"}],send:[{Index:"s1",Receiver:"13810010086",Msg:"CXYE",Sendtime:"26/11/12,08:59:00+32"}]};var smsConversations={convs:[{number:"+8613810010086",recv:[smsDetailsAcc.recv[0]],send:[],unread:1},{number:"10010",recv:[smsDetailsAcc.recv[1]],send:[],unread:0}]};var smsChat=null,smsChatEdit=false,smsChatSelected={};var smsListEdit=false,smsLoadingMore=false,smsLostCount=0;',c);
 vm.runInContext(fs.readFileSync(path.join(assets,'sms_cards.js'),'utf8'),c);
 const plain=v=>JSON.parse(JSON.stringify(v));
 const cards=()=>list.children.filter(n=>n.className.split(' ').includes('sms-card'));
 c.renderSmsList();
 assert.equal(cards().length,2,'one card per normalized number');
 assert.deepEqual(plain(cards().map(n=>n.dataset.key)),['13810010086','10010'],'newest conversation first');
 assert.equal(cards()[0].dataset.count,'2','received and sent messages are merged');
 assert.match(cards()[0].querySelector('.sms-card-time').textContent,/2026\/11\/12 09:00:00/,'hyphenated device time is shown');
 const tabs=root.children.find(n=>n.className==='sms-view-tabs');assert.ok(tabs,'tabs exist');assert.deepEqual(plain(tabs.children.map(b=>b.dataset.view)),['all','recv','send']);
 assert.match(tabs.children[1].textContent,/收件 1/,'unread count on 收件');
 // Opening marks read and enters a phone-style conversation containing both directions.
 cards()[0].onclick();assert.deepEqual(plain(sent.at(-1)),{a:'smsRead',d:{recv:[{Index:'r1'}],send:[]}});
 assert.equal(chat.style.display,'flex');assert.equal(chatTitle.textContent,'+8613810010086');
 const bubbles=chatBody.querySelectorAll('.sms-chat-row');assert.equal(bubbles.length,2);const sentMessage=bubbles.find(n=>n.dataset.key==='send|s1');
 assert.match(sentMessage.querySelector('.sms-chat-meta').children.map(n=>n.textContent).join(' '),/2026\/11\/12 08:59:00/,'AT-style time is shown');
 assert.ok(sentMessage.querySelector('.sms-chat-message-actions').children.some(b=>b.title==='复制'),'each message has copy');
 // Per-message delete targets only that message.
 const del=sentMessage.querySelector('.sms-chat-message-actions').children.find(b=>b.title==='删除');del.onclick({stopPropagation(){}});
 assert.deepEqual(plain(sent.at(-1)),{a:'smsDelete',d:{recv:[],send:[{Index:'s1'}]}});
 // Filters.
 tabs.children[2].onclick();assert.deepEqual(plain(cards().map(n=>n.dataset.key)),['13810010086']);
 tabs.children[1].onclick();assert.deepEqual(plain(cards().map(n=>n.dataset.key)),['13810010086','10010']);
 assert.equal(storage.get('lanSmsView'),'recv','view is remembered');
 // Batch selection applies to the visible messages in one conversation.
 c.smsListEdit=true;vm.runInContext('smsListEdit=true',c);c.renderSmsList();cards()[1].onclick();c.smsBatchOp('del');
 assert.deepEqual(plain(sent.at(-1)),{a:'smsDelete',d:{recv:[{Index:'r2'}],send:[]}});assert.ok(!c.upstreamBatch);
});

test('every SMS conversation is a bordered box with explicit message metadata',()=>{
 const css=fs.readFileSync(path.join(assets,'android_ui.css'),'utf8');
 const rule=/#smsListContainer \.sms-row,\s*body\.has-wallpaper #smsListContainer \.sms-row \{([^}]*)\}/.exec(css);
 assert.ok(rule,'shared .sms-row box rule');
 for(const prop of [/border:1px solid/,/border-radius:12px!important/,/margin:0 0 10px!important/,/padding:12px 14px!important/])assert.match(rule[1],prop);
 assert.match(css,/html\[data-theme=dark\] #smsListContainer \.sms-row,/);
 assert.match(css,/#smsListContainer \.sms-row\.unread/);
 const cards=fs.readFileSync(path.join(assets,'sms_cards.js'),'utf8');assert.match(cards,/openConversation\(group\)/);assert.match(cards,/sms-chat-bubble/);assert.match(cards,/deleteOne\(message\)/);
});
test('Air6 rainbow SMS composer follows light and dark themes instead of staying black',()=>{
 const css=fs.readFileSync(path.join(assets,'android_ui.css'),'utf8');
 assert.match(css,/body\[data-lan-device=air6\]\.card-header-pro #smsChatInputBar\s*\{[^}]*background:rgba\(246,247,249,\.84\)!important/);
 assert.match(css,/html\[data-theme=dark\] body\[data-lan-device=air6\]\.card-header-pro #smsChatInputBar\s*\{[^}]*background:rgba\(27,28,31,\.86\)!important/);
});
test('Air6 COUI SMS composer keeps a pill input and a fixed circular send button',()=>{
 const css=fs.readFileSync(path.join(assets,'android_ui.css'),'utf8');
 assert.match(css,/html\[data-native-ui=coui\] body\[data-lan-device=air6\] #smsChatInput\s*\{[^}]*min-height:44px;[^}]*border-radius:999px!important/);
 assert.match(css,/html\[data-native-ui=coui\] body\[data-lan-device=air6\] #smsChatInputBar > span\s*\{[^}]*width:44px!important;[^}]*height:44px!important;[^}]*aspect-ratio:1;[^}]*border-radius:50%!important/);
});
test('Air6 rainbow theme covers runtime, My values, login and secondary control dialogs',()=>{
 const css=fs.readFileSync(path.join(assets,'android_ui.css'),'utf8');
 assert.match(css,/body\[data-lan-device=air6\]\.card-header-pro #lanRuntimeCard\s*\{[^}]*radial-gradient[^}]*linear-gradient/);
 assert.match(css,/\.air6-system-row \.row-main-title\s*\{[^}]*font-size:14px;[^}]*font-weight:500/);
 assert.match(css,/body\[data-lan-device=air6\] \.air6-system-row \.row-right>span\s*\{[^}]*color:var\(--ios-text\);[^}]*font-size:14px/);
 assert.match(css,/body\[data-lan-device=air6\]\.card-header-pro \.lock-modal-container,/);
 assert.match(css,/body\[data-lan-device=air6\]\.card-header-pro #devSwitchCard,/);
 assert.match(css,/body\[data-lan-device=air6\]\.card-header-pro #arSheetCard\s*\{[^}]*background:var\(--air6-rainbow-panel\)!important/);
 assert.match(css,/body\[data-lan-device=air6\]\.card-header-pro #air6Control \.air6-card,/);
});
test('Air6 runtime matches the original subscribed-rate height and its three metrics stay centered',()=>{
 const css=fs.readFileSync(path.join(assets,'android_ui.css'),'utf8');
 assert.match(css,/\.lan-runtime-card\s*\{[^}]*height:74px;[^}]*box-sizing:border-box/);
 assert.match(css,/body\[data-lan-device=air6\] \.ambr-qci-card \.aq-item\s*\{[^}]*align-items:center;[^}]*justify-content:center;[^}]*text-align:center/);
});
test('OTA and SMS tabs use matching numbered red badges',()=>{
 const css=fs.readFileSync(path.join(assets,'android_ui.css'),'utf8');
 assert.match(css,/#air6OtaTabBadge\s*\{[^}]*min-width:16px;[^}]*height:16px;[^}]*border-radius:8px;[^}]*font-size:10px;[^}]*font-weight:600/);
});
test('OTA notes use compact readable type, expansion and a red System Version marker',()=>{
 const css=fs.readFileSync(path.join(assets,'android_ui.css'),'utf8');
 assert.match(css,/#air6OtaNotes\s*\{[^}]*width:100%;[^}]*min-height:84px;[^}]*max-height:180px;[^}]*font-family:inherit;[^}]*font-size:12px;[^}]*line-height:1\.55/);
 assert.match(css,/#air6OtaNotes\.expanded\s*\{[^}]*max-height:min\(55vh,420px\)/);
 assert.match(css,/\.air6-ota-row-badge\s*\{[^}]*background:var\(--ios-danger\)!important;[^}]*color:#fff!important/);
 assert.match(css,/\.air6-ota-notes-title::before\s*\{[^}]*background:var\(--ios-primary\)/);
 assert.match(css,/#air6OtaNotes\s*\{[^}]*border:1px solid rgba\(47,107,255,\.14\);[^}]*background:rgba\(47,107,255,\.055\);[^}]*color:var\(--ios-text\)/);
});
test('Air6 row chevrons use compact visuals while the full row stays clickable',()=>{
 const css=fs.readFileSync(path.join(assets,'android_ui.css'),'utf8');
 assert.match(css,/body\[data-lan-device=air6\] \.ios-row \.row-right\s*\{[^}]*gap:2px;[^}]*min-width:0/);
 assert.match(css,/body\[data-lan-device=air6\] \.ios-row \.row-right>\.chevron\s*\{[^}]*width:16px;[^}]*height:16px;[^}]*margin:0;[^}]*flex:0 0 16px/);
 assert.match(css,/body\[data-lan-device=air6\] #page-control #netSettingRow \.row-right\s*\{[^}]*gap:2px/);
 assert.match(css,/body\[data-lan-device=air6\] #page-control \.ios-row,[\s\S]*padding-right:10px!important/);
});
test('Android Back unwinds SMS layers and pages before backgrounding the task',()=>{
 const ui=fs.readFileSync(path.join(assets,'lan_ui.js'),'utf8'),native=fs.readFileSync(path.resolve(__dirname,'../app/src/main/java/com/fhcpeboard/android/MainActivity.kt'),'utf8');
 const handler=ui.slice(ui.indexOf('window.lanHandleBack='),ui.indexOf('window.startNewLocalProfile='));
 for(const route of ['smsComposeOverlay','smsChat','wifiInputDialog','tfInputModal','rebootConfirmOverlay','air6Control'])assert.ok(handler.indexOf(route)<handler.indexOf("activePageId!=='overview'"),route);
 assert.match(handler,/candidates\.sort\(\(a,b\)=>a\.z-b\.z/);assert.match(handler,/window\[top\.closer\]\?\.\(\)/);
 assert.match(native,/!result\.contains\("none"\)/);
});
test('OPPO-family devices receive COUI web tokens without a private COUI dependency',()=>{
 const bridge=fs.readFileSync(path.resolve(__dirname,'../app/src/main/java/com/fhcpeboard/android/BoardJsInterface.kt'),'utf8'),css=fs.readFileSync(path.join(assets,'android_ui.css'),'utf8'),gradle=fs.readFileSync(path.resolve(__dirname,'../app/build.gradle.kts'),'utf8');
 assert.match(bridge,/"oppo", "oneplus", "realme"/);assert.match(css,/html\[data-native-ui=coui\]/);assert.doesNotMatch(gradle,/com\.coui|coloros/i);
});
test('release hardens WebView access and packages native fallback for all Android ABIs',()=>{
 const native=fs.readFileSync(path.resolve(__dirname,'../app/src/main/java/com/fhcpeboard/android/MainActivity.kt'),'utf8'),gradle=fs.readFileSync(path.resolve(__dirname,'../app/build.gradle.kts'),'utf8'),core=fs.readFileSync(path.join(assets,'core.html'),'utf8');
 assert.match(native,/MIXED_CONTENT_NEVER_ALLOW/);assert.match(native,/setAcceptThirdPartyCookies\(view, false\)/);assert.match(native,/javaScriptCanOpenWindowsAutomatically = false/);
 assert.match(native,/board\.settings\.allowContentAccess = true/);assert.match(native,/core\.settings\.allowFileAccess = true/);
 assert.equal((native.match(/override fun onRenderProcessGone/g)||[]).length,2);assert.match(native,/lastBoardHtml\?\.let/);assert.match(native,/core\.loadUrl\("file:\/\/\/android_asset\/core\.html"\)/);
 for(const abi of ['arm64-v8a','armeabi-v7a','x86_64','x86'])assert.ok(gradle.includes('"'+abi+'"'),abi);
 assert.match(core,/LOCAL_NETWORK_PERMISSION_DENIED/);
});

test('SMS auto refresh defaults on and respects busy, edit, conversation and background state',()=>{
 const {c,nodes}=view();let refreshes=0;c.smsOnEnter=()=>refreshes++;c.smsListInflight=false;c.smsLoadingMore=false;c.smsCacheLoadLock=false;c.smsDiffing=false;c.smsListEdit=false;c.smsChat=null;c.smsLoadEndAt=0;
 c.lanLoginState({connected:true});c.activePageId='sms';assert.equal(nodes.get('lanSmsAutoRefresh').checked,true);
 c.lanAutoRefreshSms();assert.equal(refreshes,1);
 for(const flag of ['smsListInflight','smsLoadingMore','smsCacheLoadLock','smsListEdit']){c[flag]=true;c.lanAutoRefreshSms();c[flag]=false;}assert.equal(refreshes,1);
 c.smsDiffing=true;c.lanAutoRefreshSms();assert.equal(refreshes,2,'incremental mode is not an in-flight lock');refreshes=1;
 c.document.visibilityState='hidden';c.lanAutoRefreshSms();assert.equal(refreshes,1);c.document.visibilityState='visible';
 nodes.get('lanSmsAutoRefresh').onchange({target:{checked:false}});c.lanAutoRefreshSms();assert.equal(refreshes,1);
});
