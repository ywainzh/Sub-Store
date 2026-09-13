'use strict';
if (!/^pnpm\/11\.0\.9(?:\s|$)/.test(process.env.npm_config_user_agent || '')) {
    console.error('Use the pinned package manager: pnpm@11.0.9');
    process.exitCode = 1;
}
