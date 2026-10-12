import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const art=fileURLToPath(new URL('../',import.meta.url));
const json=p=>JSON.parse(readFileSync(join(art,p),'utf8'));
const palette=json('palette.json');
assert.equal(palette.name,'vex');
assert.equal(palette.colors.length,32);
assert.equal(new Set(palette.colors).size,32);
assert.ok(palette.colors.every(c=>/^#[0-9a-f]{6}$/.test(c)));
const allowed=new Set(palette.colors.map(c=>parseInt(c.slice(1),16)));
const images=[];
function readImage(relative,w,h){
  const path=join(art,relative);
  const size=execFileSync('magick',['identify','-format','%w %h',path],{encoding:'utf8'}).trim();
  assert.equal(size,`${w} ${h}`,relative);
  const pixels=execFileSync('magick',[path,'-alpha','off','-depth','8','RGB:-'],{maxBuffer:16*1024*1024});
  assert.equal(pixels.length,w*h*3);
  const used=new Set();
  for(let i=0;i<pixels.length;i+=3){const rgb=(pixels[i]<<16)|(pixels[i+1]<<8)|pixels[i+2];assert.ok(allowed.has(rgb),`${relative}: off-palette pixel ${i/3}`);used.add(rgb);}
  images.push({file:relative,width:w,height:h,colorsUsed:used.size});
  return pixels;
}
const contains=(outer,inner)=>inner.x>=outer.x&&inner.y>=outer.y&&inner.x+inner.width<=outer.x+outer.width&&inner.y+inner.height<=outer.y+outer.height;
const overlaps=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
const canvas={x:0,y:0,width:320,height:200};
const dialogue=json('idle-dialogue.json');
assert.equal(dialogue.lines.length,6);
for(const candidate of json('rooms/index.json').candidates){
  const layout=json('rooms/'+candidate.layout);
  const rects=layout.rects;
  for(const [name,r]of Object.entries(rects)){
    assert.ok(Object.values(r).every(Number.isInteger),`${candidate.id}: integer ${name}`);
    assert.ok(r.width>0&&r.height>0&&contains(canvas,r),`${candidate.id}: valid ${name}`);
  }
  const values=Object.values(rects);
  for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++)assert.ok(!overlaps(values[i],values[j]),`${candidate.id}: overlapping layer rectangles`);
  assert.deepEqual([rects.sprite.width,rects.sprite.height],[64,76]);
  assert.ok(contains(rects.table,layout.safeAreas.cards));
  for(const item of layout.controlItems)assert.ok(contains(rects.controls,item.rect));
  for(const line of dialogue.lines)assert.ok(line.length*6-1<=rects.speech.width-6,`${candidate.id}: idle line exceeds one row: ${line}`);
  const native=readImage('rooms/'+candidate.still,320,200);
  const plate=readImage('rooms/'+candidate.background,320,200);
  assert.ok(!('face' in rects), 'old face rectangle must be absent');
  // The entire sprite recess on the clean plate is one known matte colour, including corners.
  const matte=parseInt(palette.colors[0].slice(1),16);
  for(let y=rects.sprite.y;y<rects.sprite.y+rects.sprite.height;y++)for(let x=rects.sprite.x;x<rects.sprite.x+rects.sprite.width;x++){
    const p=(y*320+x)*3;assert.equal((plate[p]<<16)|(plate[p+1]<<8)|plate[p+2],matte,'sprite plate must be clear');
  }
  const mock=readImage('rooms/'+candidate.mockup,1440,900);
  // Pixel-perfect ×4 blocks and solid letterboxing. UI overlays are native too.
  const {scene,scale}=layout.mockup;
  for(let y=0;y<900;y++)for(let x=0;x<1440;x++){
    const p=(y*1440+x)*3;
    if(x<scene.x||y<scene.y||x>=scene.x+scene.width||y>=scene.y+scene.height){
      assert.equal((mock[p]<<16)|(mock[p+1]<<8)|mock[p+2],matte,'letterbox matte');
    }else{
      const bx=scene.x+Math.floor((x-scene.x)/scale)*scale,by=scene.y+Math.floor((y-scene.y)/scale)*scale;
      const b=(by*1440+bx)*3;
      assert.ok(mock[p]===mock[b]&&mock[p+1]===mock[b+1]&&mock[p+2]===mock[b+2],'non-uniform ×4 block');
    }
  }
  // Mockups may differ from the background only where dialogue/control UI goes.
  for(let y=0;y<200;y++)for(let x=0;x<320;x++){
    const point={x,y,width:1,height:1};
    if(contains(rects.speech,point)||contains(rects.controls,point))continue;
    const n=(y*320+x)*3,m=((scene.y+y*scale)*1440+scene.x+x*scale)*3;
    assert.ok(native[n]===mock[m]&&native[n+1]===mock[m+1]&&native[n+2]===mock[m+2],'unexpected mockup change outside UI');
  }
}
execFileSync(process.execPath,[fileURLToPath(new URL('./verify-sprites.mjs',import.meta.url))],{stdio:['ignore',2,2]});
console.log(JSON.stringify({status:'PASS',paletteColors:32,rooms:3,idleLines:6,checks:['native dimensions','palette membership','rectangle bounds/non-overlap','64x76 clear sprite plates','single-line dialogue fit','×4 integer scaling','letterbox margins','mockup overlay isolation'],images},null,2));
