const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(s: string): Uint8Array {
    const input = s.toUpperCase().replace(/\s|=/g, '');
    let bits = 0, val = 0;
    const out: number[] = [];
    for (const c of input) {
        const idx = B32.indexOf(c);
        if (idx < 0) continue;
        val = (val << 5) | idx;
        bits += 5;
        if (bits >= 8) { bits -= 8; out.push((val >>> bits) & 0xff); }
    }
    return new Uint8Array(out);
}

export async function generateTotp(secret: string): Promise<{ code: string; remaining: number }> {
    const raw = secret.startsWith('otpauth://')
        ? new URL(secret).searchParams.get('secret') ?? secret
        : secret;

    const key = base32Decode(raw);
    const epoch = Math.floor(Date.now() / 1000);
    const step = Math.floor(epoch / 30);
    const remaining = 30 - (epoch % 30);

    const counter = new ArrayBuffer(8);
    new DataView(counter).setUint32(4, step, false);

    const cryptoKey = await crypto.subtle.importKey(
        'raw', key.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counter));

    const offset = hmac[19] & 0xf;
    const code = (
        ((hmac[offset]     & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8)  |
         (hmac[offset + 3] & 0xff)
    ) % 1_000_000;

    return { code: code.toString().padStart(6, '0'), remaining };
}
