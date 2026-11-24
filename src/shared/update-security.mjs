import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const UPDATE_APP_ID = 'io.enotion.xom-nha-la';
export const UPDATE_REPO = 'ChauNgoanBacHo/Anim-Hub';
export const PRODUCT_NAME = 'Xóm Nhà Lá';
export const EXECUTABLE_NAME = 'XomNhaLa';
export const BUNDLE_NAME = 'XomNhaLa.app';
export const MAX_UPDATE_SIZE = 600 * 1024 * 1024;
export const MAX_EXPANDED_SIZE = 2 * 1024 * 1024 * 1024;
export function newerVersion(next, current) {
  const parse = value => String(value).replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number);
  const a = parse(next), b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export function manifestName(platform, arch) { return `update-${platform}-${arch}.json`; }
export function artifactName(version, platform, arch) {
  return platform === 'darwin' ? `Xom-Nha-La-macOS-${arch}-v${version}.zip` : `Xom-Nha-La-portable-v${version}.zip`;
}
export function verifyManifest(envelope, publicKey, expected) {
  if (!envelope || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string' || envelope.payload.length > 16000) throw new Error('Manifest cập nhật không hợp lệ.');
  const bytes = Buffer.from(envelope.payload, 'base64');
  if (!crypto.verify(null, bytes, publicKey, Buffer.from(envelope.signature, 'base64'))) throw new Error('Chữ ký release không hợp lệ. Không cài bản cập nhật này.');
  const value = JSON.parse(bytes.toString('utf8'));
  if (value.schema !== 1 || value.appId !== UPDATE_APP_ID || value.platform !== expected.platform || value.arch !== expected.arch || value.version !== expected.version) throw new Error('Manifest không khớp app, phiên bản hoặc kiến trúc.');
  if (!/^\d+\.\d+\.\d+$/.test(value.version) || value.file !== artifactName(value.version,value.platform,value.arch)) throw new Error('Tên file cập nhật không hợp lệ.');
  if (!Number.isSafeInteger(value.size) || value.size <= 0 || value.size > MAX_UPDATE_SIZE || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('Kích thước hoặc SHA-256 cập nhật không hợp lệ.');
  return value;
}
export async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function verifyArchive(file, manifest) {
  if ((await fs.promises.stat(file)).size !== manifest.size || await sha256File(file) !== manifest.sha256) throw new Error('File tải về bị thiếu hoặc checksum không đúng. Hãy tải lại.');
}
export function safeZipPath(name, platform) {
  if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').some(p => p === '..' || p === '.')) throw new Error('ZIP chứa đường dẫn không an toàn.');
  if (platform === 'win32' && name.split('/').some(p => p && (/[<>:"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))) throw new Error('ZIP chứa tên file Windows không an toàn.');
  return name;
}
export function safeSymlink(name, target, bundleRoot) {
  if (!target || path.posix.isAbsolute(target) || target.includes('\\') || target.includes('\0')) throw new Error('ZIP chứa symlink không an toàn.');
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), target));
  if (resolved !== bundleRoot && !resolved.startsWith(`${bundleRoot}/`)) throw new Error('Symlink thoát khỏi app bundle.');
}
