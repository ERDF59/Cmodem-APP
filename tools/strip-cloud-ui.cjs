/* Mechanical dashboard cleanup; keep a build-only source for reproducibility. */
const fs=require('node:fs'),path=require('node:path'),acorn=require('acorn'),walk=require('acorn-walk'),{generate}=require('astring'),html=require('parse5');
const cache=path.join(__dirname,'.upstream-cache'),asset=path.resolve(__dirname,'../app/src/main/assets/fhcpeweb.html');
fs.mkdirSync(cache,{recursive:true});const reference=path.join(cache,'dashboard.reference.html');
if(!fs.existsSync(reference))fs.copyFileSync(asset,reference);
const removed=new Set(['maskToken','getAcToken','getAcAccount','refreshTokenStatus','renderDeviceList','selectDevice','openAccountConfigModal','closeAccountConfigModal','saveAccountConfig','openActivateModal','closeActivateModal','copyActivateId','setAcActivateStatus','submitActivateCode','toggleAcEye','applyMaskFocus','initAcMaskInputs','updateAcEyeBtn','doAcFieldBtn','onAcFieldBtn','updateAcSaveBtn']);
const cloudCallbacks=new Set(['selectDeviceDone','updateTokenStatusCard','activateResult']);
function script(source){
  const ast=acorn.parse(source,{ecmaVersion:'latest'});
  ast.body=ast.body.filter(n=>!(n.type==='FunctionDeclaration'&&removed.has(n.id.name)));
  for(const n of ast.body)if(n.type==='ExpressionStatement'){
    let items=n.expression.type==='SequenceExpression'?n.expression.expressions:[n.expression];
    items=items.filter(e=>!(e.type==='AssignmentExpression'&&e.left.type==='MemberExpression'&&cloudCallbacks.has(e.left.property.name||e.left.property.value))&&!/^\["acAccount"/.test(generate(e)));
    if(!items.length){n.type='EmptyStatement';delete n.expression;}else n.expression=items.length===1?items[0]:{type:'SequenceExpression',expressions:items};
  }
  walk.simple(ast,{Identifier(n){if(removed.has(n.name))n.name=n.name==='openAccountConfigModal'?'lanShowLogin':'lanNoop';}});
  walk.simple(ast,{AssignmentExpression(n){
    if(n.left.type==='MemberExpression'&&cloudCallbacks.has(n.left.property.name||n.left.property.value)){
      for(const key of Object.keys(n))delete n[key];Object.assign(n,{type:'Literal',value:0,raw:'0'});
    }
    if(n.type==='AssignmentExpression'&&n.left.type==='MemberExpression'&&(n.left.property.name||n.left.property.value)==='renameResult'){
      n.right=acorn.parseExpressionAt('function(e){const b=document.getElementById("renameSaveBtn");if(b){b.disabled=false;b.textContent="保存";}if(e&&e.ok){const label=document.getElementById("setDeviceName");if(label)label.textContent=e.name;closeRenameModal();showUpdateToast("本地名称已保存","success");}else showUpdateToast(e&&e.msg||"名称保存失败","warning");}',0,{ecmaVersion:'latest'});
    }
  }});
  // This helper is still called by probeResult; it no longer renders a cloud list.
  const row=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='_refreshDeviceRowIfVisible');if(row)row.body.body=[];
  const generated=generate(ast);
  if(/activateWithCode|submitActivateCode|激活码|激活中|userLogin|invokeService/.test(generated))throw Error('Cloud activation code remains in dashboard');
  return 'function lanNoop(){}\n'+generated;
}
const tree=html.parse(fs.readFileSync(reference,'utf8'));
function clean(node){
  if(node.childNodes)node.childNodes=node.childNodes.filter(child=>!child.attrs?.some(a=>a.name==='id'&&['accountConfigModal','acActivateModal'].includes(a.value)));
  if(node.tagName==='script'&&node.childNodes?.length){const value=node.childNodes.map(n=>n.value||'').join('');if(value.trim()){node.childNodes=[{nodeName:'#text',value:script(value),parentNode:node}];}}
  if(node.attrs)for(const attr of node.attrs)if(attr.name.startsWith('on'))attr.value=attr.value.replace(/openAccountConfigModal/g,'lanShowLogin');
  for(const child of node.childNodes||[])clean(child);
}
clean(tree);const result=html.serialize(tree).replace(/改完同时写入设备和云端/g,'名称只保存在本机配置中').replace(/看板远程服务/g,'设备连接').replace(/设备远程服务/g,'设备连接').replace(/远程服务/g,'设备连接').replace(/看板服务远程重启/g,'设备连接刷新').replace(/约1分钟/g,'一段时间');
if(/activateWithCode|submitActivateCode|激活/.test(result))throw Error('Activation content remains');
fs.writeFileSync(asset,result);console.log('Removed cloud account/activation DOM and handlers from dashboard.');
