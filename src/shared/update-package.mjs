import asar from '@electron/asar';

// @electron/asar uses original-fs in Electron, bypassing the mounted ASAR cache
// while leaving the installed application's integrity checks enabled.
export function readUpdatePackage(archive) {
  try {
    const info = asar.statFile(archive,'package.json');
    if (info.unpacked || info.link || !Number.isSafeInteger(info.size) || info.size > 1024*1024) throw new Error('Package metadata trong bản cập nhật không hợp lệ.');
    return JSON.parse(asar.extractFile(archive,'package.json').toString('utf8'));
  } finally { asar.uncache(archive); }
}
