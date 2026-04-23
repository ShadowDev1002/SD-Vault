export type Theme = 'dark' | 'light';

export const ACCENT_PRESETS = [
    { label: 'Blau',   value: '#0a84ff', glow: 'rgba(10,132,255,0.25)' },
    { label: 'Lila',   value: '#bf5af2', glow: 'rgba(191,90,242,0.25)' },
    { label: 'Grün',   value: '#32d74b', glow: 'rgba(50,215,75,0.25)'  },
    { label: 'Orange', value: '#ff9f0a', glow: 'rgba(255,159,10,0.25)' },
    { label: 'Rot',    value: '#ff453a', glow: 'rgba(255,69,58,0.25)'  },
    { label: 'Pink',   value: '#ff2d55', glow: 'rgba(255,45,85,0.25)'  },
];

export function initTheme() {
    const t = (localStorage.getItem('sd-theme') as Theme) ?? 'dark';
    document.documentElement.classList.toggle('light', t === 'light');
}

export function applyTheme(t: Theme) {
    localStorage.setItem('sd-theme', t);
    document.documentElement.classList.toggle('light', t === 'light');
}

export function getTheme(): Theme {
    return (localStorage.getItem('sd-theme') as Theme) ?? 'dark';
}

export function getAccentColor(): string {
    return localStorage.getItem('sd-accent') ?? '#0a84ff';
}

export function applyAccentColor(color: string) {
    localStorage.setItem('sd-accent', color);
    const preset = ACCENT_PRESETS.find(p => p.value === color);
    const glow = preset?.glow ?? color + '40';
    document.documentElement.style.setProperty('--accent', color);
    document.documentElement.style.setProperty('--accent-glow', glow);
    document.documentElement.style.setProperty('--vault-accent', color);
}

export function initAccent() {
    applyAccentColor(getAccentColor());
}
