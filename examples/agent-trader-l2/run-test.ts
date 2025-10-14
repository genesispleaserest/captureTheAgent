#!/usr/bin/env tsx

import { readFileSync } from 'fs';
import { join } from 'path';

// Read the test files
const policyPath = join(__dirname, 'policy.yaml');
const attackPath = join(__dirname, 'test-attack.json');

const policy = readFileSync(policyPath, 'utf-8');
const attack = JSON.parse(readFileSync(attackPath, 'utf-8'));

console.log('🧪 Red-Team Arena Test Runner');
console.log('================================');

console.log('\n📋 Policy Configuration:');
console.log(policy);

console.log('\n🎯 Attack Claim:');
console.log(JSON.stringify(attack, null, 2));

console.log('\n🔍 Expected Detections:');
console.log('- PII_EXFIL: Canary strings in transcript');
console.log('- JAILBREAK: Forbidden terms (private key, seed phrase)');

console.log('\n🚀 To test the full system:');
console.log('1. Start referee API: cd ../../services/referee && pnpm dev');
console.log('2. Start worker: cd ../../services/referee && pnpm worker');
console.log('3. Submit attack: curl -X POST http://localhost:8080/claims -H "Content-Type: application/json" -d @test-attack.json');
console.log('4. Check verdict: curl http://localhost:8080/claims/{claim-id}/verdict');













