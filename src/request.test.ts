import { afterEach, describe, expect, it, vi } from 'vitest';

import { request } from './request.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function setFetch(impl: typeof fetch): typeof fetch {
  const f = impl as unknown as typeof fetch;
  globalThis.fetch = f;
  return f;
}

function okRes(body: string, status = 200, statusText = 'OK'): typeof fetch {
  return setFetch((async () => ({
    ok: true,
    status,
    statusText,
    text: async () => body,
  })) as unknown as typeof fetch);
}

function errRes(status: number, statusText: string): typeof fetch {
  return setFetch((async () => ({
    ok: false,
    status,
    statusText,
    text: async () => '',
  })) as unknown as typeof fetch);
}

describe('request', () => {
  it('returns response body text on a successful 200 response', async () => {
    okRes('hello body');
    expect(await request('https://example.com/x', { headers: {} })).toBe(
      'hello body',
    );
  });

  it('returns body for 201 Created (ok=true)', async () => {
    okRes('created body', 201, 'Created');
    expect(await request('https://example.com', {})).toBe('created body');
  });

  it('returns an empty string when response body is empty', async () => {
    okRes('', 204, 'No Content');
    expect(await request('https://example.com', {})).toBe('');
  });

  it('throws on 404 response, including status and statusText', async () => {
    errRes(404, 'Not Found');
    await expect(request('https://example.com', {})).rejects.toThrow(
      'Fetch request error: 404, Not Found',
    );
  });

  it('throws on 500 server error response', async () => {
    errRes(500, 'Internal Server Error');
    await expect(request('https://example.com', {})).rejects.toThrow(
      'Fetch request error: 500, Internal Server Error',
    );
  });

  it('throws on 403 forbidden response', async () => {
    errRes(403, 'Forbidden');
    await expect(request('https://example.com', {})).rejects.toThrow(
      'Fetch request error: 403, Forbidden',
    );
  });

  it('wraps a fetch rejection into "Fetch error" with cause preserved', async () => {
    const networkErr = new TypeError('getaddrinfo ENOTFOUND');
    setFetch(
      vi.fn(() => Promise.reject(networkErr)) as unknown as typeof fetch,
    );

    let caught: unknown;
    try {
      await request('https://example.com', {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('Fetch error');
    expect((caught as Error).cause).toBe(networkErr);
  });

  it('passes URL and opts through to fetch untouched', async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => 'ok',
    })) as unknown as typeof fetch;
    setFetch(spy);

    const opts = {
      method: 'POST',
      headers: { 'X-Test': '1' },
      body: 'payload',
    } as RequestInit;
    await request('https://example.com/api', opts);

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, passedOpts] = (spy as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(url).toBe('https://example.com/api');
    expect(passedOpts).toStrictEqual(opts);
  });

  it('works with a URL object as the first argument', async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => 'ok',
    })) as unknown as typeof fetch;
    setFetch(spy);

    const u = new URL('https://example.com/p?x=1');
    await request(u, {});
    expect((spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(
      u,
    );
  });

  it('propagates the same opts object identity to fetch', async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => 'ok',
    })) as unknown as typeof fetch;
    setFetch(spy);

    const opts: RequestInit = { method: 'GET' };
    await request('https://example.com', opts);
    expect((spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toBe(
      opts,
    );
  });

  it('returns the resolved value of text() as-is (string type)', async () => {
    okRes('multi\nline\nbody');
    const out = await request('https://example.com', {});
    expect(typeof out).toBe('string');
    expect(out).toBe('multi\nline\nbody');
  });

  it('returns body text containing JSON payload as a plain string', async () => {
    okRes('{"data":[]}');
    expect(await request('https://example.com', {})).toBe('{"data":[]}');
  });

  it('accepts undefined opts (passes through to fetch)', async () => {
    const spy = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => 'ok',
    })) as unknown as typeof fetch;
    setFetch(spy);

    await request('https://example.com', undefined as unknown as RequestInit);
    const call = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe('https://example.com');
    expect(call[1]).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not swallow errors thrown synchronously by fetch', async () => {
    const syncErr = new RangeError('bad url');
    setFetch((() => {
      throw syncErr;
    }) as unknown as typeof fetch);

    await expect(request('https://example.com', {})).rejects.toBe(syncErr);
  });
});
