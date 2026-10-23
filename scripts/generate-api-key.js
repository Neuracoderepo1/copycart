// Generates a NEW API key. This is key generation only: it does not read, print or modify any
// existing secret, and it does not provision anything. Provisioning is a separate operator step:
// add the printed hash to COPYCART_API_KEY_HASHES in the deployment environment.
// Authentication happens in src/auth.js, which compares SHA-256 hashes in constant time.
import { randomBytes } from 'node:crypto';
import { hashKey } from '../src/auth.js';

const key = `cc_${randomBytes(32).toString('base64url')}`;
console.log('New API key (shown once, store it in a secret manager):');
console.log(key);
console.log('\nHash to provision (append to COPYCART_API_KEY_HASHES, comma separated):');
console.log(hashKey(key));
