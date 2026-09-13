#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readJson, atomicJson, sha256, isWithin } = require('../backend/src/management/contract.cjs');
const { newCredentials, validateCredentials, hashPassword, randomSecret } = require('../backend/src/management/auth-store.cjs');

async function main() {
    const [command, ...args] = process.argv.slice(2);
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
        if (!['--auth-file', '--output'].includes(args[index]) || !args[index + 1]) throw new Error('INVALID_ARGUMENTS');
        options[args[index]] = args[index + 1];
    }
    const file = options['--auth-file'] || '/etc/sub-store/auth.json';
    const output = options['--output'];
    if (!['init', 'reset-password', 'rotate-api-token'].includes(command) || !output || !path.isAbsolute(file)) {
        throw new Error('Usage: auth-cli.cjs init|reset-password|rotate-api-token --output ABSOLUTE_PRIVATE_FILE [--auth-file PATH]');
    }
    if (output !== '-' && (!path.isAbsolute(output) || isWithin(path.resolve(__dirname, '..'), output) || isWithin('/var/lib/sub-store/data', output))) {
        throw new Error('CREDENTIAL_OUTPUT_MUST_BE_OUTSIDE_PROJECT_AND_DATA');
    }
    if (output !== '-' && fs.existsSync(output)) throw new Error('CREDENTIAL_OUTPUT_ALREADY_EXISTS');
    let credentials;
    let secrets;
    if (command === 'init') {
        if (fs.existsSync(file)) throw new Error('AUTH_ALREADY_INITIALIZED');
        ({ credentials, secrets } = await newCredentials());
    } else {
        credentials = validateCredentials(readJson(file));
        if (command === 'reset-password') {
            const password = randomSecret();
            credentials.password = await hashPassword(password);
            credentials.sessionEpoch = crypto.randomBytes(16).toString('hex');
            secrets = { username: 'admin', password };
        } else {
            const apiToken = randomSecret();
            credentials.apiTokenHash = sha256(apiToken);
            secrets = { apiToken };
        }
    }
    const previousStat = fs.existsSync(file) ? fs.statSync(file) : null;
    let descriptor;
    if (output !== '-') descriptor = fs.openSync(output, 'wx', 0o600);
    try {
        atomicJson(file, credentials, previousStat ? previousStat.mode & 0o777 : 0o600);
        if (previousStat && process.platform !== 'win32') fs.chownSync(file, previousStat.uid, previousStat.gid);
        const text = `${JSON.stringify(secrets, null, 2)}\n`;
        if (output === '-') process.stdout.write(text);
        else { fs.writeFileSync(descriptor, text); fs.fsyncSync(descriptor); }
    } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
    if (output !== '-') console.log(`Credentials written to ${output}`);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
