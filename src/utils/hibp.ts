export async function checkHibp(password: string): Promise<number> {
    if (!password) return 0;
    const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
    const hex = Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
    const prefix = hex.slice(0, 5);
    const suffix = hex.slice(5);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true' },
    });
    if (!res.ok) throw new Error('HIBP API nicht erreichbar');

    const text = await res.text();
    const line = text.split('\r\n').find(l => l.startsWith(suffix));
    return line ? parseInt(line.split(':')[1], 10) : 0;
}
