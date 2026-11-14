/* Build-time extraction. Never executes the upstream application or updater. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const acorn=require('acorn'),walk=require('acorn-walk'),{generate}=require('astring');
const revision='fba4e87a78261080cbdaca5eb2e51d3ebd2415f9';
const cache=path.join(__dirname,'.upstream-cache');
const digest=text=>crypto.createHash('sha256').update(text).digest('hex');
const parse=source=>acorn.parse(source,{ecmaVersion:'latest'});
async function get(url){const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Upstream HTTP '+r.status);return r.text();}
function rc4(input,key){
  const table=Array.from({length:256},(_,i)=>i);let j=0;
  for(let i=0;i<256;i++){j=(j+table[i]+key[i%key.length])&255;[table[i],table[j]]=[table[j],table[i]];}
  let i=0;j=0;return Buffer.from(input.map(value=>{i=(i+1)&255;j=(j+table[i])&255;[table[i],table[j]]=[table[j],table[i]];return value^table[(table[i]+table[j])&255];}));
}
async function currentCore(){
  const response=await get('https://api.github.com/repos/vaeann/FHCpeBoard/commits/main');
  const head=JSON.parse(response).sha;
  const launcher=await get('https://raw.githubusercontent.com/vaeann/FHCpeBoard/'+head+'/FHCpeBoard/index.tsx');
  const part=name=>{const m=new RegExp(name+"=urlDecode\\('([a-f0-9]+)'\\)").exec(launcher);if(!m)throw Error('Unknown current launcher');return Buffer.from(m[1],'hex').toString();};
  const payload=JSON.parse(await get(part('_dn')+part('_kd')+'/app1.js'+part('_sg')));
  const key=Buffer.from(/restoreKey\('([a-f0-9]+)'\)/.exec(launcher)[1],'hex').map(x=>x^0x5a);
  return {head,source:rc4(Buffer.from(payload.ct,'base64'),key).toString()};
}
async function acquire(){
  fs.mkdirSync(cache,{recursive:true});
  const ref=path.join(cache,'core.reference.js');
  if(fs.existsSync(ref))return fs.readFileSync(ref,'utf8');
  const root='https://raw.githubusercontent.com/vaeann/FHCpeBoard/'+revision+'/FHCpeBoard/';
  const [launcher,html,version]=await Promise.all([get(root+'index.tsx'),get(root+'fhcpeweb.html'),get(root+'version.json')]);
  const part=name=>{const m=new RegExp(name+"=urlDecode\\('([a-f0-9]+)'\\)").exec(launcher);if(!m)throw Error('Unknown upstream URL encoding');return Buffer.from(m[1],'hex').toString();};
  const payload=JSON.parse(await get(part('_dn')+part('_kd')+'/app1.js'+part('_sg')));
  const encoded=/restoreKey\('([a-f0-9]+)'\)/.exec(launcher);if(!encoded||!payload.ct)throw Error('Unknown upstream payload format');
  const key=Buffer.from(encoded[1],'hex').map(x=>x^0x5a),source=rc4(Buffer.from(payload.ct,'base64'),key).toString();
  const cut=source.indexOf(',((async()=>{');if(cut<0)throw Error('Unknown upstream core boundary');
  // Evaluate ONLY the string table/decoder and its array rotation. Omit image
  // assignments; no main function, IO bridge, timers or fetch exists in the VM.
  const prefix=parse(source.slice(0,cut)+');');
  const decoder=prefix.body.filter(n=>n.type==='FunctionDeclaration'||n.type==='ExpressionStatement'&&n.expression.type==='CallExpression'&&n.expression.callee.type==='FunctionExpression');
  const scope=vm.createContext({});vm.runInContext(decoder.map(n=>generate(n)).join('\n'),scope,{timeout:1500});
  if(typeof scope._0x5acc!=='function')throw Error('Unknown upstream string decoder');
  const ast=parse(source),aliases=new Set(['_0x5acc']);let changed=true;
  while(changed){changed=false;walk.simple(ast,{VariableDeclarator(n){if(n.id.type==='Identifier'&&n.init?.type==='Identifier'&&aliases.has(n.init.name)&&!aliases.has(n.id.name)){aliases.add(n.id.name);changed=true;}}});}
  walk.simple(ast,{CallExpression(n){if(n.callee.type==='Identifier'&&aliases.has(n.callee.name)&&n.arguments.length===1&&n.arguments[0].type==='Literal'){
    const value=scope._0x5acc(n.arguments[0].value);for(const key of Object.keys(n))delete n[key];Object.assign(n,{type:'Literal',value,raw:JSON.stringify(value)});
  }}});
  let body;walk.simple(ast,{ArrowFunctionExpression(n){if(n.async&&n.body.type==='BlockStatement'&&n.body.body.some(s=>s.type==='FunctionDeclaration'&&s.id.name==='_0x58da7d'))body=n.body;}});
  if(!body)throw Error('Unknown local entrypoint');
  function clean(node){
    if(!node||typeof node!=='object')return;
    if(node.type==='VariableDeclaration'){
      node.declarations=node.declarations.filter(d=>!(d.id.type==='Identifier'&&aliases.has(d.id.name)&&d.init?.type==='Identifier'&&aliases.has(d.init.name)));
      if(!node.declarations.length){node.type='EmptyStatement';delete node.declarations;delete node.kind;return;}
    }
    for(const v of Object.values(node))if(Array.isArray(v))v.forEach(clean);else if(v&&typeof v==='object')clean(v);
  }
  clean(body);
  const decoded='async function upstreamCoreReference() '+generate(body);
  fs.writeFileSync(ref,decoded);fs.writeFileSync(path.join(cache,'upstream.html'),html);
  fs.writeFileSync(path.join(cache,'provenance.json'),JSON.stringify({repository:'vaeann/FHCpeBoard',revision,version:JSON.parse(version).ver,coreSha256:digest(source),htmlSha256:digest(html),retrieved:new Date().toISOString(),note:'Core is an external resource referenced by the pinned launcher; exact content is identified separately by SHA-256.'},null,2)+'\n');
  return decoded;
}
function declarations(source){
  const ast=parse(source),body=ast.body[0].body,entries=new Map();
  for(const s of body.body){
    if(s.type==='FunctionDeclaration')entries.set(s.id.name,s);
    if(s.type==='VariableDeclaration')for(const d of s.declarations)if(d.id.type==='Identifier')entries.set(d.id.name,{...s,declarations:[d]});
  }
  return {entries,body};
}
function dependencies(node,entries){const names=new Set();walk.full(node,n=>{if(n.type==='Identifier'&&entries.has(n.name))names.add(n.name);});return [...names];}
async function main(){
  const source=await acquire(),{entries}=declarations(source),mode=process.argv[2]||'--summary';
  if(mode==='--verify-live'){
    const live=await currentCore(),provenance=JSON.parse(fs.readFileSync(path.join(cache,'provenance.json'),'utf8'));
    console.log(JSON.stringify({head:live.head,sha256:digest(live.source),matchesPinnedCore:digest(live.source)===provenance.coreSha256}));
    if(digest(live.source)!==provenance.coreSha256)throw Error('Current core changed; re-import is required');
    let images;walk.simple(parse(live.source),{AssignmentExpression(n){if(n.left.type==='MemberExpression'&&(n.left.property.name||n.left.property.value)==='__DEV_IMG_BUILTIN__')images=n.right;}});
    if(!images||images.type!=='ObjectExpression'||images.properties.some(p=>p.type!=='Property'||p.value.type!=='Literal'||typeof p.value.value!=='string'||!p.value.value.startsWith('data:image/')))throw Error('Non-static embedded image format');
    const artifact='/* Original upstream embedded device images; no external URLs. */\nwindow.__DEV_IMG__='+generate(images)+';';
    fs.writeFileSync(path.resolve(__dirname,'../app/src/main/assets/upstream_images.js'),artifact);
    require('./import-device-images.cjs');
    console.log('Imported '+images.properties.length+' static upstream device images.');
  }else if(mode==='--summary'){
    console.log('Cached static reference; no upstream application was executed.');
    for(const [name,n]of entries){const code=generate(n);if(/\/fh_api|local|Local|局域网|DO_WEB_LOGIN|heartbeat/.test(code)&&code.length<18000)console.log(name,code.length,code.slice(0,110).replace(/\n/g,' '));}
  }else if(mode==='--show'){
    for(const name of process.argv.slice(3)){const n=entries.get(name);if(!n)throw Error('Missing declaration '+name);console.log(generate(n));console.log('DEPS '+dependencies(n,entries).join(' '));}
  }else if(mode==='--find'){
    const term=process.argv[3];for(const [name,n]of entries){const code=generate(n);if(code.includes(term))console.log(name,code.length,code.slice(Math.max(0,code.indexOf(term)-160),code.indexOf(term)+500));}
  }else if(mode==='--build'){
    const boundaries=new Set(['_0x403514','_0x578483','_0x16e738','_0x48240a','_0x4f44fb','_0x2c7b30','_0x3ed42d','_0x4f1a06','_0x32dbea','_0x505379','_0xde2853']);
    const roots=['_0x58da7d','_0x3d8483','_0x200899','_0x30127f','_0x53fe55','_0x1a0c06','_0x2ae0a1','_0x5a020f','_0x35200b','_0x10dc89'];
    const originals=new Map(entries),{transform}=require('./local-only-transform.cjs');
    for(const [name,node]of entries)entries.set(name,transform(node));
    const selected=new Set();
    function visit(name){if(selected.has(name)||boundaries.has(name))return;const node=entries.get(name);if(!node)throw Error('Unresolved declaration '+name);selected.add(name);dependencies(node,entries).forEach(visit);}
    roots.forEach(visit);
    const included=[...entries].filter(([name])=>selected.has(name));
    const declarationsText=included.map(([,node])=>generate(node)).join('\n');
    const shim=fs.readFileSync(path.join(__dirname,'upstream-local-shim.js'),'utf8');
    const artifact='/* Generated from vaeann/FHCpeBoard '+revision+'; local-only dependency closure. */\n'+shim.replace('// @UPSTREAM_LOCAL_DECLARATIONS@',declarationsText);
    if(/mifon|invokeService|activateWithCode|activation|fetchCloud|restoreKey|SYMMETRIC_KEY|CPE_LIC|new Request\(/i.test(artifact)){
      console.error(included.filter(([,n])=>/mifon|invokeService|activateWithCode|activation|fetchCloud|restoreKey|SYMMETRIC_KEY|CPE_LIC|new Request\(/i.test(generate(n))).map(([name])=>name));
      throw Error('Cloud/activation code reached local module');
    }
    new vm.Script(artifact,{filename:'upstream_local.js'});
    const assets=path.resolve(__dirname,'../app/src/main/assets');
    fs.writeFileSync(path.join(assets,'upstream_local.js'),artifact);
    const provenance=JSON.parse(fs.readFileSync(path.join(cache,'provenance.json'),'utf8'));
    const manifest={...provenance,roots,platformBoundaries:[...boundaries],declarations:included.map(([name,node])=>({name,sha256:digest(generate(node)),originalSha256:digest(generate(originals.get(name)))})),artifactSha256:digest(artifact)};
    fs.writeFileSync(path.resolve(__dirname,'../docs/upstream-local-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    console.log('Generated local-only module: '+included.length+' original declarations, '+Buffer.byteLength(artifact)+' bytes; cloud/activation scan passed.');
  }else throw Error('Unknown mode');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={acquire,declarations,dependencies,revision,digest,cache};
