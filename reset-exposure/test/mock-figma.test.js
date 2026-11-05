// Mock Figma API: frozen paints like the real thing; checks that only filters change.
const fs=require('fs');
let id=0; const frz=o=>Object.freeze(o);
function img(exp,extra){return frz({type:'IMAGE',scaleMode:'CROP',imageHash:'h'+(++id),imageTransform:[[0.8,0,0.1],[0,0.9,0.05]],scalingFactor:0.5,rotation:0,opacity:1,blendMode:'NORMAL',visible:true,filters:frz(Object.assign({exposure:exp,contrast:0,saturation:0,temperature:0,tint:0,highlights:0,shadows:0},extra||{}))});}
function node(name,fills,kids){const n={id:'n'+(++id),name,type:kids?'FRAME':'RECTANGLE',_f:fills,children:kids||[],x:5,y:7,width:233,height:332};
 Object.defineProperty(n,'fills',{configurable:true,get(){return this._f},set(v){this._f=frz(v.map(frz))}});
 n.children.forEach(c=>c.parent=n);
 n.findAll=function(p){let o=[];(function w(x){x.children.forEach(c=>{if(p(c))o.push(c);w(c)})})(this);return o};return n;}
const r1=node('a',[img(-0.12)]), r2=node('b',[img(0)]), r3=node('c',[frz({type:'SOLID',color:{r:1,g:1,b:1}}),img(-0.3,{contrast:0.2})]), r4=node('d',[img(0,{saturation:-0.4})]);
const txt=node('t',null); Object.defineProperty(txt,'fills',{get(){return Symbol('mixed')}});
const fr=node('Page 12',[],[r1,r2,r3,r4,txt]);
const page={type:'PAGE',name:'Page 1',children:[fr],selection:[fr],findAll:function(p){return [fr].concat(fr.findAll(p)).filter(p)}}; fr.parent=page;
const before=JSON.parse(JSON.stringify([r1,r2,r3,r4].map(n=>n._f)));
let msgs=[], handler;
global.figma={showUI(){},currentPage:page,root:{children:[page]},loadAllPagesAsync:async()=>{},on(){},notify(m){msgs.push('notify:'+m)},commitUndo(){msgs.push('undo')},
 ui:{postMessage:m=>msgs.push(m),set onmessage(f){handler=f}},getNodeByIdAsync:async()=>null,viewport:{}};
global.__html__='';
eval(fs.readFileSync(require('path').join(__dirname,'..','code.js'),'utf8'));
const assert=require('assert');
(async()=>{
  await handler({type:'scan',scope:'selection',all:false});
  const scan=msgs.pop(); assert.strictEqual(scan.total,4); assert.strictEqual(scan.need,2);

  await handler({type:'reset',scope:'page',all:false});
  [r1,r2,r3,r4].forEach((n,i)=>n._f.forEach((p,j)=>{
    const a=JSON.parse(JSON.stringify(p)), b=JSON.parse(JSON.stringify(before[i][j]));
    if(b.filters){ assert.strictEqual(a.filters.exposure,0,'exposure reset');
      for(const k of Object.keys(b.filters)) if(k!=='exposure') assert.strictEqual(a.filters[k],b.filters[k],'other adjustments untouched: '+k); }
    delete a.filters; delete b.filters;
    assert.deepStrictEqual(a,b,'image, crop/transform, scale mode, opacity etc. unchanged');
  }));

  await handler({type:'reset',scope:'all',all:true});
  assert.strictEqual(r3._f[1].filters.contrast,0); assert.strictEqual(r4._f[0].filters.saturation,0);
  assert.strictEqual(r3._f[0].type,'SOLID','non-image fills untouched');
  console.log('reset-exposure: all checks passed');
})().catch(e=>{console.error(e.message);process.exit(1);});
