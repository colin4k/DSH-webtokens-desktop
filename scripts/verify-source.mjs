import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const manifest=JSON.parse(readFileSync(new URL('../SOURCE.json',import.meta.url)));
const adaptation=JSON.parse(readFileSync(new URL('../ADAPTATION.json',import.meta.url)));
for(const [file,expected] of Object.entries({...manifest.sha256,...adaptation.sha256})) assert.equal(createHash('sha256').update(readFileSync(new URL('../'+file,import.meta.url))).digest('hex'),expected,file);
console.log('Verified baseline plus Desktop adaptation: '+adaptation.targetHarnessTag);
