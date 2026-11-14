/* Platform boundary around the mechanically extracted upstream local module. */
(function (root) {
  'use strict';
  root.UpstreamLocal = {
    create(options) {
      let account=Object.assign({},options.account), reconnectAllowed=true, connecting=false;
      let diagnostic={stage:'idle',status:0,heartbeat:'',line:'',path:''};
      const base=options.address(account.host);
      const __CPE={keyPrefix:()=> 'UPSTREAM_LOCAL_',evalJS:options.evalJS||(()=>Promise.resolve(null)),timer:options.timer||((ms,callback)=>setTimeout(callback,ms)),clearTimer:clearTimeout};
      const _0x48240a=new Proxy({}, {get:(_,key)=>'UPSTREAM_LOCAL_'+String(key)+'_'});
      const _0x16e738={
        get:key=>options.storage.get(key)||'',
        set:(key,value)=>{
          options.storage.set(key,String(value));
          if(key==='UPSTREAM_LOCAL_LOCAL_ACCOUNTS_'&&options.onAccounts)options.onAccounts(JSON.parse(value));
        },
        has:key=>!!options.storage.get(key),
        remove:key=>options.storage.remove(key)
      };
      const _0x4f44fb=()=>account;
      const _0x3ed42d=()=>options.accounts?options.accounts():[account];
      const _0x4f1a06=()=>options.activeIndex?options.activeIndex():0;
      const _0x32dbea=()=>Promise.resolve(false);
      const _0x505379=()=>options.wallpaper?options.wallpaper():Promise.resolve(false);
      const _0xde2853=()=>'';
      // The upstream UI names its Wi-Fi calls after iOS toolkit commands.
      // Fulfil those reads from the same upstream encrypted LAN XML interface
      // used by the rest of the app; never dispatch a toolkit/cloud command.
      async function _0x2c7b30(command,_params,timeout){
        let indices;
        if(command==='GET_WIFI_LIST_INFO')indices=['1','5'];
        else if(command==='GET_GUEST_WIFI_LIST_INFO')indices=['3','7'];
        else throw Error('Unsupported command: '+String(command));
        const paths={};
        for(const index of indices){
          paths['ssid'+index]='WiFi.SSID.'+index+'.SSID';
          paths['pwd'+index]='WiFi.AccessPoint.'+index+'.Security.PreSharedKey';
          paths['enable'+index]='WiFi.SSID.'+index+'.Enable';
          if(index==='1'||index==='5')paths['advert'+index]='WiFi.AccessPoint.'+index+'.SSIDAdvertisementEnabled';
        }
        if(command==='GET_WIFI_LIST_INFO'){
          paths.sta='WiFi.WifiBandSteering.Enable';
          paths.mlo='WiFi.X_FH_MultiLinkGroup.1.Enable';
        }
        const data=await _0x3d8483(base,'get_value_by_xmlnode',paths,false,timeout||10000);
        if(!data||data._error)return null;
        const WIFIList=indices.map(index=>({
          SSIDIndex:index,SSID:String(data['ssid'+index]||''),PWD:String(data['pwd'+index]||''),
          Enable:String(data['enable'+index]??'1'),AdvertisementEnable:String(data['advert'+index]??'1'),
          Channel:'0',Bandwidth:'20MHz',Type:'0',PowerLevel:'100',Mode:'1',ENCRYPT:'4'
        }));
        return {resultCode:0,WIFIList,StaCtrl:String(data.sta??'0'),MloCtrl:String(data.mlo??'0')};
      }
      const _0x578483=()=>{}; // Do not forward upstream packet/account diagnostics to Android logs.
      async function _0x403514(host,requestPath,opt) {
        opt=opt||{};
        if(options.address(host)!==base)throw Error('设备地址已变化');
        const headers={'User-Agent':'Mozilla/5.0','Referer':opt.referer||base+'/main.html','X-Requested-With':'XMLHttpRequest','Accept':'application/json, text/javascript, */*; q=0.01'};
        // Keep upstream headers unchanged. Adding Origin in the Android port
        // caused GET session refresh to return 204 on the connected firmware.
        diagnostic.path=requestPath.split('?')[0]+(/ajaxmethod=([^&]+)/.exec(requestPath)?.[0]?'?'+/ajaxmethod=([^&]+)/.exec(requestPath)[0]:'');
        if(opt.body!=null)headers['Content-Type']='application/json; charset=UTF-8';
        try {
          if(options.isActive&&!options.isActive())throw Object.assign(Error('旧会话已取消'),{code:'STALE'});
          const authRequest=String(opt.method||'GET').toUpperCase()==='POST'&&(/\/sign\/DO_WEB_LOGIN(?:\?|$)/.test(requestPath)||opt.body&&typeof opt.body==='object'&&opt.body.ajaxmethod==='app_do_login');
          if(authRequest&&!connecting&&!reconnectAllowed)return null;
          const response=await options.fetch(base+requestPath,{method:opt.method||'GET',headers,body:opt.body==null?undefined:typeof opt.body==='string'?opt.body:JSON.stringify(opt.body),timeoutMs:opt.timeoutMs||4000});
          diagnostic.status=Number(response.status)||0;
          if(!response.ok)return null;
          const text=await response.text();
          if(/\/heartbeat(?:\?|$)/.test(requestPath))diagnostic.heartbeat=/^\d+$/.test(String(text).trim())?String(text).trim().slice(0,6):'非数字响应';
          return opt.raw?text:JSON.parse(text);
        }catch(e){return null;}
      }

      // @UPSTREAM_LOCAL_DECLARATIONS@

      // Header label: shared rule (network_mode.js). NSA is matched before SA,
      // only NR carriers count toward 5GA, and an unreported mode stays "--".
      const NetworkMode=typeof module!=='undefined'?require('./network_mode.js'):root.NetworkMode;
      const nrCarriers=carriers=>(Array.isArray(carriers)?carriers:[]).map(c=>({rat:/^n/i.test(String(c&&c.band||''))?'nr':'lte',dlMHz:String(c&&c.bandwidth||'').replace(/^DL\s*/i,'')}));
      _0x599085=function(value){return NetworkMode.label(value,[]);};
      _0x64e5ff=function(value,carriers){return NetworkMode.label(value,Array.isArray(carriers)?nrCarriers(carriers):[]);};

      // Upstream's session helper only honored web profiles and silently fell
      // back to /api for a detected tool profile. Keep the selected route all
      // the way through authentication.
      const upstreamToolSession=_0x30127f;
      _0x30127f=async function(host,timeout){
        const selected=(await _0x1a0c06(host)).profile;
        if(!selected||selected.mode!=='tool'||!selected.sid)return upstreamToolSession(host,timeout);
        for(let attempt=0;attempt<3;attempt++){
          const response=await _0x403514(host,selected.sid,{timeoutMs:timeout||3000});
          if(response&&response.sessionid)return response.sessionid;
          if(attempt<2)await _0x1bc2d5(attempt===0?600:1200);
        }
        return null;
      };
      // Guard the actual authentication entry points, including the tool path
      // that bypasses ensure(). Healthy session checks remain available.
      for(const [get,set] of [
        [()=>_0x20819e,fn=>{_0x20819e=fn;}],
        [()=>_0x5ca67b,fn=>{_0x5ca67b=fn;}],
        [()=>_0x4fafb7,fn=>{_0x4fafb7=fn;}]
      ]){const original=get();set(function(...args){return !connecting&&!reconnectAllowed?Promise.resolve('expired'):original(...args);});}
      // Drain upstream MAC prefetch before releasing the Android transaction
      // queue; a fresh session GET must not overtake a pending encrypted POST.
      const pendingOperations=new Set(),upstreamRequest=_0x3d8483;
      _0x3d8483=function(...args){
        const job=upstreamRequest(...args);pendingOperations.add(job);
        job.then(()=>pendingOperations.delete(job),()=>pendingOperations.delete(job));return job;
      };
      async function drain(){while(pendingOperations.size)await Promise.allSettled([...pendingOperations]);}
      function error(reason){
        const messages={nopass:'请输入设备管理密码',unreachable:'无法连接 CPE',occupied:'已有其他用户登录',locked:'账号被锁定',disabled:'设备账号已禁用',login:'用户名或密码错误',limited:'登录次数受限，请稍后重试',expired:'登录已失效',session:'登录后会话验证失败',empty:'设备响应不完整',nolib:'设备登录响应格式不匹配',fail:'登录失败'};
        const code=['locked','disabled','login','limited'].includes(reason)?'AUTH_REJECTED':reason==='occupied'?'AUTH_BUSY':'SESSION_EXPIRED';
        const details=reason==='session'||reason==='expired'?'（'+(diagnostic.line||'当前线路')+'，心跳 '+(diagnostic.heartbeat||'无响应')+'）':reason==='unreachable'?'（阶段：'+diagnostic.stage+'，HTTP '+diagnostic.status+'，'+diagnostic.path+'）':'';
        return Object.assign(Error((messages[reason]||'设备连接失败：'+String(reason||'未知'))+details),{code,reason,diagnostic:Object.assign({},diagnostic)});
      }
      return {
        async connect(user,password) {
          account=Object.assign({},account,{host:base,user,pass:password});
          _0x2fa85b=String(user||'').trim().toLowerCase();connecting=true;
          try {
            if(!String(password||''))throw error('nopass');
            diagnostic={stage:'线路探测',status:0,heartbeat:'',line:''};
            const selected=(await _0x1a0c06(base)).profile;
            diagnostic.line=selected.label;diagnostic.stage='账号登录';
            // _0x58da7d is a base-info/test entry, NOT an unconditional login:
            // anonymous tool data can short-circuit it, or missing /api sid can
            // fail it before the valid encrypted /fh_api login is attempted.
            // Call upstream's actual auth entry for the detected route instead.
            _0x236325=false;_0x5531d8=0;_0x46803e=false;_0x50f71f=0;
            let authenticated;
            if(selected.mode==='tool'){
              let status=await _0x4fafb7(base,account);
              // Some tool-route firmwares omit remaincount on ordinary login
              // rejection. Upstream treated a missing value as zero and falsely
              // reported rate limiting. Only accept "limited" when the device
              // explicitly returns result 9 or an exhausted remaincount.
              if(status==='limited'){
                let reply={};try{reply=JSON.parse(String(_0x3fade3&&_0x3fade3.body||'{}'));}catch(_){ }
                const result=reply.login_result!==undefined?reply.login_result:reply.result;
                const explicitLimit=Number(result)===9||Object.prototype.hasOwnProperty.call(reply,'remaincount')&&Number(reply.remaincount)<=0;
                if(!explicitLimit)status=_0x248216(result)||'login';
              }
              authenticated=status==='ok';
              if(!authenticated)throw error(status||'fail');
            }else{
              authenticated=await _0x2ae0a1(base,account,true,{knownDead:true});
              if(!authenticated)throw error(_0x474b68||'fail');
            }
            diagnostic.stage='会话验证';
            if(selected.mode==='enc'||selected.mode==='legacy'){
              let valid=false;
              for(let attempt=0;attempt<3;attempt++){
                if(attempt)await _0x1bc2d5(attempt===1?250:750);
                if(await _0x200899(base)){valid=true;break;}
              }
              if(!valid)throw error('session');
            }
            let data={};
            if(selected.mode!=='tool'){
              diagnostic.stage='登录后回读';
              data=await _0x3d8483(base,'get_value_by_xmlnode',{modelName:'DeviceInfo.ModelName'});
              if(!data||!String(data.modelName||data.ModelName||'').trim())throw error('empty');
            }
            await drain();diagnostic.stage='已连接';return {result:0,data,line:Object.assign({},selected)};
          }finally{connecting=false;}
        },
        async request(schema,endpoint) {
          const kind=endpoint&&/FHNCAPIS/.test(endpoint)?'dataNull':undefined;
          const result=await _0x3d8483(base,schema.ajaxmethod,schema.dataObj,!!schema.multipost,undefined,undefined,kind);
          if(result==null)throw error(_0x474b68||_0x3abdfd||'session');
          await drain();
          return result;
        },
        async probe() {
          const selected=(await _0x1a0c06(base)).profile;
          if(selected.mode==='enc'||selected.mode==='legacy'){
            if(!await _0x200899(base))throw error('expired');
          }else{
            const sid=await _0x30127f(base);
            if(!sid)throw error('unreachable');
            const result=await _0x403514(base,_0x53fe55(base)+'?ajaxmethod=app_get_base_info&sessionid=',{timeoutMs:4000});
            if(!result||!(result.NR_Band||result.BAND||result.RSSI||result.modelName))throw error('expired');
          }
          return true;
        },
        async path(path) {
          const selected=(await _0x1a0c06(base)).profile;
          return path.replace('/fh_api/tmp/FHNCAPIS',selected.dataNull).replace('/fh_api/tmp/FHAPIS',selected.dataObj);
        },
        async line(){return Object.assign({},(await _0x1a0c06(base)).profile);},
        async sample(){
          const result=await _0x35200b();
          if(!result||!result.rawData)throw error(result&&result.error||'empty');
      const data=_0x10dc89(result.rawData,result.remoteCa,result._topoFail?null:result.topoData);
      if((!data.deviceName||data.deviceName==='--')&&result.rawData.__sim&&result.rawData.__sim.pname)data.deviceName=String(result.rawData.__sim.pname);
          try{
            const identity=await _0x3d8483(base,'get_value_by_xmlnode',{
              serialNumber:'DeviceInfo.SerialNumber',deviceName:'DeviceInfo.Description'
            });
            if(identity){
              data.deviceSN=String(identity.serialNumber||identity.SN||data.deviceSN||'--');
              const name=identity.deviceName;if(name)data.deviceName=String(name);
            }
          }catch(_){ }
          await drain();return data;
        },
        async speed(){const result=await _0x241e4f();await drain();return result;},
        async action(message){await _0x5a020f(message);await drain();},
        async initialize(){
          await _0x55b11f();
          await _0x5a020f({action:'getUiPrefs'});
          await _0x5a020f({action:'getHomeCards'});
        },
        async refreshControl(){await _0x2becd7(true);await drain();},
        setReconnect(value){reconnectAllowed=!!value;},
        // Expose upstream pure primitives for byte-for-byte capture regressions.
        codec:{deriveKey:_0x51b1ef,pack:_0x5d3648,unpack:_0x4e26c4,networkMode:_0x64e5ff},
        storageKeys:{wifi:_0x2d3a24},
        profiles:_0x2857a9.map(p=>Object.assign({},p))
      };
    }
  };
  if(typeof module!=='undefined')module.exports=root.UpstreamLocal;
})(globalThis);
