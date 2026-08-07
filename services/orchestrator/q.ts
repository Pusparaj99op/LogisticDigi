import { getFirestore } from 'firebase-admin/firestore';
import { adminApp } from './src/admin.js';
console.log('  runs:', (await getFirestore(adminApp()).collection('runs').limit(300).get()).size);
