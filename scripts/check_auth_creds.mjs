import fs from 'node:fs';

const content = fs.readFileSync('electron/database/auth.mts', 'utf8');
const start = content.indexOf('authenticateCredentials(');
if (start !== -1) {
  console.log(content.slice(start, start + 700));
}
