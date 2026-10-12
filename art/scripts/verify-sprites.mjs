import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const art=fileURLToPath(new URL('../',import.meta.url));
const palette=JSON.parse(readFileSync(join(art,'palette.json'))).colors;
const atlas=JSON.parse(readFileSync(join(art,'sprites/vex-sheet.json')));
const allowed=new Set(palette.map(c=>parseInt(c.slice(1),16)));
const pixels=execFileSync('magick',[join(art,'sprites/vex-sheet.png'),'-depth','8','RGBA:-'],{maxBuffer:4*1024*1024});
assert.equal(execFileSync('magick',['identify','-format','%w %h',join(art,'sprites/vex-sheet.png')],{encoding:'utf8'}),'256 380');
for(let i=0;i<pixels.length;i+=4){assert.ok(pixels[i+3]===0||pixels[i+3]===255,'binary alpha only');if(pixels[i+3])assert.ok(allowed.has((pixels[i]<<16)|(pixels[i+1]<<8)|pixels[i+2]),'off-palette sprite pixel');}
const sample=(f,x,y)=>pixels.subarray(((f.y+y)*256+f.x+x)*4,((f.y+y)*256+f.x+x)*4+4);
const body=Object.entries(atlas.frames).filter(([,f])=>f.layer==='body');
const mouth=Object.entries(atlas.frames).filter(([,f])=>f.layer==='mouth');
const hands=Object.entries(atlas.frames).filter(([,f])=>f.layer==='hand');
assert.equal(body.length,8);assert.equal(mouth.length,5);assert.equal(hands.length,4);
const slots=new Set();
for(const [name,f]of Object.entries(atlas.frames)){
 assert.deepEqual([f.width,f.height],[64,76]);assert.ok(f.x%64===0&&f.y%76===0);
 assert.ok(f.x>=0&&f.y>=0&&f.x+64<=256&&f.y+76<=380);
 assert.ok(!slots.has(`${f.x},${f.y}`));slots.add(`${f.x},${f.y}`);
 if(f.layer==='mouth')for(let y=0;y<76;y++)for(let x=0;x<64;x++)if(sample(f,x,y)[3])assert.ok(x>=27&&x<=37&&y>=37&&y<=44,`${name}: displaced mouth pixel`);
}
const idle=atlas.frames['body/idle'],breath=atlas.frames['body/breathe_in'];
for(let y=0;y<53;y++)for(let x=0;x<64;x++)assert.deepEqual(sample(idle,x,y),sample(breath,x,y),'breathing must not move head or mouth anchor');
assert.ok(body.every(([,f])=>{for(let y=37;y<43;y++)for(let x=27;x<37;x++)assert.deepEqual(sample(f,x,y),sample(idle,x,y),'common mouthless skin patch');return true;}));
for(const [,m]of mouth)for(const [,b]of body)for(let y=37;y<45;y++)for(let x=27;x<38;x++)if(sample(m,x,y)[3])assert.equal(sample(b,x,y)[3],255,'mouth lands inside body silhouette');
for(const sequence of Object.values(atlas.animations)){
 assert.equal(sequence.frames.length,sequence.durationsMs.length);
 sequence.frames.forEach(f=>assert.ok(atlas.frames[f]));
}
console.log('PASS sprite atlas: 17 registered frames, palette + binary alpha, fixed breathing anchor, all 40 body/mouth combinations.');
