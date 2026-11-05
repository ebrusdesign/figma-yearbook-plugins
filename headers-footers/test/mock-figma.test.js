const fs=require('fs'); let id=0;
function T(name,chars,ref){return {id:'t'+(++id),type:'TEXT',name,characters:chars,fontName:{family:'Roboto',style:'Regular'},hasMissingFont:false,
  getRangeAllFontNames(){return [this.fontName]},componentPropertyReferences:ref?{characters:ref}:null,children:[]};}
function finder(n){n.findAll=function(p){let o=[];(function w(x){(x.children||[]).forEach(c=>{if(p(c))o.push(c);w(c)})})(this);return o};return n;}
const sets={};
function mkSet(name,defaults){const s={type:'COMPONENT_SET',name,componentPropertyDefinitions:{'Property 1':{type:'VARIANT',variantOptions:['Left','Right']}}};
  s.mains={Left:{name:'Property 1=Left',parent:s},Right:{name:'Property 1=Right',parent:s}}; s.defaults=defaults; return s;}
const HS=mkSet('HEADER',()=>[T('SECTION A','SECTION A'),T('STUDENTS','STUDENTS')]);
const FS=mkSet('FOOTER',()=>[T('###','###')]);
const LOGO={type:'COMPONENT_SET',name:'Logo'};
function inst(set,side){const n=finder({id:'i'+(++id),type:'INSTANCE',name:set.name,children:set.defaults(),componentProperties:{'Property 1':{type:'VARIANT',value:side}}});
  n.getMainComponentAsync=async()=>set.mains[n.componentProperties['Property 1'].value];
  n.setProperties=function(o){const v=o['Property 1']; if(!['Left','Right'].includes(v)) throw new Error('bad option '+v);
    n.componentProperties={'Property 1':{type:'VARIANT',value:v}}; n.children=set.defaults(); /* worst case: overrides lost */};
  if(set===HS){const logo=finder({id:'l'+id,type:'INSTANCE',name:'logo',children:[],componentProperties:{}}); logo.getMainComponentAsync=async()=>({name:'Logo',parent:null}); n.children.push(logo);}
  return n;}
function page(name,x,y,hs,fs,headTxt,num){const h=inst(HS,hs), f=inst(FS,fs); if(headTxt){h.children[0].characters=headTxt[0];h.children[1].characters=headTxt[1];} if(num)f.children[0].characters=num;
  const p=finder({id:'p'+(++id),type:'FRAME',name,height:1251,absoluteTransform:[[1,0,x],[0,1,y]],children:[h,f]}); h.parent=p;f.parent=p; return p;}
// Note page order on canvas: 15 placed right of 14; second row below; created out of order to test sorting
const P=[page('15',1854,0,'Right','Left',['SECTION A','STUDENTS'],'15'),page('14',0,5,'Right','Right',['SECTION A','STUDENTS']),page('17',1854,1500,'Left','Left'),page('16',0,1490,'Left','Left')];
const cv={type:'PAGE',children:P,selection:P.slice()}; P.forEach(p=>p.parent=cv); finder(cv);
let msgs=[],H; global.__html__='';
global.figma={showUI(){},currentPage:cv,on(){},notify(m){},commitUndo(){},loadFontAsync:async()=>{},getNodeByIdAsync:async()=>null,viewport:{},ui:{postMessage:m=>msgs.push(m),set onmessage(f){H=f}}};
eval(fs.readFileSync(require('path').join(__dirname,'..','code.js'),'utf8'));
const assert=require('assert');
const state=()=>P.slice().sort((a,b)=>Number(a.name)-Number(b.name)).map(p=>({name:p.name,
  h:p.children[0].componentProperties['Property 1'].value, f:p.children[1].componentProperties['Property 1'].value,
  num:p.children[1].children[0].characters, texts:p.children[0].children.filter(c=>c.type==='TEXT').map(t=>t.characters)}));
(async()=>{await new Promise(r=>setTimeout(r,20));
  const scan=msgs.pop();
  assert.strictEqual(scan.headerName,'HEADER'); assert.strictEqual(scan.footerName,'FOOTER');
  assert.deepStrictEqual(scan.pages.map(p=>p.name),['14','15','16','17'],'pages sorted by canvas position');

  await H({type:'apply',scope:'selection',headerName:'HEADER',footerName:'FOOTER',doSides:true,start:'Left',
           doNums:true,doRename:true,startNum:20,doText:true,texts:{'STUDENTS':'STUDENTS & FRIENDS'},fieldOrder:['SECTION A','STUDENTS']});
  let st=state();
  assert.deepStrictEqual(st.map(p=>p.name),['20','21','22','23'],'frames renamed');
  assert.deepStrictEqual(st.map(p=>p.h),['Left','Right','Left','Right'],'headers alternate from Left');
  assert.deepStrictEqual(st.map(p=>p.f),['Left','Right','Left','Right'],'footers match headers');
  assert.deepStrictEqual(st.map(p=>p.num),['20','21','22','23'],'footers numbered');
  st.forEach(p=>assert.deepStrictEqual(p.texts,['SECTION A','STUDENTS & FRIENDS'],'header text set'));

  // Flip everything again: the mock resets text on every variant swap, so this checks text survives flips
  await H({type:'apply',scope:'selection',headerName:'HEADER',footerName:'FOOTER',doSides:true,start:'Right',
           doNums:false,doRename:false,doText:false,texts:{},fieldOrder:[]});
  st=state();
  assert.deepStrictEqual(st.map(p=>p.h),['Right','Left','Right','Left'],'re-flipped from Right');
  assert.deepStrictEqual(st.map(p=>p.num),['20','21','22','23'],'numbers kept through flip');
  st.forEach(p=>assert.deepStrictEqual(p.texts,['SECTION A','STUDENTS & FRIENDS'],'header text kept through flip'));
  console.log('headers-footers: all checks passed');
})().catch(e=>{console.error(e.message);process.exit(1);});
