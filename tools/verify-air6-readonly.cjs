/* Explicit opt-in real-device check. Reads only; credentials stay in memory. */
const fs=require('node:fs'),assert=require('node:assert/strict');
const {address}=require('../app/src/main/assets/lan_api.js');
const {normalize}=require('../app/src/main/assets/air6_api.js');
async function main(){
  const [capture,host]=process.argv.slice(2);
  if(!capture||!host)throw Error('Usage: node tools/verify-air6-readonly.cjs <request-file> <LAN-IP>');
  const base=address(host),raw=fs.readFileSync(capture,'utf8');
  const cookie=/^Cookie:\s*([^\r\n]+)/im.exec(raw)?.[1];
  const captureHost=/^Host:\s*([^\r\n]+)/im.exec(raw)?.[1]?.trim();
  if(!cookie||captureHost!==new URL(base).host)throw Error('Request must contain a Cookie for this same LAN host');
  const data={};
  const methods=['get_device_info','get_lcd_info','get_bandinfo_fast','get_cainfo','get_cellinfo','get_signalstrength','get_throughput','get_client_count','get_sim_qci','traffic_total','traffic_daily','get_bandmode_str','get_rat','get_celllock','get_celllock_list'];
  for(const method of methods){
    const r=await fetch(base+'/cgi-bin/luci/admin/modem/cmodem/api?method='+method,{method:'GET',headers:{Cookie:cookie},redirect:'manual',signal:AbortSignal.timeout(25000)});
    if(!r.ok)throw Error(method+': HTTP '+r.status);
    data[method]=await r.json();
    if(data[method].code!==undefined&&Number(data[method].code)!==200)throw Error(method+': API error');
  }
  assert.ok(data.get_device_info.device_info);assert.ok(data.get_bandmode_str.support_nr_band);assert.ok(data.get_rat.rat);
  const board=normalize(data);assert.equal(board.deviceModel,'Air6');assert.ok(Array.isArray(board.carriers));assert.ok(Array.isArray(board.allCells));
  assert.ok(board.downSpeed===null||Number(board.downSpeed)>=0);
  console.log(JSON.stringify({readEndpoints:methods.length,deviceSchema:'PASS',bandSchema:'PASS',controlSchema:'PASS',boardMapping:'PASS',carrierCount:board.carriers.length,cellCount:board.allCells.length,writes:0,credentialsSaved:false}));
}
main().catch(e=>{console.error(e.name==='AssertionError'?'Air6 schema assertion failed':e.message);process.exitCode=1;});
