/* Build-time specialization: remove non-LAN branches, never execute source. */
const {generate}=require('astring');
const localFlags=new Map([['_0x20cf32',true],['_0x3b413e',true],['_0x45c827','local'],['_0x81c3c2','local']]);
const managed=new Set(['getChangelog','probePoll','speedPoll','initFlow','refresh','getTokenStatus','getLineConfig','setLineMode','saveLocalAccounts','reloginNow','testLocalConnection','saveAccountConfig','activateWithCode','selectDevice','refreshAfterSwitch','fetchDevOperators','pickWallpaper','clearWallpaper','getDiagLog','renameDevice']);
function literal(value){return {type:'Literal',value,raw:JSON.stringify(value)};}
function value(n){
  if(n?.type==='Literal')return {known:true,value:n.value};
  if(n?.type==='ArrayExpression'&&!n.elements.length)return {known:true,value:[]};
  if(n?.type==='UnaryExpression'&&n.operator==='!'){const v=value(n.argument);if(v.known)return {known:true,value:!v.value};}
  return {known:false};
}
function ends(n){return n&&(n.type==='ReturnStatement'||n.type==='ThrowStatement'||n.type==='BlockStatement'&&ends(n.body.at(-1))||n.type==='IfStatement'&&n.alternate&&ends(n.consequent)&&ends(n.alternate));}
const isLit=(n,v)=>n&&n.type==='Literal'&&n.value===v;
const keyName=p=>p&&p.type==='Property'&&(p.key.name||p.key.value);
// Header network mode (see app/src/main/assets/network_mode.js):
// - an unreported WorkMode must not default to 5G SA, and
// - a band number must not be used to guess the radio (n28/n1 are 5G; B41 is LTE).
// Rewrite `WorkMode: X || 'SA'` and `WorkMode: X || (band<40?'LTE':'SA')` to `WorkMode: X || ''`,
// and pass the carrier list (not just its length) to the mode label.
function networkMode(n){
  if(n.type==='Property'&&keyName(n)==='WorkMode'&&n.value.type==='LogicalExpression'&&n.value.operator==='||'){
    const r=n.value.right;
    if(isLit(r,'SA')||r.type==='ConditionalExpression')n.value.right=literal('');
  }
  if(n.type==='CallExpression'&&n.callee.name==='_0x64e5ff'&&n.arguments.length===2){
    const a=n.arguments[1];
    if(a.type==='MemberExpression'&&(a.property.value==='length'||a.property.name==='length'))n.arguments[1]=a.object;
  }
  return n;
}
function transform(input){
  const node=structuredClone(input);
  if(node.type==='FunctionDeclaration'&&node.id.name==='_0x5a020f')node.body.body=node.body.body.filter(s=>!(s.type==='IfStatement'&&[...managed].some(a=>new RegExp('[\"\x27]'+a+'[\"\x27]').test(generate(s.test)))));
  function visit(n){
    if(!n||typeof n!=='object')return n;
    for(const [k,v] of Object.entries(n)){
      if(Array.isArray(v))n[k]=v.map(x=>visit(x));
      else if(v&&typeof v==='object')n[k]=visit(v);
    }
    networkMode(n);
    if(n.type==='CallExpression'&&localFlags.has(n.callee.name))return literal(localFlags.get(n.callee.name));
    if(n.type==='UnaryExpression'&&n.operator==='!'){const v=value(n);if(v.known)return literal(v.value);}
    if(n.type==='ConditionalExpression'){const t=value(n.test);if(t.known)return t.value?n.consequent:n.alternate;}
    if(n.type==='LogicalExpression'){
      const l=value(n.left);if(l.known){if(n.operator==='&&')return l.value?n.right:n.left;if(n.operator==='||')return l.value?n.left:n.right;}
    }
    if(n.type==='IfStatement'){const t=value(n.test);if(t.known)return t.value?n.consequent:n.alternate||{type:'EmptyStatement'};}
    if(n.type==='BlockStatement'){
      const body=[];
      for(const s of n.body){
        if(s.type==='BlockStatement')body.push(...s.body);else if(s.type!=='EmptyStatement')body.push(s);
        if(ends(s))break;
      }
      n.body=body;
    }
    return n;
  }
  // Repeat to propagate returns through blocks introduced by specialization.
  for(let i=0;i<4;i++)visit(node);
  return node;
}
module.exports={transform,managed};
