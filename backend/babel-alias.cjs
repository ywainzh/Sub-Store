'use strict';
const path = require('node:path');

// Resolve from the actual source filename on both Windows and Linux.
module.exports = () => {
    const replace = (source, state) => {
        if (!source || typeof source.value !== 'string' || !source.value.startsWith('@/')) return;
        const target = path.resolve(__dirname, 'src', source.value.slice(2));
        const relative = path.relative(path.dirname(state.file.opts.filename), target).split(path.sep).join('/');
        source.value = relative.startsWith('.') ? relative : `./${relative}`;
    };
    return { visitor: {
        ImportDeclaration: (nodePath, state) => replace(nodePath.node.source, state),
        ExportNamedDeclaration: (nodePath, state) => replace(nodePath.node.source, state),
        ExportAllDeclaration: (nodePath, state) => replace(nodePath.node.source, state),
        CallExpression: (nodePath, state) => {
            if (nodePath.node.callee.name === 'require') replace(nodePath.node.arguments[0], state);
        },
    } };
};
