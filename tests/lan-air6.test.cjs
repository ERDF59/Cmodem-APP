const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {LanApi}=require('../app/src/main/assets/lan_api.js');
const air6=require('../app/src/main/assets/air6_api.js');
const fixture=require('./fixtures/air6.json');
const response=(body,status=200)=>({ok:status>=200&&status<300,status,text:async()=>typeof body==='string'?body:JSON.stringify(body)});
function device(options={}){
  const state=structuredClone(fixture),calls=[],ui=[],settings={loginStatus:302,expired:false,unconfirmed:false,...options};
  state.wireless={radio0:{'.type':'wifi-device',band:'2.4G'},ap0:{'.type':'wifi-iface',device:'radio0',mode:'ap',ssid:'TEST_24',encryption:'sae-mixed',key:'TEST_ONLY',disabled:'0',hidden:'0'},radio1:{'.type':'wifi-device',band:'6G'},ap1:{'.type':'wifi-iface',device:'radio1',mode:'ap',ssid:'TEST_6',encryption:'sae+ccmp',key:'TEST_ONLY',disabled:'0',hidden:'0'}};
  state.scheduler_list={code:200,service_running:true,timezone:'+08',utc_offset:28800,tasks:[]};state.scheduler_preview={code:200,next_run:1800000000,timezone:'+08',utc_offset:28800};state.failover_status={code:200,service_running:true,kinds:{band:{enabled:true,timeout:90,phase:'idle'},pci:{enabled:true,timeout:90,phase:'idle'}}};
  state.otaStatus={ok:true,supported:true,phase:'available',current_version:'2026.11.07-V1.04',latest_version:'2026.11.09-V1.05',sha256:'a'.repeat(64)};
  state.get_sms_forward={code:200,forward_enable:false,forward_number:'',serverchan_enable:false,serverchan_sendkey:'',email_enable:false,email_smtp_server:'',email_smtp_port:587,email_smtp_security:'starttls',email_smtp_user:'',email_smtp_password:'TEST_SECRET',email_from:'',email_to:'',email_subject:'CModem SMS',delete_rule:'none',cleanup_threshold:90,cleanup_keep:20};state.get_sms_messages.sms_storage_mode={name:'MT'};state.get_cfun={code:200,mode:1};state.get_imei={code:200,imei:'000000000000000'};state.get_usb_mode={code:200,supported:true,mode:'rc',current_mode:'rc'};
  const fetch=async(url,request={})=>{
    const parsed=new URL(url),method=parsed.searchParams.get('method');calls.push({url,method,request});
    if(parsed.pathname.includes('/luci-static/'))return response("'get_device_info'; 'get_bandinfo'; 'admin/modem/cmodem/api';");
    if(parsed.pathname==='/cgi-bin/luci/admin/modem/cmodem')return response('<script>L.env={"sessionid":"0123456789abcdef0123456789abcdef","token":"abcdef0123456789abcdef0123456789"}</script>');
    if(parsed.pathname==='/ubus/'){
      const body=JSON.parse(request.body);if(Array.isArray(body))return response(body.map(c=>({id:c.id,jsonrpc:'2.0',result:c.params[1]==='file'?[0,{data:c.params[3].path==='/proc/stat'?settings.cpuStats?.shift()||'':c.params[3].path.endsWith('/type')?'cpu_little0':'61635'}]:[0,state['system_'+c.params[2]]]})));
      const [,object,method,args]=body.params;let data={};
      if(object==='luci-rpc'&&method==='getDHCPLeases')return response({},settings.clientStatus??0);
      if(object==='luci.air6-ota')return response({jsonrpc:'2.0',id:body.id,result:[0,state.otaStatus]});
      if(object==='file'&&method==='list')return response({id:body.id,result:[0,{entries:[{name:'thermal_zone1'}]}]});
      if(object==='file'&&method==='read')return response({id:body.id,result:[0,{data:settings.cpuStats?.shift()||''}]});
      if(object==='system'&&method==='reboot')return response({jsonrpc:'2.0',id:body.id,result:[0]});
      if(object!=='uci')throw Error('Unexpected RPC');
      if(method==='get')data={values:state.wireless};
      else if(method==='changes')data={changes:settings.pendingChanges?{network:[['set','lan','proto','dhcp']]}:{}};
      else if(method==='set'){Object.assign(state.wireless[args.section],args.values);if(settings.failWifiStage)return response('',0);}
      else if(method==='apply'){if(settings.failWifiApply)return response('',0);}
      else throw Error('Unexpected UCI method');
      return response({jsonrpc:'2.0',id:body.id,result:[0,data]});
    }
    if(parsed.pathname==='/cgi-bin/luci/')return response('',settings.loginStatus);
    if(settings.expired)return response('',403);
    if(!method)throw Error('Unexpected non-Air6 URL '+url);
    if(settings.gates?.[method])await settings.gates[method];
    if(settings.transportFailMethod===method)return response('',0);
    if(settings.failMethod===method)return response({code:500});
    if(request.method==='POST'){
      if(settings.failWrite)return response('',0);
      const form=new URLSearchParams(request.body),payload=form.has('payload')?JSON.parse(form.get('payload')):Object.fromEntries(form);
      if(!settings.unconfirmed){
        if(method==='scheduler_save'){const saved={...payload,id:payload.id||'task-test'};state.scheduler_list.tasks=state.scheduler_list.tasks.filter(t=>t.id!==saved.id).concat(saved);}
        else if(method==='scheduler_delete')state.scheduler_list.tasks=state.scheduler_list.tasks.filter(t=>t.id!==payload.id);
        else if(method==='scheduler_toggle'){const task=state.scheduler_list.tasks.find(t=>t.id===payload.id);if(task)task.enabled=payload.enabled;}
        else if(method==='failover_save')Object.assign(state.failover_status.kinds[payload.kind],{enabled:payload.enabled,timeout:payload.timeout});
        else if(method==='set_bandmode_str'){for(const r of ['umts','lte','nr'])if(payload['set_'+r+'_band']!==undefined)state.get_bandmode_str['current_'+r+'_band']=payload['set_'+r+'_band'];}
        else if(method==='set_sms_forward')Object.assign(state.get_sms_forward,payload);
        else if(method==='set_sms_storage_mode')state.get_sms_messages.sms_storage_mode={name:payload.mode};
        else if(method==='set_cfun')state.get_cfun.mode=Number(payload.mode);
        else if(method==='set_imei')state.get_imei.imei=payload.imei;
        else if(method==='set_usb_mode')state.get_usb_mode.mode=payload.mode;
        else if(method==='set_rat')state.get_rat.rat=payload.rat;
        else if(method==='set_celllock')state.get_celllock.cell_lock_info=payload;
        else if(method==='set_celllock_list')Object.assign(state.get_celllock_list,payload);
      }
      if(settings.loseAck&&/^(scheduler_|failover_)/.test(method))return response('',0);
      return response({code:200,result:'success'});
    }
    return state[method]?response(state[method]):response('',404);
  };
  const api=new LanApi({host:'192.168.1.1',fetch,evalJS:async code=>{
    const name=/window\.(\w+)/.exec(code)[1],context={};context.window={[name]:value=>ui.push({name,value:JSON.parse(JSON.stringify(value))})};vm.runInNewContext(code,context);
  }});
  return {api,state,calls,ui,settings,fetch};
}
test('Air6 detects cmodem, authenticates via encoded LuCI form and verifies protected data',async()=>{
  const h=device();const result=await h.api.login('root','test&+中文=');
  assert.equal(result.line.mode,'air6');
  const login=h.calls.find(c=>c.url.endsWith('/cgi-bin/luci/'));
  assert.equal(new URLSearchParams(login.request.body).get('luci_password'),'test&+中文=');
  assert.equal(login.request.headers['Content-Type'],'application/x-www-form-urlencoded; charset=UTF-8');
  assert.equal(h.calls.at(-1).method,'get_device_info');
  assert.equal(h.calls.filter(c=>c.request.method==='POST').length,1);
  assert.ok(h.calls.every(c=>!c.url.includes('fh_api')));
});
test('Air6 auth rejection never falls back to another protocol or retries a password',async()=>{
  const h=device({loginStatus:403});await assert.rejects(h.api.login('root','bad'),e=>e.code==='AUTH_REJECTED');
  assert.equal(h.calls.filter(c=>c.request.method==='POST').length,1);assert.ok(!h.calls.some(c=>c.method==='get_device_info'));
});
test('a redirect alone cannot prove Air6 login; protected reads must pass',async()=>{
  const h=device({expired:true});await assert.rejects(h.api.login('root','test'),e=>e.code==='SESSION_EXPIRED');assert.equal(h.api.line,null);
});
test('Air6 maps captured envelopes, enum bandwidth, zero SINR and bit rates correctly',async()=>{
  const h=device();await h.api.login('root','test');const data=await h.api.sample();
  assert.equal(data.mode,'5G SA');assert.equal(data.rsrp,'-84');assert.equal(data.sinr,'0');assert.equal(data.carriers[0].sinr,'0');
  assert.equal(data.carriers[0].band,'N41');assert.equal(data.carriers[0].bandwidth,'DL 100MHz / UL 100MHz');
  assert.equal(data.allCells[0].isCarrier,true);assert.equal(data.allCells[1].isCarrier,false);
  assert.equal(data.downSpeed,'1000');assert.equal(data.upSpeed,'1');assert.equal(data.monthRxToday,undefined);
  assert.equal(data.deviceName,'SoftBank');assert.equal(data.deviceModel,'Air6');
  assert.equal(data.modemTemp,'61.6°');assert.equal(data.ramUsage,'40.0');assert.equal(data.swVersion,'OpenWrt SNAPSHOT');assert.equal(data.air6FirmwareFull,'OpenWrt SNAPSHOT TEST');assert.equal(data.air6Kernel,'6.18.55');assert.equal(data.air6Baseband,'TEST_FIRMWARE');
  assert.equal(data.air6Ota.current_version,'2026.11.07-V1.04');assert.equal(data.air6Ota.latest_version,'2026.11.09-V1.05');
  assert.deepEqual(await h.api.speed(),{down:'1000',up:'1'});
});
test('Air6 OTA matches the Web RPC contract and never starts a write automatically',async()=>{
  const h=device();await h.api.login('root','test');await h.api.sample();
  const otaCalls=()=>h.calls.filter(call=>call.url.includes('/ubus/')).map(call=>JSON.parse(call.request.body)).filter(body=>body.params?.[1]==='luci.air6-ota');
  assert.ok(otaCalls().some(body=>body.params[2]==='status'));assert.ok(!otaCalls().some(body=>['check','download','select','upgrade'].includes(body.params[2])));
  await h.api.action({action:'air6Ota',kind:'check'});await h.api.action({action:'air6Ota',kind:'download'});
  const selected='b'.repeat(64);await h.api.action({action:'air6Ota',kind:'select',sha256:selected});
  await h.api.action({action:'air6Ota',kind:'upgrade',keep:false,sha256:'a'.repeat(64),rollback:true});
  const calls=otaCalls(),select=calls.find(body=>body.params[2]==='select'),upgrade=calls.find(body=>body.params[2]==='upgrade');
  assert.deepEqual(select.params[3],{sha256:selected});assert.deepEqual(upgrade.params[3],{keep:false,sha256:'a'.repeat(64),rollback:true});
  assert.equal(calls.filter(body=>body.params[2]==='upgrade').length,1,'upgrade is never retried');
  const before=calls.length;await h.api.action({action:'air6Ota',kind:'upgrade',keep:true,sha256:'invalid',rollback:false});assert.equal(otaCalls().length,before,'invalid hashes never reach the device');
});
test('LTE and NSA carriers retain their radio and match cells by PCI plus frequency',()=>{
  const data=structuredClone(fixture);data.get_lcd_info.lcd_info.network_type='NR-NSA';
  data.get_cellinfo={serving_rat:'NR-NSA',nsa_nr_info:[{pci:0,nr_arfcn:504990,rsrp:-85,sinr:0}],nsa_lte_info:[{pci:0,earfcn:1300,rsrp:-90,sinr:5}]};
  data.get_cainfo={nr_pcc_info:[{nr_pcc_band:41,nr_pcc_pci:0,nr_pcc_arfcn:504990,nr_pcc_dl_bandwidth:11}],lte_pcc_info:[{lte_pcc_band:3,lte_pcc_pci:0,lte_pcc_arfcn:1300,lte_pcc_dl_bandwidth:5}]};
  const n=air6.normalize(data);assert.equal(n.carriers[0].pci,'0');assert.equal(n.carriers[1].band,'B3');assert.equal(n.carriers[1].rsrp,'-90');assert.equal(n.carriers[1].bandwidth,'DL 20MHz / UL --');
  assert.equal(air6.signal('rsrp',0,-255,-9999),'--');assert.equal(air6.signal('sinr',null,'',0),'0');
});
test('session expiry stops polling and does not silently reuse old data',async()=>{
  const h=device();await h.api.login('root','test');h.settings.expired=true;
  await assert.rejects(h.api.speed(),e=>e.code==='SESSION_EXPIRED');
  const count=h.calls.length;await assert.rejects(h.api.probe(),e=>e.code==='SESSION_EXPIRED');assert.equal(h.calls.length,count);
});
test('Air6 band write preserves UMTS, encodes payload and verifies readback',async()=>{
  const h=device();await h.api.login('root','test');await h.api.action({action:'air6SetBands',lte:'B1 B41',nr:'N78/N41'});
  const write=h.calls.find(c=>c.method==='set_bandmode_str'),payload=JSON.parse(new URLSearchParams(write.request.body).get('payload'));
  assert.deepEqual(payload,{set_lte_band:'1/41',set_nr_band:'41/78',set_umts_band:'8'});assert.equal(h.ui.at(-1).value.ok,true);
  await h.api.action({action:'air6SetBands',lte:'1',nr:'41'});assert.equal(h.calls.filter(c=>c.method==='set_bandmode_str').length,1,'cooldown prevents repeated modem restarts');
});
test('invalid or unsupported bands never reach a write endpoint',async()=>{
  const h=device();await h.api.login('root','test');await h.api.action({action:'air6SetBands',lte:'999',nr:'41'});
  assert.equal(h.ui.at(-1).value.ok,false);assert.ok(!h.calls.some(c=>c.method==='set_bandmode_str'));
});

