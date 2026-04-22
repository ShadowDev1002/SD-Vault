let clipboardTimer: ReturnType<typeof setTimeout> | null = null;

export async function copyToClipboard(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);

    if (clipboardTimer !== null) {
        clearTimeout(clipboardTimer);
    }

    clipboardTimer = setTimeout(async () => {
        await navigator.clipboard.writeText('');
        clipboardTimer = null;
    }, 30_000);
}
