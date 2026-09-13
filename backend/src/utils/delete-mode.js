import { RequestInvalidError } from '@/restful/errors';

// Old clients must not turn an archive request into a permanent deletion.
export function validateDeleteMode(mode) {
    if (mode == null || mode === '' || mode === 'permanent') return;
    throw new RequestInvalidError(
        'INVALID_DELETE_MODE',
        `Unsupported delete mode: ${mode}`,
    );
}