test('unchanged radio mode and equivalent band lists never submit a disruptive write or start cooldown',async()=>{
 const h=device();await h.api.login('root','TEST');await h.api.action({action:'air6SetRat',rat:'21'});assert.match(h.ui.at(-1).value.message,/未改变/);
 await h.api.action({action:'air6SetBands',lte:'41/3/1',nr:'78/41'});assert.match(h.ui.at(-1).value.message,/未改变/);assert.ok(!h.calls.some(c=>c.method?.startsWith('set_')));
 await h.api.action({action:'air6SetRat',rat:'15'});assert.equal(h.calls.filter(c=>c.method==='set_rat').length,1);
});

test('network mode and band dialogs do not depend on cell or neighbor endpoints',async()=>{
 for(const section of ['rat','band']){const h=device({failMethod:'get_celllock'});await h.api.login('root','TEST');await h.api.action({action:'air6ReadControls',section,requestId:'dialog'});assert.equal(h.ui.at(-1).name,'air6ControlData');assert.equal(h.ui.at(-1).value.rat,'21');assert.equal(h.ui.at(-1).value.section,section);assert.equal(h.ui.at(-1).value.requestId,'dialog');assert.ok(!h.calls.some(c=>['get_celllock','get_celllock_list','get_cellinfo','get_cainfo'].includes(c.method)));if(section==='rat')assert.ok(!h.calls.some(c=>c.method==='get_bandmode_str'));}
});
test('unconfirmed or timed-out writes are not retried or reported as success',async()=>{
  for(const settings of [{unconfirmed:true},{failWrite:true}]){
    const h=device(settings);await h.api.login('root','test');await h.api.action({action:'air6SetRat',rat:'15'});
    assert.equal(h.ui.at(-1).value.ok,false);assert.equal(h.calls.filter(c=>c.method==='set_rat').length,1);
  }
});
test('single cell accepts PCI zero, validates ranges, and full unlock clears both locks',async()=>{
  const h=device();await h.api.login('root','test');await h.api.action({action:'air6SetCell',rat:'nr',arfcn:'504990',pci:'0'});
  assert.equal(h.ui.at(-1).value.ok,true);assert.equal(h.state.get_celllock.cell_lock_info.pci,0);
  const bad=device();await bad.api.login('root','test');await bad.api.action({action:'air6SetCell',rat:'lte',arfcn:'1300',pci:'504'});assert.ok(!bad.calls.some(c=>c.method==='set_celllock'));
  const unlock=device();await unlock.api.login('root','test');await unlock.api.action({action:'air6UnlockCell'});assert.equal(unlock.ui.at(-1).value.ok,true);assert.deepEqual(unlock.calls.filter(c=>c.method?.startsWith('set_')).map(c=>c.method),['set_celllock_list','set_celllock']);
});
test('SMS object/array payloads map to stable board indices and never write on read',async()=>{
  const h=device();h.state.get_sms_messages.messages={'0':{index:0,sender:'10086',time:'2026-11-10 12:00:00',content:'TEST',is_read:false}};
  await h.api.login('root','test');await h.api.action({action:'smsList'});const index=h.ui.at(-1).value.recv_index_list[0].Index;
  assert.equal(index,'r0');await h.api.action({action:'smsGet',recv:[index]});assert.equal(h.ui.at(-1).value.recv_msg_list[0].Msg,'TEST');
  await h.api.action({action:'smsBadgeProbe'});assert.equal(h.ui.at(-1).value.count,1);await h.api.action({action:'smsRead',indices:[index]});
  assert.equal(h.calls.filter(c=>c.request.method==='POST').length,1);
});
test('Air6 normalizes SMS timestamps used by the imported conversation sorter',()=>{
  assert.equal(air6.smsTime('2026-11-12 09:08:07'),'2026/11/12 09:08:07');
  assert.equal(air6.smsTime('26/11/12,09:08:07+32'),'2026/11/12 09:08:07');
  assert.equal(air6.smsTime('invalid device time'),'invalid device time');
});
test('Air6 uses the native PDU decoder only as a missing-field fallback',async()=>{
  global.AndroidCore={decodeSmsPdu:()=>JSON.stringify({ok:true,outgoing:false,number:'+1234',text:'NATIVE TEXT',time:'2026/11/12 09:08:07'})};
  try{
    const h=device();h.state.get_sms_messages.messages=[{index:7,pdu:'0000',is_read:false}];await h.api.login('root','test');
    await h.api.action({action:'smsList'});const index=h.ui.at(-1).value.recv_index_list[0].Index;await h.api.action({action:'smsGet',recv:[index]});
    assert.equal(h.ui.at(-1).value.recv_msg_list[0].Sender,'+1234');assert.equal(h.ui.at(-1).value.recv_msg_list[0].Msg,'NATIVE TEXT');assert.equal(h.ui.at(-1).value.recv_msg_list[0].Recvtime,'2026/11/12 09:08:07');
  }finally{delete global.AndroidCore;}
});
test('unsupported features cannot dispatch FiberHome requests on an Air6 connection',async()=>{
  const h=device();await h.api.login('root','test');const count=h.calls.length;
  await assert.rejects(h.api.action({action:'wifiLoad'}),/尚未适配/);await assert.rejects(h.api.post('set_single_by_xmlnode',{}),/不支持/);
  assert.equal(h.calls.length,count);
});
test('cached Air6 route works when static assets are unavailable',async()=>{
  const h=device();const api=new LanApi({host:'192.168.1.1',fhLine:'air6',fetch:(url,opt)=>{assert.ok(!url.includes('luci-static'));return h.fetch(url,opt);}});
  await api.login('root','test');assert.equal(api.line.mode,'air6');
});
test('JSON authentication failures invalidate the session even with HTTP 200',async()=>{
  const h=device();await h.api.login('root','test');h.state.get_throughput={code:403};
  await assert.rejects(h.api.speed(),e=>e.code==='SESSION_EXPIRED');
});
test('malformed SMS replies preserve the previous inbox instead of reporting an empty list',async()=>{
  const h=device();await h.api.login('root','test');h.state.get_sms_messages={code:200,result:'success'};
  await h.api.action({action:'smsList'});assert.ok(h.ui.at(-1).value.error);assert.equal(h.ui.at(-1).value.recv_index_list,undefined);
});
test('neighbor bands prefer reported data then same-frequency carriers, and mark ambiguous NR ranges',()=>{
  const n=air6.normalize(fixture);assert.equal(n.allCells[1].band,'N41');assert.equal(n.allCells[1].bandSource,'same-frequency');
  assert.deepEqual(air6.cellBand({nr_arfcn:627264},'nr',[]),{band:'N77/N78',bandSource:'candidates'});
  assert.deepEqual(air6.cellBand({nr_arfcn:627264,band:'n78'},'nr',[]),{band:'N78',bandSource:'reported'});
  assert.equal(air6.cellBand({earfcn:1300},'lte',[]).band,'B3');assert.equal(air6.cellBand({earfcn:0},'lte',[]).band,'B1');
  assert.equal(air6.cellBand({nr_arfcn:504990},'nr',[],{nr_band:41,nr_dl_arfcn:504990}).band,'N41');
  assert.equal(air6.cellBand({nr_arfcn:9999999},'nr',[]).band,'--');
});

