import {app,BrowserWindow,ipcMain} from 'electron';
import fs from 'original-fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pipeline} from 'node:stream/promises';
import {Readable,Transform} from 'node:stream';
import {readUpdatePackage} from './shared/update-package.mjs';
import {UPDATE_APP_ID,UPDATE_REPO,PRODUCT_NAME,EXECUTABLE_NAME,BUNDLE_NAME,manifestName,verifyManifest,verifyArchive,newerVersion} from './shared/update-security.mjs';
import {extractUpdateZip} from './shared/update-zip.mjs';
const run = promisify(execFile);
const API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
const assetPrefix = `https://github.com/${UPDATE_REPO}/releases/download/`;
let state = {status:'idle',current:'',progress:0,error:'',latest:'',available:false};
let releaseData = null, busy = false, archivePath = '', stagedRoot = '';
let installHelper = null;
function resources() { return app.isPackaged ? path.join(process.resourcesPath,'updater') : path.join(app.getAppPath(),'assets','updater'); }
function publicKey() { return fs.readFileSync(app.isPackaged ? path.join(process.resourcesPath,'update-public.pem') : path.join(app.getAppPath(),'assets','update-public.pem'),'utf8'); }
function publish(changes) {
  state = {...state,...changes};
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('app-update-state',state);
  return {...state};
}
async function response(url, timeout = 25000) {
  const res = await fetch(url,{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(timeout)});
  if (!res.ok) throw new Error(res.status === 404 ? 'Chưa có release/manifest cập nhật phù hợp.' : res.status === 403 || res.status === 429 ? 'GitHub đang giới hạn yêu cầu. Thử lại sau nhé.' : `Không tải được cập nhật (${res.status}).`);
  return res;
}
async function limitedJson(url) {
  const res = await response(url);
  const chunks = []; let size = 0;
  for await (const chunk of res.body) { if ((size += chunk.length) > 1024*1024) throw new Error('Metadata quá lớn.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function checkedAsset(assets,name) {
  const asset = assets?.find(item => item.name === name);
  if (!asset || !asset.browser_download_url?.startsWith(assetPrefix)) {
    const error = new Error('Bản phát hành chưa có đủ file cập nhật cho máy này.');
    error.code = 'UPDATE_NOT_READY';
    throw error;
  }
  return asset;
}
function verifyRelease() {
  if (!releaseData) throw new Error('Hãy kiểm tra bản mới trước.');
  return verifyManifest(releaseData.envelope,publicKey(),{version:releaseData.version,platform:process.platform,arch:process.arch});
}
async function check() {
  if (busy || ['ready','installing'].includes(state.status)) return state;
  busy = true; releaseData = null; publish({status:'checking',error:'',progress:0,available:false});
  try {
    if (!['win32','darwin'].includes(process.platform)) throw new Error('Updater chỉ hỗ trợ Windows và macOS.');
    const release = await limitedJson(API);
    const version = String(release.tag_name || '').replace(/^v/,'');
    if (release.draft || release.prerelease || !newerVersion(version,app.getVersion())) { releaseData=null; return publish({status:'current',available:false,latest:version}); }
    publish({latest:version});
    const manifestAsset = checkedAsset(release.assets,manifestName(process.platform,process.arch));
    const envelope = await limitedJson(manifestAsset.browser_download_url);
    const manifest = verifyManifest(envelope,publicKey(),{platform:process.platform,arch:process.arch,version});
    const asset = checkedAsset(release.assets,manifest.file);
    if (asset.size !== manifest.size) throw new Error('Kích thước release asset không khớp manifest đã ký.');
    releaseData = {version,envelope,url:asset.browser_download_url};
    return publish({status:'available',available:true,latest:version,size:manifest.size});
  } catch(error) {
    if (error.code === 'UPDATE_NOT_READY') return publish({status:'unavailable',available:false,error:''});
    return publish({status:'error',error:error.message});
  }
  finally { busy = false; }
}
async function download() {
  if (busy) return state;
  busy = true; publish({status:'downloading',error:'',progress:0});
  try {
    if (!app.isPackaged) throw new Error('Chỉ tải/cài tự động trong bản app đã đóng gói.');
    const manifest = verifyRelease();
    const cache = path.join(app.getPath('userData'),'updates');
    await fs.promises.mkdir(cache,{recursive:true,mode:0o700});
    archivePath = path.join(cache,`${crypto.randomUUID()}.zip`);
    const res = await response(releaseData.url,15*60*1000);
    const length = Number(res.headers.get('content-length'));
    if (length && length !== manifest.size) throw new Error('Kích thước download không đúng manifest.');
    let received=0, last=0;
    const counter = new Transform({transform(chunk,_encoding,callback) {
      received += chunk.length;
      if (received > manifest.size) return callback(new Error('Download vượt kích thước được ký.'));
      if (Date.now()-last > 150) {last=Date.now();publish({progress:received/manifest.size});}
      callback(null,chunk);
    }});
    await pipeline(Readable.fromWeb(res.body),counter,fs.createWriteStream(archivePath,{flags:'wx',mode:0o600}));
    await verifyArchive(archivePath,manifest);
    return publish({status:'ready',progress:1});
  } catch(error) {
    if (archivePath) await fs.promises.rm(archivePath,{force:true}); archivePath='';
    return publish({status:'error',error:error.message});
  } finally {busy=false;}
}
function installTarget() {
  if (process.platform === 'darwin') {
    const suffix = `.app${path.sep}Contents${path.sep}MacOS${path.sep}`;
    const index = process.execPath.lastIndexOf(suffix);
    if (index < 0) throw new Error('Không xác định được app bundle.');
    const target = process.execPath.slice(0,index+4);
    if (target.includes('/AppTranslocation/') || target.startsWith('/Volumes/')) throw new Error('Hãy chuyển app ra khỏi DMG/App Translocation, ví dụ vào ~/Applications, rồi mở lại.');
    return target;
  }
  return path.dirname(process.execPath);
}
async function validatePrepared(prepared,manifest) {
  if (process.platform === 'darwin') {
    const plist = path.join(prepared,'Contents','Info.plist');
    const value = async key => (await run('/usr/libexec/PlistBuddy',['-c',`Print :${key}`,plist])).stdout.trim();
    if (await value('CFBundleIdentifier') !== UPDATE_APP_ID || await value('CFBundleShortVersionString') !== manifest.version || await value('CFBundleExecutable') !== EXECUTABLE_NAME) throw new Error('Bundle ID, version hoặc executable không khớp.');
    const exe = path.join(prepared,'Contents','MacOS',EXECUTABLE_NAME);
    await fs.promises.access(exe,fs.constants.X_OK);
    const archs = (await run('/usr/bin/lipo',['-archs',exe])).stdout.trim().split(/\s+/);
    if (!archs.includes(process.arch === 'x64' ? 'x86_64' : process.arch)) throw new Error('Bundle không đúng kiến trúc máy.');
  } else {
    const exe = path.join(prepared,`${EXECUTABLE_NAME}.exe`);
    const handle = await fs.promises.open(exe,'r');
    try {
      const dos=Buffer.alloc(64);await handle.read(dos,0,64,0);
      if(dos.toString('ascii',0,2)!=='MZ') throw new Error('Executable không hợp lệ.');
      const pe=Buffer.alloc(6);await handle.read(pe,0,6,dos.readUInt32LE(60));
      if(pe.readUInt32LE(0)!==0x4550 || pe.readUInt16LE(4)!==(process.arch==='arm64'?0xaa64:0x8664)) throw new Error('Executable không đúng kiến trúc.');
    } finally {await handle.close();}
  }
  // Read the staged archive as raw bytes via original-fs, not Electron's mounted
  // ASAR layer (which can reject an external archive with integrity fuses enabled).
  const asar = process.platform === 'darwin' ? path.join(prepared,'Contents','Resources','app.asar') : path.join(prepared,'resources','app.asar');
  const pkg = readUpdatePackage(asar);
  if (pkg.name !== 'xom-nha-la' || pkg.productName !== PRODUCT_NAME || pkg.version !== manifest.version) throw new Error('Package trong app không khớp bản cập nhật.');
}
async function install() {
  if (busy || state.status !== 'ready') return state;
  busy = true; publish({status:'installing',error:''});
  try {
    if (!app.isPackaged) throw new Error('Chỉ cài từ bản app đóng gói.');
    const manifest = verifyRelease();
    if (!newerVersion(manifest.version,app.getVersion())) throw new Error('Không cài phiên bản cũ hoặc bằng hiện tại.');
    await verifyArchive(archivePath,manifest);
    const target = installTarget();
    await fs.promises.access(target,fs.constants.W_OK);
    await fs.promises.access(path.dirname(target),fs.constants.W_OK);
    stagedRoot = await fs.promises.mkdtemp(path.join(path.dirname(target),'.xom-update-'));
    await fs.promises.chmod(stagedRoot,0o700);
    await extractUpdateZip(archivePath,stagedRoot,process.platform,fs);
    const prepared = process.platform === 'darwin' ? path.join(stagedRoot,BUNDLE_NAME) : stagedRoot;
    await validatePrepared(prepared,manifest);
    const backup = `${target}.backup-${app.getVersion()}-${Date.now()}`;
    const log = path.join(app.getPath('userData'),'update-result.txt');
    const receipt = path.join(app.getPath('userData'),'update-pending.json');
    await fs.promises.writeFile(receipt,JSON.stringify({version:manifest.version,backup,target,createdAt:Date.now()}),{mode:0o600});
    // Helper lives outside both old and new app folders, so Windows can rename the running installation.
    const helperDir = await fs.promises.mkdtemp(path.join(app.getPath('temp'),'xom-update-helper-'));
    const helperName = process.platform === 'darwin' ? 'install-mac.sh' : 'install-win.ps1';
    const helper = path.join(helperDir,helperName);
    await fs.promises.copyFile(path.join(resources(),helperName),helper);
    await fs.promises.chmod(helper,0o700);
    const ready = path.join(helperDir,'ready');
    const command = process.platform === 'darwin' ? '/bin/bash' : path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const args = process.platform === 'darwin' ? [helper,String(process.pid),target,prepared,backup,log,ready,'/usr/bin/open'] : ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,'-OldPid',String(process.pid),'-Target',target,'-Prepared',prepared,'-Backup',backup,'-Log',log,'-Executable',`${EXECUTABLE_NAME}.exe`,'-Ready',ready];
    // Capture startup errors too: PowerShell may reject the script before its own logger runs.
    const helperOutput = fs.openSync(log,'a');
    let child;
    try { child = installHelper = spawn(command,args,{detached:true,stdio:['ignore',helperOutput,helperOutput],windowsHide:true,cwd:helperDir}); }
    finally { fs.closeSync(helperOutput); }
    await new Promise((resolve,reject) => {child.once('spawn',resolve);child.once('error',reject);});
    let helperError = null;
    child.once('exit',code => { helperError = new Error(`Helper không khởi chạy được (${code}). Chi tiết trong ${log}. Chính sách máy có thể chặn PowerShell.`); });
    const waitStart = Date.now();
    while (!fs.existsSync(ready)) {
      if (helperError) throw helperError;
      if (Date.now()-waitStart > 10000) throw new Error('Helper chưa sẵn sàng; app chưa đóng. Kiểm tra chính sách chạy script.');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    child.unref();
    setTimeout(() => app.quit(),300);
    return state;
  } catch(error) {
    if (installHelper) { installHelper.kill(); installHelper=null; }
    if (stagedRoot) await fs.promises.rm(stagedRoot,{recursive:true,force:true}).catch(()=>{});
    stagedRoot='';
    return publish({status:'ready',error:error.message});
  } finally {busy=false;}
}
export function registerAppUpdater() {
  state.current = app.getVersion();
  try {
    const receiptPath = path.join(app.getPath('userData'),'update-pending.json');
    const receipt = JSON.parse(fs.readFileSync(receiptPath,'utf8'));
    if (receipt.version === app.getVersion()) {state.status='installed';state.installedVersion=receipt.version;fs.unlinkSync(receiptPath);}
    else {state.error='Lần cập nhật trước chưa được xác nhận. Xem update-result.txt trong dữ liệu app.';}
  } catch { /* No pending install. */ }
  ipcMain.handle('app-update-state',()=>({...state}));
  ipcMain.handle('check-app-update',check);
  ipcMain.handle('download-app-update',download);
  ipcMain.handle('install-app-update',install);
  if (app.isPackaged && state.status!=='installed') setTimeout(()=>check(),8000).unref();
}
