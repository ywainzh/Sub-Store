'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// npm_config_user_agent can be inherited from a parent package manager in CI.
// Check the lifecycle launcher itself instead of trusting that descriptive string.
try {
    const executable = process.env.npm_execpath;
    if (!executable || !/^pnpm(?:\.(?:cjs|mjs|js|exe))?$/.test(path.basename(executable))) throw new Error();
    const isScript = /\.(?:cjs|mjs|js)$/.test(executable);
    const version = execFileSync(isScript ? process.execPath : executable, isScript ? [executable, '--version'] : ['--version'], {
        encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (version !== '11.0.9') throw new Error();
} catch {
    console.error('Use the pinned package manager: pnpm@11.0.9');
    process.exitCode = 1;
}
