import fs from 'node:fs';
import path from 'node:path';
import {manifestName,verifyManifest,verifyArchive} from '../src/shared/update-security.mjs';
const directory = process.argv[2];
if (!directory) throw new Error('Usage: node scripts/verify-release.mjs release-directory');
const {version} = JSON.parse(fs.readFileSync('package.json','utf8'));
const publicKey = fs.readFileSync('assets/update-public.pem','utf8');
for (const [platform,arch] of [['win32','x64'],['darwin','arm64'],['darwin','x64']]) {
  const envelope = JSON.parse(fs.readFileSync(path.join(directory,manifestName(platform,arch)),'utf8'));
  const manifest = verifyManifest(envelope,publicKey,{platform,arch,version});
  await verifyArchive(path.join(directory,manifest.file),manifest);
  console.log(`Verified ${manifest.file}`);
}
