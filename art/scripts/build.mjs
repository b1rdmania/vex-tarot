// Deterministic native-grid finishing. Requires Node and ImageMagick 7 (magick).
// All colours come from palette.json. Coordinates are native pixels.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const art = fileURLToPath(new URL('../', import.meta.url));
const temp = join(art, '.build');
mkdirSync(temp, {recursive:true});
const {colors} = JSON.parse(readFileSync(join(art, 'palette.json')));
const palettePath = join(temp, 'palette.ppm');
writeFileSync(palettePath, 'P3\n32 1\n255\n' + colors.map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)).join(' ')).join('\n'));
const run = args => execFileSync('magick', args, {maxBuffer:64*1024*1024});
const rect = (x,y,width,height) => ({x,y,width,height});
const rooms = [
  {id:'01-velvet-alcove', title:'Velvet Alcove', face:rect(128,41,64,76), speech:rect(64,5,192,20), table:rect(28,129,266,46), cards:rect(65,136,190,30),
   tablePolygon:'58,130 251,130 292,173 28,173', felt:8, edge:29,
   description:'Frontal velvet nook. The mirror is central, with the dead bouquet and overdue invoice on the left. Warm candlelight is balanced on both sides.'},
  {id:'02-corner-booth', title:'Corner Booth', face:rect(60,45,64,76), speech:rect(40,5,232,20), table:rect(20,136,245,39), cards:rect(55,141,180,28),
   tablePolygon:'40,137 239,137 264,174 20,174', felt:18, edge:20,
   description:'Mirror on the left, bottle-green drawers and a shaded lamp on the right. Dead flowers and the invoice pile sit outside the card area.'},
  {id:'03-attic-window', title:'Attic Window', face:rect(224,39,64,76), speech:rect(154,3,156,14), table:rect(56,134,238,43), cards:rect(82,140,174,29),
   tablePolygon:'65,135 257,135 294,174 55,174', felt:8, edge:29,
   description:'Mirror on the right, moonlit window and wilted bouquet on the left. Cool window light meets warm candles; the invoice is pinned to the bookcase.'}
];
// Attic speech extends into the existing top-right quiet band. 192 native pixels
// keeps every supplied line on one row; all other objects remain below it.
rooms[2].speech=rect(120,3,192,15);
const controls=rect(0,184,320,16);
const items=[
  {id:'talk', label:'Talk to Vex',rect:rect(8,185,82,14)},
  {id:'inspect', label:'Inspect your cards',rect:rect(98,185,132,14)},
  {id:'leave', label:'Leave',rect:rect(242,185,70,14)}
];
// Original simple 5x7 pixel lettering for the mockups only. Runtime typography
// belongs to retro/. No external fonts, antialiasing, or font licensing needed.
const glyphs={
'A':[14,17,17,31,17,17,17],'B':[30,17,17,30,17,17,30],'C':[14,17,16,16,16,17,14],'D':[30,17,17,17,17,17,30],
'E':[31,16,16,30,16,16,31],'F':[31,16,16,30,16,16,16],'G':[14,17,16,23,17,17,15],'H':[17,17,17,31,17,17,17],
'I':[31,4,4,4,4,4,31],'J':[7,2,2,2,18,18,12],'K':[17,18,20,24,20,18,17],'L':[16,16,16,16,16,16,31],
'M':[17,27,21,21,17,17,17],'N':[17,25,25,21,19,19,17],'O':[14,17,17,17,17,17,14],'P':[30,17,17,30,16,16,16],
'Q':[14,17,17,17,21,18,13],'R':[30,17,17,30,20,18,17],'S':[15,16,16,14,1,1,30],'T':[31,4,4,4,4,4,4],
'U':[17,17,17,17,17,17,14],'V':[17,17,17,17,17,10,4],'W':[17,17,17,21,21,21,10],'X':[17,17,10,4,10,17,17],
'Y':[17,17,10,4,4,4,4],'Z':[31,1,2,4,8,16,31],'.':[0,0,0,0,0,0,4],',':[0,0,0,0,0,4,8],
'?':[14,17,1,2,4,0,4],"'":[4,4,0,0,0,0,0],' ':[]
};
const fill = (index,shape) => `fill '${colors[index]}' stroke none ${shape}`;
const box = (r,index) => fill(index,`rectangle ${r.x},${r.y} ${r.x+r.width-1},${r.y+r.height-1}`);
const expand=(r,n)=>rect(r.x-n,r.y-n,r.width+2*n,r.height+2*n);
function lettering(text,x,y,index) {
  let drawing='';
  for(const c of text.toUpperCase()) {
    const rows=glyphs[c];
    if(!rows) throw Error(`Unsupported glyph ${c}`);
    rows.forEach((bits,row)=>{for(let col=0;col<5;col++)if(bits&(1<<(4-col)))drawing+=fill(index,`point ${x+col},${y+row}`)+' ';});
    x+=6;
  }
  return drawing;
}
function dueStamp(x,y) {
  const font={D:[6,5,5,5,6],U:[5,5,5,5,7],E:[7,4,6,4,7]};
  let d=box(rect(x-1,y-1,13,7),20);
  for(const c of 'DUE'){font[c].forEach((v,row)=>{for(let col=0;col<3;col++)if(v&(1<<(2-col)))d+=' '+fill(31,`point ${x+col},${y+row}`);});x+=4;}
  return d;
}
const line = JSON.parse(readFileSync(join(art,'idle-dialogue.json'))).lines[4];
for(const room of rooms) {
  const native=join(art,'rooms',room.id+'.png');
  const raw=join(temp,room.id+'-quantized.png');
  run([join(art,'sources',room.id+'.png'),'-alpha','off','-colorspace','sRGB','-filter','box','-resize','320x200!','+dither','-remap',palettePath,raw]);
  // Hand-specified pixel cleanup: clean speech/controls, square portrait opening,
  // continuous gilt bevel, simplified table silhouette, small invoice stamp.
  let draw=box(room.speech,0)+' '+box(controls,0)+' ';
  draw+=fill(room.edge,`polygon ${room.tablePolygon}`)+' ';
  const tableInset=room.id==='01-velvet-alcove'?'60,132 249,132 287,171 33,171':room.id==='02-corner-booth'?'42,139 237,139 260,172 24,172':'67,137 255,137 288,172 60,172';
  draw+=fill(room.felt,`polygon ${tableInset}`)+' ';
  // Card safe area has no lettering, clutter or confetti texture.
  draw+=box(room.cards,room.felt)+' ';
  draw+=box(expand(room.face,4),18)+' '+box(expand(room.face,3),23)+' '+box(expand(room.face,2),25)+' '+box(expand(room.face,1),29)+' '+box(room.face,0)+' ';
  draw+=fill(26,`line ${room.face.x-2},${room.face.y-2} ${room.face.x+room.face.width+1},${room.face.y-2}`)+' ';
  draw+=fill(24,`line ${room.face.x-2},${room.face.y-1} ${room.face.x-2},${room.face.y+room.face.height+1}`)+' ';
  draw+=fill(28,`line 0,183 319,183`);
  if(room.id==='01-velvet-alcove') draw+=' '+dueStamp(20,73);
  if(room.id==='02-corner-booth') draw+=' '+dueStamp(264,150);
  if(room.id==='03-attic-window') draw+=' '+dueStamp(8,68);
  run([raw,'+antialias','-draw',draw,'+dither','-remap',palettePath,'-strip',native]);
  const layout={version:1,id:room.id,title:room.title,description:room.description,canvas:{width:320,height:200,pixelAspectRatio:1},background:room.id+'.png',palette:'../palette.json',rects:{face:room.face,table:room.table,speech:room.speech,controls},safeAreas:{cards:room.cards},face:{fit:'cover',backgroundColorIndex:0,frameIsBakedIntoBackground:true,notes:'64x76 inner opening. Crop and colour-match the live head and shoulders into this rectangle; no generated face is baked in.'},speech:{fontHeight:7,glyphAdvance:6,padding:3,colorIndex:7,shadowIndex:0,align:'center',maxLines:1},controlItems:items,mockup:{file:room.id+'.laptop.png',width:1440,height:900,scale:4,scene:rect(80,50,1280,800),letterboxColorIndex:0},coordinates:'Top-left origin; width/height counts pixels; right and bottom edges are exclusive. All rects use native 320x200 coordinates.',layerOrder:['background','face-video-clipped-to-face','cards-within-safeAreas.cards','speech','controls'],notes:['Background PNG contains no dialogue or control labels.','Laptop mockup bakes in sample text for composition review only; controls there are not interactive.','Same face size in all three options for a fair moving-face comparison.']};
  writeFileSync(join(art,'rooms',room.id+'.json'),JSON.stringify(layout,null,2)+'\n');
  let ui='';
  for(const item of items){const x=item.rect.x+Math.floor((item.rect.width-(item.label.length*6-1))/2);ui+=lettering(item.label,x,189,30)+' ';}
  ui+=fill(3,'line 94,188 94,195 line 236,188 236,195')+' ';
  const sx=room.speech.x+Math.floor((room.speech.width-(line.length*6-1))/2),sy=room.speech.y+Math.floor((room.speech.height-7)/2);
  ui+=lettering(line,sx+1,sy+1,0)+' '+lettering(line,sx,sy,7);
  const mockNative=join(temp,room.id+'-mock-native.png');
  run([native,'+antialias','-draw',ui,'+dither','-remap',palettePath,mockNative]);
  run([mockNative,'-filter','point','-resize','1280x800!','-background',colors[0],'-gravity','center','-extent','1440x900','-strip',join(art,'rooms',room.id+'.laptop.png')]);
  let guides='';
  for(const [name,r]of Object.entries(layout.rects)){
    const index=({face:26,table:12,speech:7,controls:16})[name];
    guides+=`fill none stroke '${colors[index]}' stroke-width 1 rectangle ${r.x},${r.y} ${r.x+r.width-1},${r.y+r.height-1} `;
  }
  run([native,'+antialias','-draw',guides,'-filter','point','-resize','1280x800!','-strip',join(art,'rooms',room.id+'.layout.png')]);
}
writeFileSync(join(art,'rooms','index.json'),JSON.stringify({version:1,palette:'../palette.json',candidates:rooms.map(r=>({id:r.id,title:r.title,layout:r.id+'.json',background:r.id+'.png',mockup:r.id+'.laptop.png'}))},null,2)+'\n');
console.log('Built 3 native rooms, 3 laptop mockups, 3 layout guides, and JSON metadata.');