test('memory main card excludes reclaimable memory and keeps LuCI cached usage separately',()=>{
 const data=structuredClone(fixture);assert.equal(air6.normalize(data).ramUsage,'40.0');assert.equal(air6.normalize(data).air6Resources.ramWithCache,'80');data.system_info.memory.available=1999;assert.equal(air6.normalize(data).ramUsage,'0.1');delete data.system_info.memory.available;assert.equal(air6.normalize(data).ramUsage,'80.0');data.system_info.memory.free=2000;assert.equal(air6.normalize(data).ramUsage,'0.0');data.system_info.memory.free=3000;assert.equal(air6.normalize(data).ramUsage,'--');
});

test('Air6 Wi-Fi reads actual OpenWrt AP sections including 6GHz without exposing stored keys',async()=>{
  const h=device();await h.api.login('root','TEST');await h.api.action({action:'air6WifiLoad'});const value=h.ui.at(-1).value;
  assert.equal(value.ok,true);assert.deepEqual(value.networks.map(v=>v.band),['2.4G','6G']);assert.ok(!JSON.stringify(value).includes('TEST_ONLY'));
});
test('Air6 Wi-Fi saves only chosen AP fields, preserves encryption and applies once before readback',async()=>{
  const h=device();await h.api.login('root','TEST');await h.api.action({action:'air6WifiSave',section:'ap1',patch:{ssid:'NEW_SSID',enabled:true,hidden:true,password:'NEW_TEST_PASSWORD'}});
  assert.equal(h.ui.at(-1).value.ok,true);assert.equal(h.state.wireless.ap1.encryption,'sae+ccmp');assert.equal(h.state.wireless.ap0.ssid,'TEST_24');
  const rpc=h.calls.filter(c=>c.url.endsWith('/ubus/')).map(c=>JSON.parse(c.request.body));assert.equal(rpc.filter(c=>c.params?.[2]==='apply').length,1);
  const set=rpc.find(c=>c.params?.[2]==='set');assert.equal(set.params[3].config,'wireless');assert.ok(!('encryption' in set.params[3].values));
});
test('Wi-Fi invalid passwords and pending unrelated changes never apply settings',async()=>{
  for(const options of [{pendingChanges:true},{}]){const h=device(options);await h.api.login('root','TEST');await h.api.action({action:'air6WifiSave',section:'ap0',patch:options.pendingChanges?{ssid:'NEW'}:{password:'short'}});assert.equal(h.ui.at(-1).value.ok,false);assert.ok(!h.calls.some(c=>c.url.endsWith('/ubus/')&&JSON.parse(c.request.body).params?.[2]==='set'));}
});
test('Wi-Fi apply disconnect is pending, never replayed or reported successful',async()=>{
  const h=device({failWifiApply:true});await h.api.login('root','TEST');await assert.rejects(h.api.action({action:'air6WifiSave',section:'ap0',patch:{ssid:'NEW'}}),e=>e.code==='NETWORK');
  assert.equal(h.ui.at(-1).value.pending,true);assert.equal(h.ui.at(-1).value.ok,false);assert.equal(h.calls.filter(c=>c.url.endsWith('/ubus/')&&JSON.parse(c.request.body).params?.[2]==='apply').length,1);
});

test('Wi-Fi stage response loss reports possible unapplied changes without retrying or applying',async()=>{
  const h=device({failWifiStage:true});await h.api.login('root','TEST');await assert.rejects(h.api.action({action:'air6WifiSave',section:'ap0',patch:{ssid:'NEW'}}),e=>e.code==='NETWORK');
  assert.equal(h.ui.at(-1).value.pending,true);assert.equal(h.ui.at(-1).value.ok,false);assert.match(h.ui.at(-1).value.message,/暂存结果未确认/);
  const calls=h.calls.filter(c=>c.url.endsWith('/ubus/')).map(c=>JSON.parse(c.request.body));
  assert.equal(calls.filter(c=>c.params?.[2]==='set').length,1);assert.equal(calls.filter(c=>c.params?.[2]==='apply').length,0);
});

