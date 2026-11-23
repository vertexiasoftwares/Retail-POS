import fs from 'node:fs';

const content = fs.readFileSync('electron/licensing/cloudClient.mts', 'utf8');
const lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('register(')) {
    console.log(lines.slice(i, i + 25).join('\n'));
    break;
  }
}
