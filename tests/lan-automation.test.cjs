const {test}=require('node:test'),assert=require('node:assert/strict');
const ui=require('../app/src/main/assets/air6_automation.js');
test('task schedule supports daily, weekly, custom rules and rejects an empty week',()=>{
 assert.equal(ui.expression('daily','02:05',[],''),'5 2 * * *');assert.equal(ui.expression('weekly','23:59',['1','3','0'],''),'59 23 * * 1,3,0');assert.equal(ui.expression('custom','02:00',[],' 0 */6 * * * '),'0 */6 * * *');assert.throws(()=>ui.expression('weekly','02:00',[],''),/至少/);assert.throws(()=>ui.expression('daily','24:00',[],''),/执行时间/);
});
test('task preview and execution times follow device offset instead of the phone zone',()=>{
 assert.equal(ui.deviceTime(1,28800),'1970-01-01 08:00');assert.equal(ui.deviceTime(1,-18000),'1969-12-31 19:00');assert.equal(ui.deviceTime(null,28800),'暂无');assert.equal(ui.summary({action:'pci',params:{mode:'unlock'}}),'解除小区锁定');assert.equal(ui.summary({action:'rat',params:{rat:'15'}}),'网络制式 · 仅 5G');
});
const fs=require('node:fs'),vm=require('node:vm'),parse5=require('../tools/node_modules/parse5');
function editor(){
 const ids=new Map(),timers=new Map(),saved=[],previews=[];let serial=0,dirty=false,busy=false,message='';
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.dataset={};this._text='';this._value=undefined;this.checked=false;}
  set id(v){this._id=v;ids.set(v,this);}get id(){return this._id;}
  set value(v){this._value=String(v);}get value(){return this._value??(this.tagName==='SELECT'?(this.children.find(n=>n.selected)||this.children[0])?.value||'':'');}
  set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
  appendChild(n){this.children.push(n);n.parentNode=this;return n;}
  set innerHTML(html){this.children=[];this._text='';const build=n=>{if(n.nodeName==='#text'){const t=new Element('text');t._text=n.value;return t;}const e=new Element(n.tagName||'div');for(const a of n.attrs||[]){if(a.name==='id')e.id=a.value;else if(a.name==='style'){for(const pair of a.value.split(';')){const [k,v]=pair.split(':');if(k)e.style[k.trim()]=(v||'').trim();}}else if(a.name==='checked'||a.name==='selected')e[a.name]=true;else if(a.name.startsWith('data-'))e.dataset[a.name.slice(5).replace(/-([a-z])/g,(_,v)=>v.toUpperCase())]=a.value;else e[a.name]=a.value;}for(const c of n.childNodes||[])e.appendChild(build(c));return e;};for(const n of parse5.parseFragment(html).childNodes)this.appendChild(build(n));}
  querySelectorAll(q){const list=this.children.flatMap(n=>[n,...n.querySelectorAll('*')]);return q==='*'?list:list.filter(n=>q==='input'?n.tagName==='INPUT':q==='input:checked'?n.tagName==='INPUT'&&n.checked:q==='[data-task-action]'?!!n.dataset.taskAction:false);}
 }
 const document={getElementById:id=>ids.get(id),createElement:tag=>new Element(tag)},c={document,module:{exports:{}},setTimeout:fn=>{const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)};vm.createContext(c);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../app/src/main/assets/air6_automation.js'),'utf8'),c);
 const scheduler=new Element('section'),failover=new Element('section'),controller=c.Air6AutomationUI.create({scheduler,failover,busy:()=>busy,editing:v=>dirty=v,message:v=>message=v,save:(payload,confirm)=>saved.push({payload:JSON.parse(JSON.stringify(payload)),confirm}),preview:p=>previews.push(p)});
 return {controller,el:id=>ids.get(id),scheduler,failover,saved,previews,get dirty(){return dirty;},flushPreview(){const entries=[...timers.values()];timers.clear();entries.forEach(fn=>fn());},setBusy:v=>busy=v,get message(){return message;}};
}
test('editing an existing task preserves its id, serializes weekday changes and retains input after rejection',()=>{
 const h=editor(),task={id:'task-1',name:'old',enabled:true,cron:'0 2 * * *',action:'rat',params:{rat:'15'}};
 h.controller.render({ok:true,kind:'scheduler',scheduler:{service_running:true,tasks:[task]},bands:{support_lte_band:'1/3',support_nr_band:'28/41'}});
 const findButton=(n,label)=>n.children.flatMap(c=>[c,...(c.children?findAll(c):[])]).find(c=>c.tagName==='BUTTON'&&c.textContent===label);function findAll(n){return n.children.flatMap(c=>[c,...findAll(c)]);}
 findButton(h.el('air6TaskList'),'编辑').onclick();h.el('air6TaskName').value='edited';h.el('air6TaskEnabled').checked=false;h.el('air6TaskTiming').value='weekly';h.el('air6TaskTiming').onchange();h.el('air6TaskTime').value='03:15';h.el('air6TaskDays').querySelectorAll('input').forEach(n=>n.checked=['1','3'].includes(n.value));h.el('air6TaskAction').value='unlock';h.el('air6TaskUnlock').value='band';h.el('air6TaskSave').onclick();
 assert.deepEqual(h.saved[0].payload.task,{id:'task-1',name:'edited',enabled:false,cron:'15 3 * * 1,3',action:'unlock',params:{target:'band'}});
 h.controller.render({ok:false,kind:'scheduler',operation:'save',pending:false,message:'rejected'});assert.equal(h.el('air6TaskName').value,'edited');assert.equal(h.el('air6TaskEditor').style.display,'');assert.equal(h.el('air6TaskError').textContent,'rejected');assert.equal(h.dirty,true);h.controller.close();
});
test('saving one failover section preserves unsaved values in the other section',()=>{
 const h=editor(),state={service_running:true,kinds:{band:{enabled:true,timeout:90,phase:'idle'},pci:{enabled:true,timeout:90,phase:'idle'}}};h.controller.render({kind:'failover',ok:true,failover:state});
 h.el('air6FailoverEnabled_pci').checked=false;h.el('air6FailoverEnabled_pci').onchange();h.el('air6FailoverTimeout_band').value='120';h.el('air6FailoverTimeout_band').onchange();h.el('air6FailoverSave_band').onclick();assert.equal(h.saved[0].payload.target,'band');assert.equal(h.saved[0].payload.timeout,120);
 h.controller.render({kind:'failover',operation:'save',target:'band',ok:true,failover:{...state,kinds:{...state.kinds,band:{enabled:true,timeout:120,phase:'idle'}}}});assert.equal(h.el('air6FailoverEnabled_pci').checked,false);assert.equal(h.dirty,true);h.controller.close();
});
test('stale Cron preview cannot replace a newer rule or a closed editor',()=>{
 const h=editor();h.el('air6TaskAdd').onclick();h.flushPreview();const first=h.previews.at(-1).requestId;h.el('air6TaskTiming').value='custom';h.el('air6TaskCron').value='0 */6 * * *';h.el('air6TaskTiming').onchange();h.flushPreview();const second=h.previews.at(-1).requestId;assert.notEqual(first,second);
 h.controller.preview({requestId:first,ok:true,data:{next_run:1,utc_offset:0}});assert.match(h.el('air6TaskPreview').textContent,/正在计算/);h.controller.preview({requestId:second,ok:true,data:{next_run:1,utc_offset:28800,timezone:'+08'}});assert.match(h.el('air6TaskPreview').textContent,/1970-01-01 08:00/);h.controller.close();const before=h.el('air6TaskPreview').textContent;h.controller.preview({requestId:second,ok:false,message:'late'});assert.equal(h.el('air6TaskPreview').textContent,before);
});
