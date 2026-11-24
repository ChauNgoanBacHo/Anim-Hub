import fs from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import yauzl from 'yauzl';
import {safeZipPath,safeSymlink,MAX_EXPANDED_SIZE,BUNDLE_NAME} from './update-security.mjs';

// Extract regular files first, symlinks last; never write through an archive symlink.
export async function extractUpdateZip(archive, destination, platform, io = fs) {
  const zip = await new Promise((resolve,reject) => yauzl.open(archive,{lazyEntries:true,validateEntrySizes:true,decodeStrings:false},(error,value) => error ? reject(error) : resolve(value)));
  const entries = [], links = [], seen = new Set(); let expanded = 0, count = 0;
  const root = BUNDLE_NAME;
  try {
    await new Promise((resolve,reject) => {
      zip.on('error',reject); zip.on('end',resolve);
      zip.on('entry',entry => {
        (async () => {
          // Forge ZIPs can contain UTF-8 names without setting the ZIP UTF-8 flag.
          const decodedName = new TextDecoder("utf-8",{fatal:true}).decode(entry.fileName).normalize("NFC");
          const name = safeZipPath(decodedName,platform);
          if (name.startsWith('__MACOSX/')) { zip.readEntry(); return; }
          if (platform === 'darwin' && name !== `${root}/` && !name.startsWith(`${root}/`)) throw new Error('ZIP macOS không có đúng app bundle.');
          const normalized = name.replace(/\/$/,'');
          const key = normalized.toLowerCase();
          if (seen.has(key)) throw new Error('ZIP chứa đường dẫn trùng nhau.');
          seen.add(key);
          if (++count > 40000 || (expanded += entry.uncompressedSize) > MAX_EXPANDED_SIZE) throw new Error('ZIP cập nhật vượt giới hạn giải nén.');
          const mode = entry.externalFileAttributes >>> 16;
          const type = mode & 0o170000;
          if (entry.generalPurposeBitFlag & 1) throw new Error('Không hỗ trợ ZIP mã hoá.');
          if (![0,0o100000,0o040000,0o120000].includes(type)) throw new Error('ZIP chứa loại file không hỗ trợ.');
          const target = path.join(destination,...normalized.split('/'));
          if (name.endsWith('/')) await io.promises.mkdir(target,{recursive:true,mode:0o755});
          else {
            const stream = await new Promise((res,rej) => zip.openReadStream(entry,(err,value) => err ? rej(err) : res(value)));
            if (type === 0o120000) {
              if (platform !== 'darwin' || entry.uncompressedSize > 4096) { stream.destroy(); throw new Error('Symlink không được phép.'); }
              const chunks = []; for await (const chunk of stream) chunks.push(chunk);
              const value = new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)).normalize('NFC');
              safeSymlink(normalized,value,root); links.push({name:normalized,target,value});
            } else {
              await io.promises.mkdir(path.dirname(target),{recursive:true,mode:0o755});
              await pipeline(stream,io.createWriteStream(target,{fs:io,flags:'wx',mode:mode & 0o111 ? 0o755 : 0o644}));
            }
          }
          entries.push(normalized); zip.readEntry();
        })().catch(reject);
      }); zip.readEntry();
    });
    for (const link of links) {
      if (entries.some(name => name.toLowerCase().startsWith(`${link.name.toLowerCase()}/`))) throw new Error('ZIP ghi file bên dưới symlink.');
      await io.promises.mkdir(path.dirname(link.target),{recursive:true});
      await io.promises.symlink(link.value,link.target);
    }
  } finally { zip.close(); }
}
