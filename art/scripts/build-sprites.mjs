// Registered sprite layers, authored at native resolution after source reduction.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const art=fileURLToPath(new URL('../',import.meta.url));
const out=join(art,'sprites');mkdirSync(out,{recursive:true});mkdirSync(join(art,'.build'),{recursive:true});
const colors=JSON.parse(readFileSync(join(art,'palette.json'))).colors;
const rgb=colors.map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)));
const W=64,H=76;
const raw=execFileSync('magick',[join(art,'sources/vex-sprite.png'),'-filter','box','-resize','64x76!','-depth','8','RGBA:-']);
const base=Buffer.alloc(W*H*4);
for(let i=0;i<raw.length;i+=4){if(raw[i+3]<128)continue;let best=0,dist=Infinity;rgb.forEach((c,j)=>{const d=c.reduce((sum,v,k)=>sum+(v-raw[i+k])**2,0);if(d<dist){dist=d;best=j;}});base.set([...rgb[best],255],i);}
function pixel(b,x,y,c){if(x<0||y<0||x>=W||y>=H)return;const at=(y*W+x)*4;b.set(c===null?[0,0,0,0]:[...rgb[c],255],at);}
function box(b,x,y,w,h,c){for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)pixel(b,i,j,c);}
function line(b,x0,y0,x1,y1,c){const steps=Math.max(Math.abs(x1-x0),Math.abs(y1-y0));for(let t=0;t<=steps;t++)pixel(b,Math.round(x0+(x1-x0)*t/(steps||1)),Math.round(y0+(y1-y0)*t/(steps||1)),c);}
function poly(b,points,c){let ymin=Math.min(...points.map(p=>p[1])),ymax=Math.max(...points.map(p=>p[1]));for(let y=ymin;y<=ymax;y++){const hits=[];for(let i=0;i<points.length;i++){const a=points[i],d=points[(i+1)%points.length];if((a[1]<=y&&d[1]>y)||(d[1]<=y&&a[1]>y))hits.push(a[0]+(y-a[1])*(d[0]-a[0])/(d[1]-a[1]));}hits.sort((a,b)=>a-b);for(let i=0;i<hits.length;i+=2)for(let x=Math.ceil(hits[i]);x<=Math.floor(hits[i+1]);x++)pixel(b,x,y,c);}}
// A clean, common skin patch under every mouth. No lip pixels in the body atlas.
box(base,27,37,10,6,31);
const mouthBlank=Buffer.from(base);
function eyes(b,expression){
  // Keep the source's sculpted eyebrows and heavy lids for her resting look.
  if(expression==='idle'||expression==='breathe_in')return;
  for(const [x,right]of [[22,false],[35,true]]){
    if(expression==='blink'||expression==='blink_half'){
      box(b,x,27,8,4,7);
      box(b,x+1,30,6,1,31);
      line(b,x,29,x+6,29,0);
      pixel(b,x+(right?7:-1),28,0);
      if(expression==='blink_half'){box(b,x+2,29,3,1,31);pixel(b,x+3,29,0);}
    } else if(expression==='eye_roll'){
      box(b,x+1,28,6,2,31);
      box(b,x+3,27,2,1,0);
      line(b,x,27,x+6,27,0);
      pixel(b,x+3,28,0);
    } else if(expression==='dramatic'){
      box(b,x,27,8,4,7);
      box(b,x+1,27,6,3,31);
      box(b,x+3,28,2,2,0);
      line(b,x+1,26,x+6,26,0);
      line(b,x+2,30,x+5,30,7);
    } else if(expression==='unimpressed'){
      box(b,x,27,8,2,5);
      line(b,x,29,x+6,29,0);
      pixel(b,x+3,30,0);
      line(b,x,24,x+6,24,0);
    } else if(expression==='smirk'&&right){
      box(b,x-1,23,9,3,31);
      line(b,x,23,x+5,22,0);
      pixel(b,x+6,23,0);
    }
  }
  if(expression==='smirk')line(b,38,34,40,33,7);
}
const bodyNames=['idle','breathe_in','blink_half','blink','eye_roll','smirk','dramatic','unimpressed'];
const frames=[];
for(const name of bodyNames){const b=Buffer.from(mouthBlank);eyes(b,name);if(name==='breathe_in'){
  // Only the chest changes. Head/eyes/mouth anchor stay byte-identical to idle.
  const copy=Buffer.from(b);for(let y=53;y<75;y++)for(let x=0;x<W;x++){const a=(y*W+x)*4,src=((y+1)*W+x)*4;b.set(copy.subarray(src,src+4),a);}
}frames.push({name:'body/'+name,layer:'body',pixels:b});}
for(const name of ['closed','slightly_open','open','wide','smirk']){
  const b=Buffer.alloc(W*H*4);
  if(name==='closed'){line(b,28,39,35,39,19);line(b,30,40,34,40,20);}
  if(name==='slightly_open'){line(b,29,39,34,39,19);line(b,28,40,35,40,19);line(b,30,41,33,41,20);box(b,30,40,4,1,0);}
  if(name==='open'){box(b,29,39,6,3,19);line(b,30,38,33,38,19);line(b,30,42,33,42,20);box(b,30,39,4,3,0);box(b,31,42,2,1,21);}
  if(name==='wide'){box(b,29,38,6,5,19);line(b,30,37,33,37,19);line(b,30,43,33,43,20);box(b,30,38,4,5,0);box(b,30,38,4,1,31);box(b,31,42,2,1,21);}
  if(name==='smirk'){line(b,28,40,33,40,19);line(b,33,40,36,38,19);line(b,30,41,33,41,20);}
  frames.push({name:'mouth/'+name,layer:'mouth',pixels:b});
}
while(frames.length<16)frames.push({name:null,layer:null,pixels:Buffer.alloc(W*H*4)});
const handNames=['rest','reach','turn','settle'];
for(let i=0;i<4;i++){
  const b=Buffer.alloc(W*H*4);
  if(i){const dx=i===1?5:i===2?0:3,dy=i===2?-2:0;
    poly(b,[[60,59],[49+dx,56+dy],[39+dx,50+dy],[32+dx,51+dy],[26+dx,56+dy],[28+dx,58+dy],[34+dx,55+dy],[36+dx,58+dy],[44+dx,65+dy],[60,69]],30);
    poly(b,[[52+dx,59+dy],[41+dx,53+dy],[34+dx,53+dy],[29+dx,56+dy],[35+dx,55+dy],[39+dx,60+dy],[48+dx,64+dy],[59,66]],31);
    line(b,34+dx,52+dy,40+dx,57+dy,7);line(b,38+dx,53+dy,43+dx,58+dy,7);
    line(b,27+dx,56+dy,29+dx,56+dy,19);
    poly(b,[[53,59],[63,62],[63,73],[54,69],[49,64]],1);
    line(b,52,61,60,67,4);pixel(b,54,63,29);pixel(b,58,66,29);
  }
  frames.push({name:'hand/'+handNames[i],layer:'hand',pixels:b});
}
const cols=4,rows=5,atlasW=cols*W,atlasH=rows*H,atlas=Buffer.alloc(atlasW*atlasH*4);
function save(data,w,h,path){execFileSync('magick',['-size',`${w}x${h}`,'-depth','8','RGBA:-','-strip',path],{input:data});}
const metadata={version:1,status:'integration-candidate',image:'vex-sheet.png',palette:'../palette.json',frameSize:{width:W,height:H},sheet:{width:atlasW,height:atlasH,columns:cols,rows},origin:{x:0,y:0},mouthAnchor:{x:32,y:40},frames:{},animations:{idle:{frames:['body/idle','body/breathe_in','body/idle'],durationsMs:[1800,600,1800],loop:true},blink:{frames:['body/blink_half','body/blink','body/blink_half'],durationsMs:[50,90,50],loop:false},deal:{frames:['hand/rest','hand/reach','hand/turn','hand/settle','hand/rest'],durationsMs:[100,120,140,120,100],loop:false}},reactions:{eye_roll:{frame:'body/eye_roll',holdMs:800},smirk:{frame:'body/smirk',restMouth:'mouth/smirk',holdMs:1000},dramatic:{frame:'body/dramatic',holdMs:700},unimpressed:{frame:'body/unimpressed',holdMs:1200}},mouth:{frames:['mouth/closed','mouth/slightly_open','mouth/open','mouth/wide'],neutral:'mouth/closed',layerOrder:['body','mouth'],drawOffset:{x:0,y:0},notes:'Every mouth cell is 64x76 with transparent padding. Draw at exactly the body origin, not at mouthAnchor. Choose frame from smoothed voice amplitude. Mouth frames work on every body expression.'},hand:{drawOffset:{x:0,y:0},contactPoint:{x:29,y:54},notes:'Optional independent table overlay. Place the 64x76 cell so contactPoint aligns with the card edge. hand/rest is intentionally fully transparent.'}};
frames.forEach((f,i)=>{
 const x=(i%cols)*W,y=Math.floor(i/cols)*H;
 for(let j=0;j<H;j++)f.pixels.copy(atlas,((y+j)*atlasW+x)*4,j*W*4,(j+1)*W*4);
 if(f.name)metadata.frames[f.name]={x,y,width:W,height:H,layer:f.layer};
});
save(atlas,atlasW,atlasH,join(out,'vex-sheet.png'));
const idle=Buffer.from(frames[0].pixels),closed=frames.find(f=>f.name==='mouth/closed').pixels;
for(let i=0;i<idle.length;i+=4)if(closed[i+3])closed.copy(idle,i,i,i+4);
save(idle,W,H,join(out,'vex-idle.png'));
writeFileSync(join(out,'vex-sheet.json'),JSON.stringify(metadata,null,2)+'\n');
execFileSync('magick',[join(out,'vex-sheet.png'),'-background',colors[0],'-alpha','remove','-filter','point','-resize','1024x1520!','-strip',join(out,'vex-sheet-preview.png')]);
console.log('Built registered sprite atlas: 8 body, 5 mouth and 4 hand frames.');

