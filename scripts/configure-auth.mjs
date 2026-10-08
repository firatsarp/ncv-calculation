import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../lib/auth-core.mjs';

if (!process.stdin.isTTY) throw new Error('Run this script in an interactive terminal.');
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const question = (prompt) => new Promise(resolve => rl.question(prompt, resolve));
const username = await question('Username: ');
process.stdout.write('Password (hidden): ');
const originalWrite = rl._writeToOutput;
rl._writeToOutput = () => {};
const password = await question('');
rl._writeToOutput = originalWrite;
rl.close();
process.stdout.write('\n');
if (!username || !password) throw new Error('Username and password are required.');
console.log('AUTH_USERNAME=' + username);
console.log('AUTH_PASSWORD_HASH=' + await hashPassword(password));
console.log('AUTH_SESSION_SECRET=' + randomBytes(32).toString('hex'));
