import fs from 'node:fs';
function crc32(bytes) {let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function makeZip(file,entries) {
  const locals=[],central=[];let offset=0;
  for(const {name,content='',mode=0o100644} of entries){
    const n=Buffer.from(name),data=Buffer.from(content),crc=crc32(data);
    const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(0,6);l.writeUInt32LE(crc,14);l.writeUInt32LE(data.length,18);l.writeUInt32LE(data.length,22);l.writeUInt16LE(n.length,26);
    locals.push(l,n,data);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(0x314,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0,8);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE((mode*65536)>>>0,38);c.writeUInt32LE(offset,42);central.push(c,n);offset+=l.length+n.length+data.length;
  }
  const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);fs.writeFileSync(file,Buffer.concat([...locals,cd,end]));
}