test('SMS deletion resolves multipart device indexes and read state uses read_key, not the displayed index',async()=>{
  const h=device();h.state.get_sms_messages.messages=[{indexes:[4,5],sender:'10086',content:'TEST',read_key:'DEVICE_READ_KEY',is_read:false}];await h.api.login('root','TEST');
  await h.api.action({action:'smsRead',recv:[{Index:'r4_5'}]});const read=h.calls.find(c=>c.method==='mark_sms_read');assert.equal(new URLSearchParams(read.request.body).get('key'),'DEVICE_READ_KEY');
  await h.api.action({action:'smsDelete',recv:[{Index:'r4_5'}]});const del=h.calls.find(c=>c.method==='delete_sms');assert.equal(new URLSearchParams(del.request.body).get('message_indexes'),'4,5');assert.equal(h.ui.at(-1).name,'air6SmsResult');
});
test('SMS failed write does not retry and reports failure without an empty inbox result',async()=>{
  const h=device({failWrite:true});await h.api.login('root','TEST');await assert.rejects(h.api.action({action:'smsSend',receiver:'10086',msg:'TEST'}),e=>e.code==='NETWORK');
  assert.equal(h.calls.filter(c=>c.method==='send_sms_text').length,1);assert.equal(h.ui.at(-1).name,'air6SmsResult');assert.equal(h.ui.at(-1).value.ok,false);
});
test('multi-cell setting validates the full list and verifies returned LTE and NR entries',async()=>{
  const h=device();await h.api.login('root','TEST');await h.api.action({action:'air6SetCells',cells:'LTE,1300,0\nNR,504990,581'});assert.equal(h.ui.at(-1).value.ok,true);assert.equal(h.state.get_celllock_list.lte_cell_count,1);assert.equal(h.state.get_celllock_list.nr_cell_list[0].nr_arfcn,504990);
  const bad=device();await bad.api.login('root','TEST');await bad.api.action({action:'air6SetCells',cells:'LTE,1300,999'});assert.ok(!bad.calls.some(c=>c.method==='set_celllock_list'));
});
test('AT output is returned through the board callback and does not repeat a command',async()=>{
  const h=device();await h.api.login('root','TEST');await h.api.action({action:'sendAtCommand',cmd:'ATI'});assert.equal(h.calls.filter(c=>c.method==='exec_at').length,1);assert.equal(h.ui.at(-1).name,'atResult');assert.equal(h.ui.at(-1).value.ok,true);
});

test('Air6 reboot uses one OpenWrt RPC and its dedicated completion callback',async()=>{
  const h=device();await h.api.login('root','TEST');await h.api.action({action:'rebootDevice'});const requests=h.calls.filter(c=>c.url.endsWith('/ubus/')).map(c=>JSON.parse(c.request.body));assert.equal(requests.filter(c=>c.params?.[1]==='system'&&c.params?.[2]==='reboot').length,1);assert.equal(h.ui.at(-1).name,'air6RebootResult');assert.equal(h.ui.at(-1).value.ok,true);
});

test('2CC and mixed 3CC aggregate DL and UL independently and skip disabled uplinks',()=>{
 const d=structuredClone(fixture);d.get_cainfo.nr_scc_info=[{nr_scc_band:78,nr_scc_pci:12,nr_scc_arfcn:627264,nr_scc_dl_bandwidth:11,nr_scc_ul_bandwidth:7}];
 assert.equal(air6.normalize(d).caSummary,'DL 200MHz / UL 150MHz · 2CC');
 d.get_cainfo.nr_scc_info[0].nr_scc_ul_configured=0;d.get_cainfo.lte_pcc_info=[{lte_pcc_band:3,lte_pcc_pci:11,lte_pcc_arfcn:1300,lte_pcc_dl_bandwidth:5,lte_pcc_ul_bandwidth:5}];
 assert.equal(air6.normalize(d).caSummary,'DL 220MHz / UL 120MHz · 3CC');
 delete d.get_cainfo.lte_pcc_info[0].lte_pcc_ul_bandwidth;assert.equal(air6.normalize(d).caSummary,'DL 220MHz / UL -- · 3CC');
 assert.equal(air6.bandwidth('nr','100MHz'),'100MHz');assert.equal(air6.bandwidth('nr',100),'100MHz');
});

test('white-theme N41+N28 detail uses the same uplink configuration as the aggregate',()=>{
 const d=structuredClone(fixture);d.get_cainfo.nr_scc_info=[{nr_scc_band:28,nr_scc_pci:556,nr_scc_arfcn:152650,nr_scc_dl_bandwidth:5,nr_scc_ul_bandwidth:4,nr_scc_ul_configured:0}];
 let n=air6.normalize(d);assert.equal(n.caSummary,'DL 130MHz / UL 100MHz · 2CC');assert.equal(n.carriers[1].bandwidth,'DL 30MHz / UL 未配置');assert.equal(n.carriers[1].ulConfigured,false);
 d.get_cainfo.nr_scc_info[0].nr_scc_ul_configured=1;n=air6.normalize(d);assert.equal(n.caSummary,'DL 130MHz / UL 125MHz · 2CC');assert.equal(n.carriers[1].bandwidth,'DL 30MHz / UL 25MHz');
 delete d.get_cainfo.nr_scc_info[0].nr_scc_ul_bandwidth;n=air6.normalize(d);assert.equal(n.caSummary,'DL 130MHz / UL -- · 2CC');assert.equal(n.carriers[1].ulBandwidth,'--');
 d.get_cainfo.nr_scc_info[0].nr_scc_ul_configured=false;assert.equal(air6.normalize(d).caSummary,'DL 130MHz / UL 100MHz · 2CC');
});

test('4CC preserves all carriers and adds each independent DL/UL bandwidth exactly once',()=>{
 const d=structuredClone(fixture);d.get_cainfo.nr_scc_info=[{nr_scc_band:28,nr_scc_dl_bandwidth:5,nr_scc_ul_bandwidth:4,nr_scc_ul_configured:0},{nr_scc_band:78,nr_scc_dl_bandwidth:11,nr_scc_ul_bandwidth:7},{nr_scc_band:79,nr_scc_dl_bandwidth:11,nr_scc_ul_bandwidth:11,nr_scc_ul_configured:0}];
 const n=air6.normalize(d);assert.equal(n.carriers.length,4);assert.equal(n.bandTag,'N41+N28+N78+N79');assert.equal(n.caSummary,'DL 330MHz / UL 150MHz · 4CC');assert.equal(n.carriers[1].ulBandwidth,'未配置');assert.equal(n.carriers[2].ulBandwidth,'50MHz');assert.equal(n.carriers[3].ulBandwidth,'未配置');
});

test('web-equivalent rates fall back from empty NR data, prefer LCD, and retain a direct zero rate',()=>{
 const throughput={nr_throughput_info:[],lte_throughput_info:{mac_throughput_dl:8000000,mac_throughput_ul:8000}};
 assert.deepEqual(air6.rates(throughput,'NR-SA'),{down:'1000',up:'1'});
 assert.deepEqual(air6.rates(throughput,'NR-SA',{mac_throughput_dl:16000000,mac_throughput_ul:0}),{down:'2000',up:'1'});
 assert.deepEqual(air6.rates(throughput,'NR-SA',{}, {source:'edmfapp',mac_throughput_info:{mac_throughput_dl:0,mac_throughput_ul:16000}}),{down:'0',up:'2'});
});
test('NSA data chooses NSA serving cells rather than a stale SA list, and 3G remains 3G',()=>{
 const d=structuredClone(fixture);d.get_lcd_info.lcd_info.network_type='NR-NSA';d.get_cellinfo.nsa_nr_info=[{pci:1,nr_arfcn:627264,rsrp:-99,sinr:3}];assert.equal(air6.normalize(d).rsrp,'-99');
 d.get_lcd_info.lcd_info.network_type='UMTS';d.get_cellinfo={serving_rat:'UMTS',umts_info:[{pci:4,uarfcn:3088,band:8}]};d.get_cainfo={};const value=air6.normalize(d);assert.equal(value.mode,'3G');assert.equal(value.allCells[0].rat,'umts');assert.equal(value.allCells[0].isCarrier,true);
 d.get_lcd_info.lcd_info.network_type='OTHERS';assert.equal(air6.normalize(d).mode,'未注册');
});
test('setting responses echo the request id so stale responses can be discarded',async()=>{
 const h=device();await h.api.login('root','TEST');await h.api.action({action:'air6WifiLoad',requestId:'wifi-1'});assert.equal(h.ui.at(-1).value.requestId,'wifi-1');
 await h.api.action({action:'air6ReadControls',requestId:'control-2'});assert.equal(h.ui.at(-1).value.requestId,'control-2');
});

test('entering control reads row statuses independently without waiting for neighbor data or another slow row',async()=>{
 let release;const gate=new Promise(r=>release=r),h=device({gates:{get_celllock_list:gate},failMethod:'get_cellinfo'});await h.api.login('root','TEST');
 const job=h.api.action({action:'switchPage',page:'control'});await new Promise(r=>setImmediate(r));
 assert.ok(h.ui.some(v=>v.name==='air6ControlSummary'&&v.value.rat==='21'));
 assert.ok(h.ui.some(v=>v.name==='air6ControlSummary'&&v.value.bands));assert.ok(!h.calls.some(v=>['get_cellinfo','get_cainfo'].includes(v.method)));
 release();await job;assert.equal(h.ui.at(-1).value.multiple.nr_cell_count,0);
});

