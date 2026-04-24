let clipboardTimer: ReturnType<typeof setTimeout> | null = null;

export async function copyToClipboard(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        return;
    }

    if (clipboardTimer !== null) {
        clearTimeout(clipboardTimer);
    }

    clipboardTimer = setTimeout(async () => {
        try {
            await navigator.clipboard.writeText('');
        } catch { /* ignore — clipboard unavailable */ }
        clipboardTimer = null;
    }, 30_000);
}
