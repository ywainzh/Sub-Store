import { version as substoreVersion } from '../../package.json';
import { ENV } from '@/vendor/open-api';

const {
    isNode,
    isQX,
    isLoon,
    isSurge,
    isStash,
    isShadowRocket,
    isLanceX,
    isEgern,
    isGUIforCores,
} = ENV();
let backend = 'Node';
if (isNode) {
    backend = 'Node';
} else if (isQX) {
    backend = 'QX';
} else if (isLoon) {
    backend = 'Loon';
} else if (isStash) {
    backend = 'Stash';
} else if (isShadowRocket) {
    backend = 'Shadowrocket';
} else if (isEgern) {
    backend = 'Egern';
} else if (isSurge) {
    backend = 'Surge';
} else if (isLanceX) {
    backend = 'LanceX';
} else if (isGUIforCores) {
    backend = 'GUI.for.Cores';
}

let meta = {};
let feature = {};
feature.subscriptionAvailability = true;
let projectVersion;

try {
    if (typeof $environment !== 'undefined') {
        // eslint-disable-next-line no-undef
        meta.env = $environment;
    }
    if (typeof $loon !== 'undefined') {
        // eslint-disable-next-line no-undef
        meta.loon = $loon;
    }
    if (typeof $script !== 'undefined') {
        // eslint-disable-next-line no-undef
        meta.script = $script;
    }
    if (typeof $Plugin !== 'undefined') {
        // eslint-disable-next-line no-undef
        meta.plugin = $Plugin;
    }
    if (isNode) {
        projectVersion = require('../management/index.cjs').loadManifest()?.tag;
        meta.node = {
            version: eval('process.version'),
            env: {},
        };
        const env = eval('process.env');
        // Only presentation and public routing settings belong in this API. Never expose credentials,
        // auth/deployment paths, command arguments or arbitrary environment values.
        for (const key of [
            'SUB_STORE_BACKEND_CUSTOM_NAME',
            'SUB_STORE_DOCKER',
            'SUB_STORE_FRONTEND_BACKEND_PATH',
        ]) {
            if (env[key] !== undefined) {
                meta.node.env[key] = env[key];
            }
        }
    }
    // eslint-disable-next-line no-empty
} catch (e) {}

export default {
    backend,
    version: substoreVersion,
    projectVersion,
    feature,
    meta,
};