test('one failed control summary API does not discard other rows and cannot become a false unlocked state',async()=>{
 const h=device({failMethod:'get_celllock_list'});await h.api.login('root','TEST');await h.api.action({action:'air6ReadControlSummary'});
 const summary=h.ui.at(-1).value;assert.equal(summary.rat,'21');assert.ok(summary.bands);assert.ok(summary.errors.multiple);assert.equal(summary.multiple,undefined);
});
test('SMS read completion returns the affected ids and multipart indexes stay stable regardless of order',async()=>{
 const h=device();h.state.get_sms_messages.messages=[{indexes:[5,4],sender:'10086',content:'TEST',read_key:'READ'}];await h.api.login('root','TEST');await h.api.action({action:'smsList'});assert.equal(h.ui.at(-1).value.recv_index_list[0].Index,'r4_5');
 await h.api.action({action:'smsRead',recv:[{Index:'r4_5'}]});assert.deepEqual(h.ui.at(-1).value.recv,[{Index:'r4_5'}]);
});

test('CFUN accepts zero and reads back flight mode, rejects unknown modes without writing',async()=>{
 const h=device();await h.api.login('root','TEST');await h.api.action({action:'air6AdvancedSave',kind:'cfun',value:'0',requestId:'cfun-test'});assert.equal(h.ui.at(-1).value.ok,true);assert.equal(h.ui.at(-1).value.data.mode,0);assert.equal(h.ui.at(-1).value.requestId,'cfun-test');
 await h.api.action({action:'air6AdvancedSave',kind:'cfun',value:'2'});assert.equal(h.calls.filter(c=>c.method==='set_cfun').length,1);assert.equal(h.ui.at(-1).value.ok,false);
});
test('USB uses CSRF token and distinguishes saved EP from running RC without automatic reboot',async()=>{
 const h=device();await h.api.login('root','TEST');await h.api.action({action:'air6AdvancedSave',kind:'usb',value:'ep'});
 const write=h.calls.find(c=>c.method==='set_usb_mode'),body=new URLSearchParams(write.request.body);assert.equal(body.get('mode'),'ep');assert.equal(body.get('token'),'abcdef0123456789abcdef0123456789');assert.equal(h.ui.at(-1).value.ok,true);assert.equal(h.ui.at(-1).value.rebootRequired,true);assert.equal(h.ui.at(-1).value.data.current_mode,'rc');assert.ok(!h.calls.some(c=>c.url.endsWith('/ubus/')));
});
test('IMEI requires 15 digits and does not report success until readback matches',async()=>{
 const h=device();await h.api.login('root','TEST');await h.api.action({action:'air6AdvancedSave',kind:'imei',value:'123'});assert.ok(!h.calls.some(c=>c.method==='set_imei'));
 await h.api.action({action:'air6AdvancedSave',kind:'imei',value:'111111111111111'});assert.equal(h.ui.at(-1).value.ok,true);
 const pending=device({unconfirmed:true});await pending.api.login('root','TEST');await pending.api.action({action:'air6AdvancedSave',kind:'imei',value:'111111111111111'});assert.equal(pending.ui.at(-1).value.pending,true);assert.equal(pending.ui.at(-1).value.ok,false);
});
test('unsupported USB mode never reaches set_usb_mode',async()=>{
 const h=device();h.state.get_usb_mode.supported=false;await h.api.login('root','TEST');await h.api.action({action:'air6AdvancedSave',kind:'usb',value:'ep'});assert.ok(!h.calls.some(c=>c.method==='set_usb_mode'));
});

test('band selection matches web semantics: one empty radio leaves that side unchanged',async()=>{
 const h=device();await h.api.login('root','TEST');await h.api.action({action:'air6SetBands',lte:'',nr:'41'});const write=h.calls.find(c=>c.method==='set_bandmode_str'),payload=JSON.parse(new URLSearchParams(write.request.body).get('payload'));assert.equal(payload.set_lte_band,undefined);assert.equal(h.state.get_bandmode_str.current_lte_band,'1/3/41');assert.equal(h.ui.at(-1).value.ok,true);
 const blank=device();await blank.api.login('root','TEST');await blank.api.action({action:'air6SetBands',lte:'',nr:''});assert.ok(!blank.calls.some(c=>c.method==='set_bandmode_str'));
});

test('SMS configuration updates preserve untouched SMTP credentials and derive cleanup flags like web',async()=>{
 const h=device();await h.api.login('root','TEST');await h.api.action({action:'air6ExtraSave',kind:'smsconfig',patch:{delete_rule:'archive_local_oldest',cleanup_keep:0}});
 assert.equal(h.ui.at(-1).value.ok,true);const write=h.calls.find(c=>c.method==='set_sms_forward'),payload=JSON.parse(new URLSearchParams(write.request.body).get('payload'));assert.equal(payload.email_smtp_password,'TEST_SECRET');assert.equal(payload.archive_cleanup_enable,true);assert.equal(payload.cleanup_enable,true);assert.equal(payload.auto_delete_forwarded,false);
});
test('SMS storage mode uses the web payload and confirms device-selected storage',async()=>{
 const h=device();await h.api.login('root','TEST');await h.api.action({action:'air6ExtraSave',kind:'storage',mode:'SIM'});assert.equal(h.ui.at(-1).value.ok,true);assert.equal(h.ui.at(-1).value.storageMode,'SIM');
});
test('RF command respects web bounds and bands and does not claim a hardware readback',async()=>{
 const h=device();await h.api.login('root','TEST');await h.api.action({action:'air6ExtraSave',kind:'rf',rat:'nr',power:30,enable:'1'});assert.ok(!h.calls.some(c=>c.method==='set_rf_power'));
 await h.api.action({action:'air6ExtraSave',kind:'rf',rat:'nr',power:26,enable:'1'});const write=h.calls.find(c=>c.method==='set_rf_power');assert.equal(new URLSearchParams(write.request.body).get('bands'),'1,3,5,8,28,41,77,78,79');assert.match(h.ui.at(-1).value.message,/无设置回读/);
});

test('USB unchanged saved mode still reports pending reboot against current mode',async()=>{
 const h=device();h.state.get_usb_mode={supported:true,mode:'ep',current_mode:'rc',reboot_required:true};await h.api.login('root','TEST');await h.api.action({action:'air6AdvancedSave',kind:'usb',value:'ep'});assert.equal(h.ui.at(-1).value.rebootRequired,true);assert.match(h.ui.at(-1).value.message,/重启/);assert.ok(!h.calls.some(c=>c.method==='set_usb_mode'));
});
test('editing unrelated SMS options preserves legacy cleanup semantics',async()=>{
 const h=device();delete h.state.get_sms_forward.delete_rule;h.state.get_sms_forward.archive_cleanup_enable=true;await h.api.login('root','TEST');await h.api.action({action:'air6ExtraRead',kind:'smsconfig'});assert.equal(h.ui.at(-1).value.config.delete_rule,'archive_local_oldest');await h.api.action({action:'air6ExtraSave',kind:'smsconfig',patch:{email_subject:'NEW'}});const c=h.calls.find(c=>c.method==='set_sms_forward'),p=JSON.parse(new URLSearchParams(c.request.body).get('payload'));assert.equal(p.archive_cleanup_enable,true);assert.equal(p.delete_rule,'archive_local_oldest');
});


test('entering control automatically reads advanced values and one failed advanced API does not block other rows',async()=>{
 const h=device({failMethod:'get_cfun'});await h.api.login('root','TEST');await h.api.action({action:'switchPage',page:'control'});
 for(const method of ['get_cfun','get_usb_mode','get_imei'])assert.equal(h.calls.filter(c=>c.method===method).length,1);
 const summary=h.ui.filter(v=>v.name==='air6ControlSummary').at(-1).value;assert.ok(summary.errors.cfun);assert.equal(summary.usb.current_mode,'rc');assert.equal(summary.imei.imei,'000000000000000');assert.equal(summary.rat,'21');assert.ok(!h.calls.some(c=>c.method?.startsWith('set_')));
});


test('cell metrics accept web signal aliases, keep zero SINR, and identify only the serving row',()=>{
 const d=structuredClone(fixture);d.get_cellinfo.sa_info=[{pci:581,nr_arfcn:504990,serv_rsrp:-86,serv_rsrq:-11,serv_snr:14},{pci:520,nr_arfcn:504990,ssb_rsrp_avg:-94,serv_rsrq:-11,ssb_snr_avg:0},{pci:558,nr_arfcn:504990}];const cells=air6.normalize(d).allCells;
 assert.equal(cells[0].isServing,true);assert.equal(cells[1].isServing,false);assert.equal(cells[0].rsrp,'-86');assert.equal(air6.normalize(d).rsrp,'-86');assert.equal(air6.normalize(d).carriers[0].rsrp,'-86');assert.equal(cells[1].rsrp,'-94');assert.equal(cells[1].sinr,'0');assert.equal(cells[2].rsrp,'--');
});

test('multi-cell lock submits both radio lists once and verifies exact readback',async()=>{
 const h=device();await h.api.login('root','TEST');await h.api.action({action:'air6SetCells',cells:'NR,504990,581\nNR,504990,520\nLTE,1300,0'});const writes=h.calls.filter(c=>c.method==='set_celllock_list');assert.equal(writes.length,1);const payload=JSON.parse(new URLSearchParams(writes[0].request.body).get('payload'));assert.equal(payload.nr_cell_count,2);assert.equal(payload.lte_cell_count,1);assert.equal(payload.lte_cell_list[0].pci,0);assert.equal(h.ui.at(-1).value.ok,true);
});


