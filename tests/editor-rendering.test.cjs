const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  const frames = new Map(), timers = new Map(), writes = [], draws = [], attributes = [];
  let nextId = 1;
  class Node {
    constructor(tag = 'div', cls = '') {
      this.tagName = tag; this.className = cls; this.children = []; this.parentNode = null;
      this.attrs = {}; this.styles = {}; this.events = {}; this.textContent = '';
      this.clientWidth = 640; this.clientHeight = 320; this.scrollLeft = 0; this.scrollTop = 0;
      this.ctx = new Proxy({measureText: text => ({width: String(text).length * 6}),
        createLinearGradient: () => ({addColorStop() {}})}, {
        get: (target, name) => name in target ? target[name] : (...args) => draws.push({node:this, name, args})
      });
    }
    get childNodes() { return this.children; }
    get firstChild() { return this.children[0] || null; }
    appendChild(node) { if (node.parentNode) node.parentNode.removeChild(node); this.children.push(node); node.parentNode = this; return node; }
    removeChild(node) { this.children.splice(this.children.indexOf(node), 1); node.parentNode = null; return node; }
    insertBefore(node, before) { if (!before) return this.appendChild(node); if (node.parentNode) node.parentNode.removeChild(node); this.children.splice(this.children.indexOf(before),0,node); node.parentNode=this; }
    setAttribute(name, value) { attributes.push({node:this,name,value}); this.attrs[name] = String(value); if (name === 'class') this.className = String(value); if (name === 'id') this.id = String(value); }
    getAttribute(name) { return name === 'class' ? this.className : this.attrs[name] || null; }
    getContext() { return this.ctx; }
    getBoundingClientRect() { const w=this.tagName==='canvas'?(parseFloat(this.styles.width)||this.clientWidth):this.clientWidth; const h=this.tagName==='canvas'?(parseFloat(this.styles.height)||this.clientHeight):this.clientHeight; return {left:0,top:0,x:0,y:0,width:w,height:h,right:w,bottom:h}; }
    matches(selector) { return selector[0] === '.' ? this.className.split(/\s+/).includes(selector.slice(1)) : this.tagName === selector; }
    querySelectorAll(selector) { return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
    removeEventListener(type, fn) { this.events[type] = (this.events[type] || []).filter(item => item !== fn); }
    emit(type, event) { for (const fn of [...(this.events[type] || [])]) fn(event); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  }
  const document = new Node('document');
  document.body = document.appendChild(new Node('body'));
  document.getElementById = id => {
    const visit = node => node.id === id ? node : node.children.map(visit).find(Boolean);
    return visit(document) || null;
  };
  const host = new Node('window');
  host.requestAnimationFrame = fn => { const id = nextId++; frames.set(id, fn); return id; };
  host.cancelAnimationFrame = id => frames.delete(id);
  host.setTimeout = fn => { const id = nextId++; timers.set(id, fn); return id; };
  host.clearTimeout = id => timers.delete(id);
  const classes = (node, name, on) => {
    const set = new Set(node.className.split(/\s+/).filter(Boolean));
    if (on) set.add(name); else set.delete(name);
    node.className = [...set].join(' ');
  };
  const OZ = {host, env:{isAUI:false,dpr:1}, storage:{get:()=>null,set:()=>true},
    Icons:{render:()=>new Node('svg')}, ui:{toast(){}}, docTypes:{}, rt:{},
    util:{clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),snap:(v,s)=>Math.round(v/s)*s,
      fmtTime:v=>Number(v).toFixed(2),fmtNum:(v,n)=>Number(v).toFixed(n),clone:v=>JSON.parse(JSON.stringify(v))},
    event:{stop(){},pos:e=>e,key:e=>e.key},
    dom:{el:(tag,cls,text)=>{const n=new Node(tag,cls); if(text!=null)n.textContent=text; return n;},
      setStyle:(node,name,value)=>{node.styles[name]=value;writes.push({node,name,value});},
      sameNode:(a,b)=>a===b, clear:node=>{for(const n of [...node.children])node.removeChild(n);},
      addClass:(n,c)=>classes(n,c,true),removeClass:(n,c)=>classes(n,c,false),
      toggleClass:(n,c,on)=>classes(n,c,on),
      on:(n,t,f)=>n.addEventListener(t,f),off:(n,t,f)=>n.removeEventListener(t,f),
      rect:n=>n.getBoundingClientRect(),afterLayout:fn=>host.setTimeout(fn)},
    graph:{SNAP:16,nodeById:(g,id)=>g.nodes.find(n=>n.id===id),portKey:(n,d,p)=>[n,d,p].join(':'),
      estSize:()=>({w:200,h:120}),portsOfDir:()=>[{id:'pose'}]},
    shell:{updateStatus(){},setToolbarTime(){},updateAll(){}}
  };
  const context = vm.createContext({OZ,document,console,setTimeout:host.setTimeout,clearTimeout:host.clearTimeout});
  function load(name) { vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/main/resources/ozz/editor/js',name),'utf8'),context,{filename:name}); }
  function frame() { const batch=[...frames.values()]; frames.clear(); for(const fn of batch)fn(16); }
  function settle() { for(let i=0;frames.size && i<10;i++)frame(); assert.equal(frames.size,0); }
  function layout() { const batch=[...timers.values()]; timers.clear(); for(const fn of batch)fn(); }
  load('core/canvas-text.js');
  function paintedText(node) { return draws.filter(d=>d.node===node && d.name==='fillText').at(-1)?.args[0]; }
  return {OZ,document,Node,frames,timers,writes,draws,attributes,load,frame,settle,layout,paintedText};
}

test('link-only invalidation keeps the grid bitmap; resize, camera and replacement refresh it', () => {
  const h=harness(); h.load('graph/graph-canvas.js'); h.OZ.env.isAUI=true;
  const host=h.document.body.appendChild(new h.Node()); host.id='graph-host';
  const view=host.appendChild(new h.Node('div','oz-g-view'));
  const page={doc:{host},view:()=>({x:0,y:0,zoom:1}),resource:()=>({links:[]})};
  const canvas=new h.OZ.graph.Canvas(page); canvas.attach(view);
  let grids=0, links=0;
  canvas.paintGrid=()=>grids++; canvas.paintLinks=()=>links++;
  canvas.resize(); h.settle(); assert.equal(grids,1);
  for(let i=0;i<20;i++)canvas.invalidateLinks();
  assert.equal(h.frames.size,1); h.settle(); assert.equal(grids,1); assert.equal(links,2);
  canvas.invalidateGrid(); h.settle(); assert.equal(grids,2);
  view.clientWidth=800; canvas.resize(); h.settle(); assert.equal(grids,3);
  const old=view.querySelector('.oz-g-grid'); view.removeChild(old); view.appendChild(new h.Node('canvas','oz-g-grid'));
  canvas.invalidateLinks(); h.settle(); assert.equal(grids,4);
  canvas.clearColorCache(); h.settle(); assert.equal(grids,5);
  canvas.destroy(); assert.equal(h.frames.size,0);
});

function graphFixture() {
  const h=harness(); h.load('core/app.js'); h.load('graph/graph-canvas.js'); h.load('graph/graph-page.js');
  const app=new h.OZ.App(); app.setDirty=doc=>doc.dirty=true;
  const doc={resource:{nodes:[{id:'a',x:32,y:48},{id:'b',x:96,y:64}],links:[],view:{x:50,y:20,zoom:2}},undo:[],redo:[]};
  const page=h.OZ.docTypes.graph.create(app,doc); app.active=doc;
  doc.view={reload(){},showInspector(){}};
  page.showInspector=()=>{}; page.selected={a:true,b:true};
  page.nodeEls={a:new h.Node(),b:new h.Node()};
  const canvas=new h.OZ.graph.Canvas(page); page.canvas=canvas;
  canvas.paint=function(){page.flushNodeDrag(); this.linkDirty=false;};
  return {...h,app,doc,page};
}

test('drag batches input, keeps links aligned at zoom, commits final pointer and supports undo/redo', () => {
  const h=graphFixture(), {page,doc,app}=h;
  page.portPos={'a:out:pose':{ox:200,oy:30}};
  page.startNodeDrag({clientX:100,clientY:100});
  h.document.emit('mousemove',{clientX:120,clientY:108});
  h.document.emit('mousemove',{clientX:164,clientY:132});
  assert.equal(h.frames.size,1); assert.equal(doc.resource.nodes[0].x,32);
  h.frame(); assert.equal(doc.resource.nodes[0].x,64); assert.equal(doc.resource.nodes[1].x,128);
  assert.equal(page.nodeEls.a.styles.transform,'translate(32px,16px)');
  assert.ok(!h.writes.some(w=>w.name==='left'||w.name==='top'));
  const port=page.getPortScreenPos('a','pose','out'); assert.equal(port.x,(64+200)*2+50); assert.equal(port.y,(64+30)*2+20);
  h.document.emit('mouseup',{clientX:196,clientY:164});
  assert.equal(doc.resource.nodes[0].x,80); assert.equal(page.nodeEls.a.styles.left,'80px');
  assert.equal(page.nodeEls.a.styles.transform,'translate(0px,0px)'); assert.equal(doc.undo.length,1);
  assert.equal(h.document.events.mousemove.length,0); assert.equal(h.document.events.mouseup.length,0);
  app.undo(); assert.equal(doc.resource.nodes[0].x,32);
  app.redo(); assert.equal(doc.resource.nodes[0].x,80);
});

test('cancelled drag restores model and clears pending handlers without adding history', () => {
  const h=graphFixture(), {page,doc}=h;
  page.startNodeDrag({clientX:0,clientY:0});
  h.document.emit('mousemove',{clientX:96,clientY:64}); h.frame();
  assert.equal(doc.resource.nodes[0].x,80);
  h.document.emit('mousemove',{clientX:128,clientY:80});
  page.cancelInteraction(); h.settle();
  assert.equal(doc.resource.nodes[0].x,32); assert.equal(doc.undo.length,0);
  assert.equal(page.nodeEls.a.styles.transform,'translate(0px,0px)');
  assert.equal(h.document.events.mousemove.length,0); assert.equal(page.drag,null);
});

test('uncached ports use a data fallback, with no synchronous DOM measurement while painting', () => {
  const h=graphFixture(); h.page.measureNode=()=>{throw Error('unexpected geometry read');};
  const pos=h.page.getPortScreenPos('a','pose','out');
  assert.equal(pos.x,(32+200)*2+50); assert.equal(pos.y,(48+43)*2+20);
});

test('preview seek uses transforms and Canvas time updates, and wraps playback', () => {
  const h=harness(); h.load('runtime/transport.js');
  h.OZ.rt.viewport={create:()=>({setLabels(){},render(){},resize(){},destroy(){}})};
  h.load('runtime/preview-panel.js');
  const preview=h.OZ.rt.preview.create(h.document.body,{duration:4,getFrame:()=>({}),loop:true});
  const fill=h.document.querySelector('.pv-progress-fill'), thumb=h.document.querySelector('.pv-progress-thumb');
  const time=h.document.querySelector('.pv-time');
  h.writes.length=0; preview.seek(1);
  assert.equal(fill.styles.transform,'scaleX(0.25)'); assert.equal(thumb.styles.transform,'translateX(25%)');
  assert.equal(h.paintedText(time),'1.00 / 4.00'); assert.equal(time.textContent,'');
  assert.ok(!h.writes.some(w=>(w.node===fill||w.node===thumb)&&(w.name==='width'||w.name==='left')));
  preview.seek(5); assert.equal(preview.getTime(),1);
  preview.transport.setLoop(false); preview.seek(4);
  assert.equal(thumb.styles.transform,'translateX(100%)'); assert.equal(h.paintedText(time),'4.00 / 4.00');
  preview.destroy(); assert.equal(h.frames.size,0);
});

test('montage cursor moves without restoring the scene or repainting the ruler, including offscreen seek', () => {
  const h=harness(); h.OZ.montageModel={}; h.load('montage/montage-timeline.js');
  let time=0;
  const montage={tracks:[],duration:8};
  const page={doc:{},getMontage:()=>montage,getTime:()=>time,isPlaying:()=>false,onTimelineReady(){},onZoomChanged(){}};
  const timeline=h.OZ.montage.timeline.create(page,h.document.body); h.layout();
  const line=h.document.querySelector('.oz-mt-playhead'), marker=h.document.querySelector('.oz-mt-ruler-playhead');
  const ruler=h.document.querySelector('.oz-mt-ruler');
  const corner=h.document.querySelector('.oz-mt-corner-time');
  h.draws.length=0; h.writes.length=0; time=1; timeline.timeChanged();
  assert.equal(line.styles.transform,'translateX(175.5px)'); assert.equal(marker.styles.transform,'translateX(170.5px)');
  assert.equal(h.paintedText(corner),'1.00'); assert.equal(corner.textContent,'');
  assert.ok(!h.draws.some(d=>d.name==='drawImage'||d.node===ruler||d.node===marker));
  assert.ok(!h.writes.some(w=>w.name==='left'));
  time=8; timeline.timeChanged(); assert.equal(line.styles.visibility,'hidden');
  time=0; timeline.timeChanged(); assert.equal(line.styles.visibility,'visible');
  timeline.setZoom(80); time=1; timeline.timeChanged(); assert.equal(line.styles.transform,'translateX(95.5px)');
  timeline.destroy(); assert.equal(h.document.events.mousemove?.length||0,0);
});

test('readouts repaint only changed strings, keep dimensions fixed, and redraw for DPI changes', () => {
  const h=harness();
  const display=h.OZ.canvasText.create({width:100,height:16,text:'9:59.99'});
  h.document.body.appendChild(display.el); h.layout();
  h.draws.length=0; h.writes.length=0; h.attributes.length=0;
  display.setText('9:59.99'); assert.equal(h.draws.length,0);
  display.setText('10:00.00'); assert.equal(h.paintedText(display.el),'10:00.00');
  assert.equal(display.getText(),'10:00.00'); assert.equal(display.el.textContent,'');
  assert.equal(h.attributes.length,0); assert.equal(h.writes.length,0);
  h.OZ.host.devicePixelRatio=2; display.resize();
  assert.equal(display.el.getAttribute('width'),'200'); assert.equal(display.el.getAttribute('height'),'32');
  assert.equal(h.paintedText(display.el),'10:00.00');
  h.draws.length=0; display.destroy(); display.setText('after destroy'); h.layout(); assert.equal(h.draws.length,0);
});

test('numeric HUD values use stable Canvas slots while labels and nonnumeric values remain DOM text', () => {
  const h=harness(); h.load('runtime/transport.js');
  h.OZ.rt.viewport={create:()=>({setLabels(){},render(){},resize(){},destroy(){}})};
  h.load('runtime/preview-panel.js');
  const preview=h.OZ.rt.preview.create(h.document.body,{duration:4,getFrame:t=>({curves:{speed:t+1},hud:[{label:'插槽',value:'Base'}]})});
  preview.seek(1); h.layout();
  const value=h.document.querySelector('.pv-chip-curve').querySelector('.pv-chip-value');
  const label=h.document.querySelector('.pv-chip-curve').querySelector('.pv-chip-label');
  const slot=h.document.querySelector('.pv-chip-meta').querySelector('.pv-chip-value');
  const readout=value.querySelector('canvas');
  h.attributes.length=0; preview.seek(2);
  assert.equal(h.paintedText(readout),'3.00'); assert.equal(label.textContent,'speed'); assert.equal(slot.textContent,'Base');
  assert.equal(value.querySelector('canvas'),readout); assert.equal(value.textContent,'');
  assert.ok(!h.attributes.some(a=>a.node===readout)); preview.destroy();
});

test('callbacks from a previous AUI document generation stop after refresh or disposal', () => {
  let generation=1, active=true; const frames=[], timers=[];
  const document={getBaseURI(){return 'test';},getRefreshGeneration(){return generation;},isCurrentGeneration:g=>active&&g===generation};
  const context=vm.createContext({document,window:{devicePixelRatio:1},console,
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},
    requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame(){}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/main/resources/ozz/editor/js/compat.js'),'utf8'),context);
  let calls=0;
  context.OZ.host.requestAnimationFrame(()=>calls++); frames.shift()(10); assert.equal(calls,1);
  context.OZ.host.requestAnimationFrame(()=>calls++); context.OZ.host.setTimeout(()=>calls++,10);
  generation++; frames.shift()(20); timers.shift()(); assert.equal(calls,1);
  assert.equal(context.OZ.env.isCurrentDocument(),false);
});
