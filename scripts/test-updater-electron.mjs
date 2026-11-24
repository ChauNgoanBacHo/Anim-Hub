// Runs in Electron, not plain Node: Electron patches fs.open for *.asar paths.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import electron from 'electron';
import {makeZip} from './zip-fixture.mjs';
import {BUNDLE_NAME} from '../src/shared/update-security.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(),'xom-electron-regression-'));
try {
  const input=path.join(root,'input');fs.mkdirSync(input);
  fs.writeFileSync(path.join(input,'package.json'),JSON.stringify({name:'xom-nha-la',version:'1.2.3'}));
  const asar=path.join(root,'fixture.asar');
  execFileSync(process.execPath,['--input-type=module','-e',"import asar from '@electron/asar';await asar.createPackage(process.argv[1],process.argv[2]);",input,asar],{stdio:'pipe'});
  const zip=path.join(root,'fixture.zip');
  makeZip(zip,[{name:`${BUNDLE_NAME}/Contents/Resources/app.asar`,content:fs.readFileSync(asar)}]);
  const harness=path.join(root,'check.cjs');
  fs.writeFileSync(harness,`
    const {app}=require('electron');const fs=require('original-fs');const path=require('node:path');
    app.whenReady().then(async()=>{
      try {
        const {extractUpdateZip}=await import(${JSON.stringify(new URL('../src/shared/update-zip.mjs',import.meta.url).href)});
        const {readUpdatePackage}=await import(${JSON.stringify(new URL('../src/shared/update-package.mjs',import.meta.url).href)});
        const destination=${JSON.stringify(path.join(root,'staged'))};
        fs.mkdirSync(destination);
        await extractUpdateZip(${JSON.stringify(zip)},destination,'darwin',fs);
        const pkg=readUpdatePackage(path.join(destination,${JSON.stringify(BUNDLE_NAME)},'Contents/Resources/app.asar'));
        if(pkg.version!=='1.2.3')throw new Error('Wrong staged version');
        console.log('PASS: Electron extracted and read staged app.asar through original-fs');app.exit(0);
      } catch(error){console.error(error.stack);app.exit(1);}
    });
  `);
  execFileSync(electron,[harness],{stdio:'inherit',timeout:30000});
} finally {fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