// A composed contact sheet for judging expressions, separate from the atlas.
const previewW=256,previewH=168,preview=Buffer.alloc(previewW*previewH*4);
for(let p=0;p<preview.length;p+=4)preview.set([...rgb[0],255],p);
const labels={I:[7,2,2,2,7],D:[6,5,5,5,6],L:[4,4,4,4,7],E:[7,4,6,4,7],B:[6,5,6,5,6],R:[6,5,6,5,5],A:[2,5,7,5,5],T:[7,2,2,2,2],H:[5,5,7,5,5],N:[5,7,7,5,5],K:[5,5,6,5,5],F:[7,4,6,4,4],Y:[5,5,2,2,2],O:[2,5,5,5,2],S:[3,4,2,1,6],M:[5,7,7,5,5],C:[3,4,4,4,3],U:[5,5,5,5,7],P:[6,5,6,4,4]};
for(let n=0;n<8;n++){
 const f=frames[n],mouth=frames.find(x=>x.name===(bodyNames[n]==='smirk'?'mouth/smirk':'mouth/closed'));
 const ox=n%4*64,oy=Math.floor(n/4)*84;
 for(let y=0;y<76;y++)for(let x=0;x<64;x++){
  const p=(y*64+x)*4,d=((oy+y)*previewW+ox+x)*4;
  if(f.pixels[p+3])preview.set(f.pixels.subarray(p,p+4),d);
  if(mouth.pixels[p+3])preview.set(mouth.pixels.subarray(p,p+4),d);
 }
 const label=bodyNames[n].replaceAll('_','').toUpperCase(),lx=ox+Math.floor((64-(label.length*4-1))/2);
 for(let c=0;c<label.length;c++)for(let y=0;y<5;y++)for(let x=0;x<3;x++)if(labels[label[c]]?.[y]&(1<<(2-x)))preview.set([...rgb[30],255],((oy+78+y)*previewW+lx+c*4+x)*4);
}
save(preview,previewW,previewH,join(art,'.build','vex-reactions-native.png'));
execFileSync('magick',[join(art,'.build','vex-reactions-native.png'),'-filter','point','-resize','1024x672!','-strip',join(out,'vex-reactions-preview.png')]);