test('DHCP lists merge IPv4 and IPv6 by MAC or hardware DUID, not by a shared hostname',()=>{
 const rows=air6.leaseDevices({dhcp_leases:[{hostname:'ERDF',macaddr:'24:B2:B9:E3:79:2B',ipaddr:'192.168.1.216'},{hostname:'ERDF',macaddr:'24:b2:b9:e3:79:2b',ipaddr:'192.168.1.216'},{hostname:'ERDF',macaddr:'00:11:22:33:44:55',ipaddr:'192.168.1.217'}],dhcp6_leases:[{hostname:'ERDF',duid:'000100012345678924b2b9e3792b',ip6addr:'2001:db8::1',ip6addrs:['2001:db8::1','2001:db8::2']}]});assert.equal(rows.length,2);assert.deepEqual(rows[0].ipv4,['192.168.1.216']);assert.deepEqual(rows[0].ipv6,['2001:db8::1','2001:db8::2']);assert.equal(rows[1].ipv6.length,0);
 const unknown=air6.leaseDevices({dhcp_leases:[{hostname:'same',ipaddr:'192.168.1.1'}],dhcp6_leases:[{hostname:'same',ip6addr:'2001:db8::1'}]});assert.equal(unknown.length,2);
});


test('non-hardware DUID may match a unique dual-stack hostname while ambiguous names stay separate',()=>{
 const data={dhcp_leases:[{hostname:'desktop',macaddr:'00:11:22:33:44:55',ipaddr:'192.168.1.2'}],dhcp6_leases:[{hostname:'desktop',duid:'0002abcdef',ip6addr:'2001:db8::1',ip6addrs:['2001:db8::1/128']}]};let rows=air6.leaseDevices(data);assert.equal(rows.length,1);assert.deepEqual(rows[0].ipv6,['2001:db8::1']);assert.equal(rows[0].identityMatch,'hostname');data.dhcp_leases.push({hostname:'desktop',macaddr:'00:11:22:33:44:66',ipaddr:'192.168.1.3'});assert.equal(air6.leaseDevices(data).length,3);
});


test('new leases and multiple IPv6 addresses refresh without duplicating or retaining removed addresses',()=>{
 const input={dhcp_leases:[{hostname:'phone',macaddr:'00:11:22:33:44:55',ipaddr:'192.168.1.2'}],dhcp6_leases:[{hostname:'phone',duid:'00030001001122334455',ip6addr:'2001:db8::1'}]};assert.equal(air6.leaseDevices(input).length,1);
 input.dhcp6_leases.push({hostname:'phone',duid:'00030001001122334455',ip6addr:'2001:db8::2',ip6addrs:['2001:db8::2/128']});input.dhcp_leases.push({hostname:'phone',macaddr:'00:11:22:33:44:66',ipaddr:'192.168.1.3'});let result=air6.leaseDevices(input);assert.equal(result.length,2);assert.deepEqual(result[0].ipv6,['2001:db8::1','2001:db8::2']);assert.deepEqual(result[1].ipv6,[]);
 input.dhcp6_leases.shift();result=air6.leaseDevices(input);assert.deepEqual(result[0].ipv6,['2001:db8::2']);
});


test('multiple leases of one opaque DUID do not defeat unique-hostname dual-stack association',()=>{
 const rows=air6.leaseDevices({dhcp_leases:[{hostname:'desktop',macaddr:'00:11:22:33:44:55',ipaddr:'192.168.1.2'},{hostname:'desktop',macaddr:'00:11:22:33:44:55',ipaddr:'192.168.1.2'}],dhcp6_leases:[{hostname:'desktop',duid:'0002abcdef',ip6addr:'2001:db8::1'},{hostname:'desktop',duid:'0002abcdef',ip6addr:'2001:db8::2'}]});assert.equal(rows.length,1);assert.deepEqual(rows[0].ipv6,['2001:db8::1','2001:db8::2']);
});

test('same PCI and channel in different radio families never cross-match carrier metrics',()=>{
 const d=structuredClone(fixture);d.get_lcd_info.lcd_info.network_type='NR-NSA';d.get_cellinfo={serving_rat:'NR-NSA',nsa_nr_info:[{pci:1,nr_arfcn:1300,rsrp:-80}],nsa_lte_info:[{pci:1,earfcn:1300,rsrp:-110}]};d.get_cainfo={nr_pcc_info:[{nr_pcc_pci:1,nr_pcc_arfcn:1300,nr_pcc_band:1}],lte_pcc_info:[{lte_pcc_pci:1,lte_pcc_arfcn:1300,lte_pcc_band:3}]};const n=air6.normalize(d);assert.equal(n.carriers[0].rsrp,'-80');assert.equal(n.carriers[1].rsrp,'-110');assert.equal(n.allCells.find(v=>v.rat==='lte').band,'B3');
});

test('client-list transport and session errors complete the UI then reach connection recovery',async()=>{
 for(const status of [0,403]){const h=device({clientStatus:status});await h.api.login('root','TEST');await assert.rejects(h.api.action({action:'air6Clients',requestId:'clients'}),e=>e.code===(status===0?'NETWORK':'SESSION_EXPIRED'));assert.equal(h.ui.at(-1).name,'air6ClientsData');assert.equal(h.ui.at(-1).value.ok,false);assert.equal(h.ui.at(-1).value.requestId,'clients');}
});


test('empty successful control envelopes cannot appear as unlocked or unrestricted',async()=>{
 const h=device();h.state.get_celllock={code:200};h.state.get_celllock_list={code:200};h.state.get_bandmode_str={code:200};await h.api.login('root','TEST');await h.api.action({action:'air6ReadControlSummary'});const summary=h.ui.at(-1).value;assert.ok(summary.errors.bands);assert.ok(summary.errors.single);assert.ok(summary.errors.multiple);assert.equal(summary.rat,'21');assert.equal(summary.single,undefined);await h.api.action({action:'air6ReadControls',section:'cell'});assert.equal(h.ui.at(-1).value.ok,false);
});

test('Air6 read-only refreshes match the device page by issuing independent reads concurrently',async()=>{
 let release;const gate=new Promise(r=>release=r),h=device({gates:{get_lcd_info:gate}});await h.api.login('root','TEST');
 const sample=h.api.sample();await new Promise(r=>setImmediate(r));
 assert.ok(h.calls.some(c=>c.method==='get_cellinfo'),'cell reads must not wait behind lcd info');assert.ok(h.calls.some(c=>c.url.endsWith('/ubus/')),'system info must not wait behind modem reads');
 release();await sample;
 let releaseSpeed;const speedGate=new Promise(r=>releaseSpeed=r);h.settings.gates={get_lcd_info:speedGate};const speed=h.api.speed();await new Promise(r=>setImmediate(r));
 assert.ok(h.calls.at(-1).method==='get_throughput');releaseSpeed();assert.deepEqual(await speed,{down:'1000',up:'1'});
});
test('Air6 cell dialog reads lock state and neighbors concurrently',async()=>{
 let release;const gate=new Promise(r=>release=r),h=device({gates:{get_bandmode_str:gate}});await h.api.login('root','TEST');
 const job=h.api.action({action:'air6ReadControls',section:'cell'});await new Promise(r=>setImmediate(r));
 for(const method of ['get_rat','get_celllock','get_celllock_list','get_cellinfo','get_cainfo'])assert.ok(h.calls.some(c=>c.method===method),method);
 release();await job;assert.equal(h.ui.at(-1).name,'air6ControlData');assert.ok(h.ui.at(-1).value.cells.length);
});

test('Air6 slow-changing reads are cached for 30 seconds and reset on login',async()=>{
 const h=device();await h.api.login('root','TEST');const count=m=>h.calls.filter(c=>c.method===m).length;
 await h.api.sample();await h.api.sample();
 for(const m of ['get_sim_qci','get_client_count','traffic_daily'])assert.equal(count(m),1,m);
 assert.equal(count('get_lcd_info'),2);
 const realNow=Date.now;Date.now=()=>realNow()+31000;try{await h.api.sample();}finally{Date.now=realNow;}
 assert.equal(count('get_sim_qci'),2);
 await h.api.login('root','TEST');await h.api.sample();assert.equal(count('get_sim_qci'),3);
});

