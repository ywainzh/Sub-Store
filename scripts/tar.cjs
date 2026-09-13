'use strict';
const zlib = require('node:zlib');
function createTarGz(entries) {
    const blocks = [];
    for (const { name, bytes, type = '0' } of entries) {
        const header = Buffer.alloc(512);
        let shortName = name;
        if (Buffer.byteLength(shortName) > 100) {
            const split = name.lastIndexOf('/');
            const prefix = name.slice(0, split);
            shortName = name.slice(split + 1);
            if (Buffer.byteLength(prefix) > 155 || Buffer.byteLength(shortName) > 100) throw new Error('USTAR_PATH_TOO_LONG');
            header.write(prefix, 345, 155);
        }
        header.write(shortName, 0, 100);
        const octal = (number, offset, length) => header.write(number.toString(8).padStart(length - 1, '0') + '\0', offset, length);
        octal(type === '5' ? 0o755 : 0o644, 100, 8);
        octal(0, 108, 8); octal(0, 116, 8);
        octal(bytes.length, 124, 12); octal(0, 136, 12);
        header.fill(32, 148, 156);
        header.write(type, 156, 1);
        header.write('ustar\0', 257, 6);
        header.write('00', 263, 2);
        const checksum = header.reduce((sum, byte) => sum + byte, 0);
        header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
        blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
    }
    blocks.push(Buffer.alloc(1024));
    return zlib.gzipSync(Buffer.concat(blocks), { level: 9 });
}
module.exports = { createTarGz };
