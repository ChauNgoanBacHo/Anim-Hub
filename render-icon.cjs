const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1024,height:1024,useContentSize:true,transparent:true,webPreferences:{offscreen:true}});
 await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<style>html,body{margin:0;width:1024px;height:1024px;background:transparent}svg{display:block}</style>'+fs.readFileSync('assets/icon.svg','utf8')));
 const image=await win.webContents.capturePage();
 const png=image.resize({width:1024,height:1024});
 fs.writeFileSync('assets/icon.png',png.toPNG());
 const dir='assets/app.iconset';fs.mkdirSync(dir,{recursive:true});
 for(const size of [16,32,128,256,512])for(const scale of [1,2])fs.writeFileSync(path.join(dir,`icon_${size}x${size}${scale===2?'@2x':''}.png`),png.resize({width:size*scale,height:size*scale}).toPNG());
 const sizes=[16,32,48,64,128,256];const chunks=sizes.map(size=>png.resize({width:size,height:size}).toPNG());
 const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
 chunks.forEach((chunk,i)=>{const p=6+i*16;header[p]=sizes[i]===256?0:sizes[i];header[p+1]=header[p];header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(chunk.length,p+8);header.writeUInt32LE(offset,p+12);offset+=chunk.length;});
 fs.writeFileSync('assets/icon.ico',Buffer.concat([header,...chunks]));app.quit();
});