test('Air6 header label follows the 5GA carrier rule and keeps SA/NSA/4G otherwise',()=>{
 const sa=(...scc)=>{const d=structuredClone(fixture);d.get_cainfo.nr_scc_info=scc.map(([band,bw])=>({nr_scc_band:band,nr_scc_pci:10+band,nr_scc_arfcn:600000+band,nr_scc_dl_bandwidth:bw,nr_scc_ul_bandwidth:bw}));return air6.normalize(d).mode;};
 assert.equal(sa(),'5G SA','1CC');
 assert.equal(sa([78,11]),'5GA','N41 100 + N78 100 = 200 MHz');
 assert.equal(sa([28,5]),'5G SA','N41 100 + N28 30 = 130 MHz');
 assert.equal(sa([28,5],[78,11]),'5GA','3CC');
 const nsa=structuredClone(fixture);nsa.get_lcd_info.lcd_info.network_type='NR-NSA';nsa.get_cellinfo={serving_rat:'NR-NSA',nsa_nr_info:[{pci:1,nr_arfcn:504990}],nsa_lte_info:[{pci:2,earfcn:1300}]};
 nsa.get_cainfo={lte_pcc_info:[{lte_pcc_band:3,lte_pcc_pci:2,lte_pcc_arfcn:1300,lte_pcc_dl_bandwidth:5}],lte_scc_info:[{lte_scc_band:1,lte_scc_pci:3,lte_scc_arfcn:100,lte_scc_dl_bandwidth:5}],nr_pcc_info:[{nr_pcc_band:41,nr_pcc_pci:1,nr_pcc_arfcn:504990,nr_pcc_dl_bandwidth:11}]};
 assert.equal(air6.normalize(nsa).mode,'5G NSA','LTE anchors do not count toward 5GA');
 const lte=structuredClone(fixture);lte.get_lcd_info.lcd_info.network_type='LTE';lte.get_cellinfo={serving_rat:'LTE',lte_info:[{pci:2,earfcn:1300}]};lte.get_cainfo={lte_pcc_info:[{lte_pcc_band:3,lte_pcc_pci:2,lte_pcc_arfcn:1300,lte_pcc_dl_bandwidth:5}]};
 assert.equal(air6.normalize(lte).mode,'4G');
 const none=structuredClone(fixture);none.get_lcd_info.lcd_info.network_type='OTHERS';assert.equal(air6.normalize(none).mode,'未注册');
});

test('new Web carrier labels match shuffled signal rows without borrowing PCC values',()=>{
 const d=structuredClone(fixture);d.get_cellinfo={serving_rat:'NR-SA'};
 d.get_cainfo={nr_pcc_info:[{nr_pcc_type:'NR PCC',nr_pcc_band:41,nr_pcc_pci:1,nr_pcc_arfcn:504990,nr_pcc_pucch_tx_pwr:0,nr_pcc_pusch_tx_pwr:15}],nr_scc_info:[{nr_scc_type:'NR SCC 1',nr_scc_band:28,nr_scc_pci:2,nr_scc_arfcn:152650},{nr_scc_type:'NR SCC 2',nr_scc_band:78,nr_scc_pci:3,nr_scc_arfcn:627264}]};
 d.get_signalstrength={nr_info:[{rsrp:-70,nr_cc_info:[{nr5g_cc_type:'NR SCC 1',trs_rsrp_rx0:-255,ssb_rsrp_rx0:-98,ssb_snr_rx0:0},{nr5g_cc_type:'NR PCC',ssb_rsrp_rx0:-81,ssb_snr_rx0:12}]}]};
 const n=air6.normalize(d);assert.equal(n.carriers[0].rsrp,'-81');assert.equal(n.carriers[1].rsrp,'-98');assert.equal(n.carriers[1].sinr,'0');assert.equal(n.carriers[2].rsrp,'--');assert.equal(n.carriers[0].pucch,'0');assert.equal(n.carriers[0].pusch,'15');
 d.get_measinfo={meas_info:{nr_scc_info:[{cc_type:'NR SCC 1',serv_rsrp:-92,serv_snr:9}]}};assert.equal(air6.normalize(d).carriers[1].rsrp,'-92');
});
test('explicit OTA status bypasses overview cache and reports errors instead of cached success',async()=>{
 const h=device();await h.api.login('root','TEST');await h.api.sample();
 h.state.otaStatus={ok:true,supported:true,phase:'downloading',progress:37};await h.api.action({action:'air6Ota',kind:'status'});assert.equal(h.ui.at(-1).value.data.progress,37);
 h.state.otaStatus={ok:false,message:'TEST_OTA_UNAVAILABLE'};await h.api.action({action:'air6Ota',kind:'status'});assert.equal(h.ui.at(-1).value.ok,false);assert.match(h.ui.at(-1).value.message,/TEST_OTA_UNAVAILABLE/);
});
test('separate task and fallback panels request only their own read endpoint',async()=>{
 const h=device();h.state.scheduler_list={code:200,service_running:true,tasks:[]};h.state.failover_status={code:200,service_running:true,kinds:{band:{enabled:true,timeout:90,phase:'idle'},pci:{enabled:true,timeout:90,phase:'idle'}}};await h.api.login('root','TEST');
 for(const [kind,method] of [['scheduler','scheduler_list'],['failover','failover_status']]){
   const at=h.calls.length;await h.api.action({action:'air6ExtraRead',kind});assert.ok(h.calls.slice(at).every(c=>c.request.method==='GET'));assert.deepEqual(h.calls.slice(at).map(c=>c.method),[method]);assert.equal(h.ui.at(-1).value.kind,kind);assert.equal(h.ui.at(-1).value.ok,true);assert.ok(h.ui.at(-1).value[kind]);
 }
 h.settings.failMethod='scheduler_list';await h.api.action({action:'air6ExtraRead',kind:'scheduler'});assert.equal(h.ui.at(-1).value.ok,false);
 await h.api.action({action:'air6ExtraRead',kind:'failover'});assert.equal(h.ui.at(-1).value.ok,true);
});

test('signal overview matches captured Web fields without substituting PCC measurement values',()=>{
 const {data,expected}=require('./fixtures/air6-signal-web.json'),n=air6.normalize(data);assert.deepEqual(Object.fromEntries(Object.keys(expected).map(k=>[k,n[k]])),expected);assert.notEqual(n.carriers[0].rssi,n.rssi,'PCC telemetry and Web overview use different sources');
 const d={get_cellinfo:{serving_rat:'NR-SA',sa_info:[{rsrp:-255,rsrq:0,sinr:99,rssi:0}]},get_signalstrength:{nr_info:[{}]},get_measinfo:{meas_info:{nr_pcc_info:[{serv_rsrp:-89,serv_rsrq:-12,serv_snr:0,serv_rssi:-70}]}},get_lcd_info:{lcd_info:{network_type:'NR-SA',rsrp:-99,rsrq:-19,sinr:8,rssi:-90}}};const v=air6.normalize(d);assert.deepEqual([v.rsrp,v.rsrq,v.sinr,v.rssi],['-89','-12','0','-70']);
});
test('fresh global sample bypasses all overview slow caches',async()=>{
 const h=device();await h.api.login('root','TEST');await h.api.sample();const at=h.calls.length;await h.api.sample({fresh:true});const calls=h.calls.slice(at);
 for(const method of ['get_device_info','get_client_count','get_sim_qci','traffic_daily','get_cellinfo','get_signalstrength','get_measinfo'])assert.ok(calls.some(c=>c.method===method),method);
 const rpc=calls.filter(c=>c.url.includes('/ubus/')).flatMap(c=>JSON.parse(c.request.body));assert.ok(rpc.some(c=>c.params[1]==='system'&&c.params[2]==='board'));assert.ok(rpc.some(c=>c.params[1]==='luci.air6-ota'&&c.params[2]==='status'));
});

