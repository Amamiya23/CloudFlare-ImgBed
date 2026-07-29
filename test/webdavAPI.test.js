import assert from 'node:assert/strict';
import { WebDAVAPI } from '../functions/utils/storage/webdavAPI.js';

describe('WebDAVAPI redirected reads', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('follows an OpenList-style cross-origin 302 without forwarding credentials', async () => {
        const calls = [];
        globalThis.fetch = async (url, options) => {
            calls.push({ url, options });
            if (calls.length === 1) {
                return new Response(null, {
                    status: 302,
                    headers: { Location: 'https://objects.example.com/signed/file.webp?token=abc' },
                });
            }
            return new Response('image data', { status: 200 });
        };

        const api = new WebDAVAPI({
            baseUrl: 'https://dav.example.com/dav/',
            username: 'alice',
            password: 'secret',
            headers: {
                Cookie: 'session=private',
                'X-WebDAV-Token': 'also-private',
            },
        });
        const response = await api.getFile('photos/file.webp', {
            headers: { Range: 'bytes=0-99' },
        });

        assert.equal(await response.text(), 'image data');
        assert.equal(calls.length, 2);
        assert.equal(calls[0].options.redirect, 'manual');
        assert.match(calls[0].options.headers.get('Authorization'), /^Basic /);
        assert.equal(calls[0].options.headers.get('Cookie'), 'session=private');
        assert.equal(calls[1].url, 'https://objects.example.com/signed/file.webp?token=abc');
        assert.equal(calls[1].options.headers.get('Authorization'), null);
        assert.equal(calls[1].options.headers.get('Cookie'), null);
        assert.equal(calls[1].options.headers.get('X-WebDAV-Token'), null);
        assert.equal(calls[1].options.headers.get('Range'), 'bytes=0-99');
    });

    it('resolves relative redirects and retains credentials on the same origin', async () => {
        const calls = [];
        globalThis.fetch = async (url, options) => {
            calls.push({ url, options });
            if (calls.length === 1) {
                return new Response(null, {
                    status: 307,
                    headers: { Location: '../download/file.webp' },
                });
            }
            return new Response(null, { status: 200 });
        };

        const api = new WebDAVAPI({
            baseUrl: 'https://dav.example.com/dav/',
            username: 'alice',
            password: 'secret',
        });
        await api.getFile('photos/file.webp', { method: 'HEAD' });

        assert.equal(calls[1].url, 'https://dav.example.com/dav/download/file.webp');
        assert.equal(calls[1].options.method, 'HEAD');
        assert.match(calls[1].options.headers.get('Authorization'), /^Basic /);
    });

    it('keeps a redirect response without Location available for the normal error message', async () => {
        globalThis.fetch = async () => new Response('<a href="https://objects.example.com/file">download</a>', {
            status: 302,
            statusText: 'Found',
        });

        const api = new WebDAVAPI({ baseUrl: 'https://dav.example.com/dav/' });

        await assert.rejects(
            () => api.getFile('file.webp'),
            /WebDAV GET failed: 302 Found/
        );
    });

    it('stops redirect loops after five redirects', async () => {
        let callCount = 0;
        globalThis.fetch = async () => {
            callCount++;
            return new Response(null, {
                status: 302,
                headers: { Location: `/redirect-${callCount}` },
            });
        };

        const api = new WebDAVAPI({ baseUrl: 'https://dav.example.com/dav/' });

        await assert.rejects(
            () => api.getFile('file.webp'),
            /too many redirects \(maximum 5\)/
        );
        assert.equal(callCount, 6);
    });
});
