import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {UPDATE_APP_ID,PRODUCT_NAME,BUNDLE_NAME,artifactName,verifyManifest,verifyArchive,newerVersion,safeZipPath,safeSymlink} from '../src/shared/update-security.mjs';
import {extractUpdateZip} from '../src/shared/update-zip.mjs';
const keys = crypto.generateKeyPairSync('ed25519');
const value = {schema:1,appId:UPDATE_APP_ID,version:'1.0.2',platform:'darwin',arch:'arm64',file:artifactName('1.0.2','darwin','arm64'),size:3,sha256:crypto.createHash('sha256').update('abc').digest('hex')};
const expected = {version:'1.0.2',platform:'darwin',arch:'arm64'};
const sign = (data,key=keys.privateKey) => {const bytes=Buffer.from(JSON.stringify(data));return {payload:bytes.toString('base64'),signature:crypto.sign(null,bytes,key).toString('base64')};};
test('signed manifest accepted; tamper, wrong signing key and wrong identity rejected',()=>{
  assert.deepEqual(verifyManifest(sign(value),keys.publicKey,expected),value);
  const altered=sign(value); altered.payload=Buffer.from(JSON.stringify({...value,size:5})).toString('base64');
  assert.throws(()=>verifyManifest(altered,keys.publicKey,expected));
  assert.throws(()=>verifyManifest(sign(value,crypto.generateKeyPairSync('ed25519').privateKey),keys.publicKey,expected));
  for(const patch of [{schema:2},{appId:'other'},{version:'1.0.3'},{arch:'x64'},{platform:'win32'},{file:'evil.zip'},{size:0},{size:700*1024*1024},{sha256:'bad'}]) assert.throws(()=>verifyManifest(sign({...value,...patch}),keys.publicKey,expected));
});
test('stable versions compare numerically and never downgrade',()=>{
  assert(newerVersion('1.10.0','1.9.9'));assert(newerVersion('v2.0.0','1.99.99'));
  for(const v of ['1.0.2','1.0.1','1.0.3-beta','bogus']) assert(!newerVersion(v,'1.0.2'));
});
test('archive size/hash validation rejects truncation and changed bytes',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xom-hash-'));const file=path.join(dir,'a.zip');
  try {fs.writeFileSync(file,'abc');await verifyArchive(file,value);fs.writeFileSync(file,'xyz');await assert.rejects(verifyArchive(file,value));fs.writeFileSync(file,'a');await assert.rejects(verifyArchive(file,value));}
  finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('ZIP path and symlink checks protect extraction root',()=>{
  for(const name of ['../a','a/../../b','/tmp/a','C:/a','a\\b','a/./b']) assert.throws(()=>safeZipPath(name,'darwin'));
  for(const name of ['a:stream','CON.txt','file.','file ']) assert.throws(()=>safeZipPath(name,'win32'));
  assert.equal(safeZipPath('Xóm Nhà Lá.app/Contents/Info.plist','darwin'),'Xóm Nhà Lá.app/Contents/Info.plist');
  safeSymlink('Test.app/Contents/Frameworks/F.framework/Versions/Current','A','Test.app');
  assert.throws(()=>safeSymlink('Test.app/Contents/link','../../../outside','Test.app'));
});
// Minimal stored ZIP fixture generator, including CRC, to exercise extraction without shell tools.
function crc32(bytes) {let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function makeZip(file,entries) {
  const locals=[],central=[];let offset=0;
  for(const {name,content='',mode=0o100644} of entries){
    const n=Buffer.from(name),data=Buffer.from(content),crc=crc32(data);
    const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(0,6);l.writeUInt32LE(crc,14);l.writeUInt32LE(data.length,18);l.writeUInt32LE(data.length,22);l.writeUInt16LE(n.length,26);
    locals.push(l,n,data);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(0x314,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0,8);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE((mode*65536)>>>0,38);c.writeUInt32LE(offset,42);central.push(c,n);offset+=l.length+n.length+data.length;
  }
  const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);fs.writeFileSync(file,Buffer.concat([...locals,cd,end]));
}
test('extract real ZIP: Unicode, executable, valid internal symlink; reject traversal and link children',{skip:process.platform==='win32'},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'xom-zip-'));const bundle=BUNDLE_NAME;
 try {
  const zip=path.join(root,'a.zip'),dest=path.join(root,'extract');fs.mkdirSync(dest);
  makeZip(zip,[{name:`${bundle}/Contents/MacOS/${PRODUCT_NAME}`,content:'binary',mode:0o100755},{name:`${bundle}/Contents/link`,content:`MacOS/${PRODUCT_NAME}`,mode:0o120777}]);
  await extractUpdateZip(zip,dest,'darwin');assert.equal(fs.readFileSync(path.join(dest,bundle,'Contents/link'),'utf8'),'binary');
  if(process.platform!=='win32') assert(fs.statSync(path.join(dest,bundle,'Contents/MacOS',PRODUCT_NAME)).mode & 0o111);
  for(const entries of [[{name:'../outside',content:'bad'}],[{name:`${bundle}/Contents/link`,content:'../../../outside',mode:0o120777}],[{name:`${bundle}/Contents/link`,content:'MacOS',mode:0o120777},{name:`${bundle}/Contents/link/a`,content:'bad'}]]) {
    const folder=fs.mkdtempSync(path.join(root,'bad-'));makeZip(zip,entries);await assert.rejects(extractUpdateZip(zip,folder,'darwin'));
  }
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('Windows extraction accepts portable layout and rejects symlink',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'xom-win-'));
 try {const zip=path.join(root,'a.zip'),dest=path.join(root,'out');fs.mkdirSync(dest);makeZip(zip,[{name:'resources/app.asar',content:'app'}]);await extractUpdateZip(zip,dest,'win32');assert.equal(fs.readFileSync(path.join(dest,'resources/app.asar'),'utf8'),'app');makeZip(zip,[{name:'link',content:'app',mode:0o120777}]);await assert.rejects(extractUpdateZip(zip,dest,'win32'));}
 finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('mac helper handles paths with spaces, retains backup and restores on launch failure',{skip:process.platform==='win32'},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'xom helper '));
 try {
  for(const fail of [false,true]) {
    const dir=path.join(root,fail?'failure':'success');fs.mkdirSync(dir);const target=path.join(dir,'Old app.app'),prepared=path.join(dir,'New app.app'),backup=path.join(dir,'Backup app.app');fs.mkdirSync(target);fs.mkdirSync(prepared);fs.writeFileSync(path.join(target,'version'),'old');fs.writeFileSync(path.join(prepared,'version'),'new');
    const launcher=path.join(dir,'launcher.sh');fs.writeFileSync(launcher,`#!/bin/sh\nexit ${fail?1:0}\n`,{mode:0o700});
    const args=['assets/updater/install-mac.sh','2147483647',target,prepared,backup,path.join(dir,'log'),path.join(dir,'ready'),launcher];
    if(fail) assert.throws(()=>execFileSync('/bin/bash',args));else execFileSync('/bin/bash',args);
    assert.equal(fs.readFileSync(path.join(target,'version'),'utf8'),fail?'old':'new');
    if(!fail) assert.equal(fs.readFileSync(path.join(backup,'version'),'utf8'),'old');
  }
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('Windows helper replaces portable directory and restores on immediate launch failure',{skip:process.platform!=='win32'},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'xom windows helper '));
 try {
  for(const fail of [false,true]) {
   const dir=path.join(root,fail?'failure':'success');fs.mkdirSync(dir);
   const target=path.join(dir,'Old app'),prepared=path.join(dir,'New app'),backup=path.join(dir,'Backup app');
   fs.mkdirSync(target);fs.mkdirSync(prepared);fs.writeFileSync(path.join(target,'version'),'old');fs.writeFileSync(path.join(prepared,'version'),'new');
   fs.writeFileSync(path.join(target,'launch.cmd'),'@exit /b 0');fs.writeFileSync(path.join(prepared,'launch.cmd'),'@exit /b 0');
   const args=['-NoProfile','-NonInteractive','-File',path.resolve('assets/updater/install-win.ps1'),'-OldPid','2147483647','-Target',target,'-Prepared',prepared,'-Backup',backup,'-Log',path.join(dir,'log'),'-Executable',fail?'missing.exe':'launch.cmd','-Ready',path.join(dir,'ready')];
   const ps=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
   if(fail) assert.throws(()=>execFileSync(ps,args));else execFileSync(ps,args);
   assert.equal(fs.readFileSync(path.join(target,'version'),'utf8'),fail?'old':'new');
   if(!fail) assert.equal(fs.readFileSync(path.join(backup,'version'),'utf8'),'old');
  }
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