test('CPU uses the same proc/stat delta as LuCI, excludes guest and treats reset/empty snapshots as unknown',async()=>{
 const before='cpu  1000 0 500 8000 100 50 50 0 300 0\n',after='cpu  1100 0 560 8800 120 60 60 0 999 0\n';
 assert.equal(air6.cpuPercent(air6.cpuCounters(before),air6.cpuCounters(after)),18);assert.equal(air6.cpuPercent(null,air6.cpuCounters(after)),null);assert.equal(air6.cpuPercent(air6.cpuCounters(after),air6.cpuCounters(before)),null);assert.equal(air6.cpuPercent(air6.cpuCounters(before),air6.cpuCounters(before)),null);assert.equal(air6.cpuCounters('cpu  1 x 2 3'),null);
 const h=device({cpuStats:[before,after]});await h.api.login('root','TEST');const result=await h.api.sample({fresh:true});assert.equal(result.cpuUsage,'18.0');assert.equal(result.ramUsage,'40.0');assert.notEqual(result.cpuUsage,String(fixture.get_lcd_info.lcd_info.cpu_usage));
 const absent=air6.normalize(fixture);assert.equal(absent.cpuUsage,'--','never silently use the short modem sample');
});
test('scheduler preview is GET and preserves the encoded Cron expression',async()=>{
 const h=device();await h.api.login('root','TEST');await h.api.action({action:'air6TaskPreview',cron:'0 */6 * * 1,3',requestId:'preview-1'});const c=h.calls.at(-1);assert.equal(c.request.method,'GET');assert.equal(new URL(c.url).searchParams.get('cron'),'0 */6 * * 1,3');assert.equal(h.ui.at(-1).name,'air6TaskPreviewData');assert.equal(h.ui.at(-1).value.requestId,'preview-1');
});
test('task create, edit, pause and delete use CSRF-protected Web endpoints and verify persisted state',async()=>{
 const h=device();await h.api.login('root','TEST');let task={name:'测试计划',enabled:true,cron:'0 2 * * *',action:'rat',params:{rat:'15'}};
 await h.api.action({action:'air6ExtraSave',kind:'scheduler',op:'save',task});assert.equal(h.ui.at(-1).value.ok,true);const row=h.state.scheduler_list.tasks[0];assert.equal(row.params.rat,'15');task={...task,id:row.id,cron:'30 3 * * 1,3',action:'pci',params:{rat:'nr',arfcn:504990,pci:0}};
 await h.api.action({action:'air6ExtraSave',kind:'scheduler',op:'save',task});assert.equal(h.ui.at(-1).value.ok,true);assert.equal(h.state.scheduler_list.tasks[0].params.pci,0);
 await h.api.action({action:'air6ExtraSave',kind:'scheduler',op:'toggle',id:row.id,enabled:false});assert.equal(h.state.scheduler_list.tasks[0].enabled,false);assert.equal(h.ui.at(-1).value.ok,true);
 await h.api.action({action:'air6ExtraSave',kind:'scheduler',op:'delete',id:row.id});assert.equal(h.state.scheduler_list.tasks.length,0);assert.equal(h.ui.at(-1).value.ok,true);
 const writes=h.calls.filter(c=>c.request.method==='POST'&&c.method?.startsWith('scheduler_'));assert.equal(writes.length,4);for(const c of writes){const form=new URLSearchParams(c.request.body);assert.match(form.get('token'),/^[a-f0-9]{32}$/);assert.ok(form.has('payload'));}
});
test('invalid task and fallback values never reach a write endpoint',async()=>{
 const h=device();await h.api.login('root','TEST');const base={name:'test',enabled:true,cron:'0 2 * * *',action:'rat',params:{rat:'15'}};
 for(const task of [{...base,cron:'61 2 * * *'},{...base,name:''},{...base,action:'pci',params:{rat:'lte',arfcn:100,pci:504}},{...base,action:'band',params:{nr:'999'}},{...base,action:'unlock',params:{target:'unknown'}}]){await h.api.action({action:'air6ExtraSave',kind:'scheduler',op:'save',task});assert.equal(h.ui.at(-1).value.ok,false);}
 await h.api.action({action:'air6ExtraSave',kind:'failover',target:'band',enabled:true,timeout:31});assert.equal(h.ui.at(-1).value.ok,false);assert.equal(h.calls.filter(c=>/^(scheduler_|failover_)/.test(c.method||'')&&c.request.method==='POST').length,0);
});
test('band tasks preserve UMTS and failover save changes only the chosen protection',async()=>{
 const h=device();await h.api.login('root','TEST');await h.api.action({action:'air6ExtraSave',kind:'scheduler',op:'save',task:{name:'bands',enabled:false,cron:'0 2 * * *',action:'band',params:{lte:'3/1',nr:''}}});assert.equal(h.ui.at(-1).value.ok,true);const task=h.state.scheduler_list.tasks[0];assert.equal(task.params.lte,'1/3');assert.equal(task.params.umts,h.state.get_bandmode_str.current_umts_band||'');
 await h.api.action({action:'air6ExtraSave',kind:'failover',target:'band',enabled:false,timeout:120});assert.equal(h.ui.at(-1).value.ok,true);assert.equal(h.ui.at(-1).value.target,'band');assert.equal(h.state.failover_status.kinds.band.timeout,120);assert.equal(h.state.failover_status.kinds.pci.enabled,true);assert.equal(h.state.failover_status.kinds.pci.timeout,90);
});
test('lost task save acknowledgement is reported as uncertain and never automatically retried',async()=>{
 const h=device({loseAck:true});await h.api.login('root','TEST');await h.api.action({action:'air6ExtraSave',kind:'scheduler',op:'save',task:{name:'one',enabled:false,cron:'0 2 * * *',action:'unlock',params:{target:'all'}}});assert.equal(h.state.scheduler_list.tasks.length,1);assert.equal(h.ui.at(-1).value.ok,false);assert.equal(h.ui.at(-1).value.pending,true);assert.equal(h.calls.filter(c=>c.method==='scheduler_save').length,1);
});

test('slow unread count cannot hold back a ready overview and global summaries are delivered once',async()=>{
 let release;const gate=new Promise(r=>release=r),h=device({gates:{get_sms_messages:gate}});await h.api.login('root','TEST');let displayed=false,finished=false;const job=h.api.sample({fresh:true,global:true,smsBadge:true,onOverview:()=>{displayed=true;}}).then(()=>finished=true);await new Promise(r=>setImmediate(r));assert.equal(displayed,true);assert.equal(finished,false);assert.equal(h.ui.filter(v=>v.name==='air6ControlSummary').length,1);release();await job;assert.equal(finished,true);
});

test('traffic reads use the same status endpoint as the Web detail page',async()=>{
 const h=device();h.state.traffic_status={code:200,total_rx:16000000000,total_tx:690000000};await h.api.login('root','TEST');const at=h.calls.length,result=await h.api.sample({fresh:true});assert.equal(result.air6Traffic.total_rx,16000000000);assert.equal(result.air6Traffic.total_tx,690000000);assert.ok(h.calls.slice(at).some(c=>c.method==='traffic_status'));assert.equal(h.calls.slice(at).some(c=>c.method==='traffic_total'),false);
});

test('Air6 speed lane bypasses slow full data queue without overlapping itself',async()=>{
 let release;const gate=new Promise(r=>release=r),h=device({gates:{get_cellinfo:gate}});await h.api.login('root','TEST');let finished=false;const sample=h.api.sample({fresh:true}).then(()=>finished=true);await new Promise(r=>setImmediate(r));const first=h.api.speed(),second=h.api.speed();assert.equal(first,second);const speed=await first;assert.equal(speed.down,'1000');assert.equal(finished,false);release();await sample;
});
test('global snapshots refresh hidden settings, tasks and failover as well as overview',async()=>{
 const h=device();await h.api.login('root','TEST');const at=h.calls.length;await h.api.sample({fresh:true,global:true});const methods=h.calls.slice(at).map(c=>c.method);for(const name of ['get_cfun','get_rat','get_bandmode_str','get_celllock_list','get_sms_messages','get_sms_forward','scheduler_list','failover_status'])assert.ok(methods.includes(name),name);const rpc=h.calls.slice(at).filter(c=>c.url.includes('/ubus/')).flatMap(c=>JSON.parse(c.request.body));for(const [obj,method] of [['uci','get'],['luci-rpc','getDHCPLeases'],['network.interface','dump']])assert.ok(rpc.some(r=>r.params[1]===obj&&r.params[2]===method));assert.ok(h.ui.some(r=>r.name==='air6GlobalSnapshot'));
});

test('parallel system views share one LuCI session read',async()=>{
 const h=device();await h.api.login('root','TEST');await h.api.sample({fresh:true,global:true});assert.equal(h.calls.filter(c=>c.url.endsWith('/cgi-bin/luci/admin/modem/cmodem')).length,1);
});

test('a failed overview keeps its queue until parallel reads settle, without tagging old callbacks as a new panel',async()=>{
 let release;const gate=new Promise(r=>release=r),h=device({gates:{get_sms_messages:gate}});await h.api.login('root','TEST');h.settings.transportFailMethod='get_lcd_info';
 let finished=false;const sample=h.api.sample({fresh:true,global:true}).catch(()=>{finished=true;});await new Promise(r=>setImmediate(r));
 const before=h.calls.filter(c=>c.method==='get_rat').length;const panel=h.api.action({action:'air6ReadControls',section:'rat',requestId:'new-panel'});await new Promise(r=>setImmediate(r));
 assert.equal(finished,false,'failed sample still owns its unfinished parallel reads');assert.equal(h.calls.filter(c=>c.method==='get_rat').length,before,'next panel cannot enter the old batch');
 release();await Promise.all([sample,panel]);assert.ok(h.ui.filter(v=>v.name==='smsUpdate').every(v=>v.value.requestId!=='new-panel'));
});
test('global SMS settings include fresh storage and capacity, not only forwarding options',async()=>{
 const h=device();await h.api.login('root','TEST');h.state.get_sms_messages.sms_storage={used:7,total:200};await h.api.sample({fresh:true,global:true});const settings=h.ui.findLast(v=>v.name==='air6GlobalSnapshot').value.smsconfig;assert.equal(settings.storageMode,'MT');assert.equal(settings.storage.used,7);assert.equal(settings.storage.total,200);
});
