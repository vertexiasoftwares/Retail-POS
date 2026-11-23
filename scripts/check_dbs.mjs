import { VertexiaDatabase } from '../electron-dist/electron/database/database.mjs';
import { AuthRepository } from '../electron-dist/electron/database/auth.mjs';
import path from 'node:path';

console.log('--- Checking workspace data/vertexia.db ---');
try {
  const db1 = new VertexiaDatabase('data/vertexia.db');
  const auth1 = new AuthRepository(db1.connection);
  console.log('Status 1:', auth1.status());
  const users1 = db1.connection.prepare('SELECT id, name, role FROM users').all();
  console.log('Users in data/vertexia.db:', users1);
  const creds1 = db1.connection.prepare('SELECT user_id, username FROM user_credentials').all();
  console.log('Credentials in data/vertexia.db:', creds1);
} catch (e) {
  console.log('Error checking data/vertexia.db:', e.message);
}

if (process.env.APPDATA) {
  const appDataPath = path.join(process.env.APPDATA, 'vertexia-retail-pos', 'data', 'vertexia.db');
  console.log('\n--- Checking APPDATA database:', appDataPath, '---');
  try {
    const db2 = new VertexiaDatabase(appDataPath);
    const auth2 = new AuthRepository(db2.connection);
    console.log('Status 2:', auth2.status());
    const users2 = db2.connection.prepare('SELECT id, name, role FROM users').all();
    console.log('Users in APPDATA:', users2);
    const creds2 = db2.connection.prepare('SELECT user_id, username FROM user_credentials').all();
    console.log('Credentials in APPDATA:', creds2);
  } catch (e) {
    console.log('Error checking APPDATA db:', e.message);
  }
}
