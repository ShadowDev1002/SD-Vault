import type { Theme } from '../utils/theme';
import { ACCENT_PRESETS } from '../utils/theme';

const TIMEOUT_OPTIONS = [
    { value: 1,  label: '1 Minute' },
    { value: 5,  label: '5 Minuten' },
    { value: 15, label: '15 Minuten' },
    { value: 30, label: '30 Minuten' },
    { value: 60, label: '1 Stunde' },
];

interface Props {
    lockTimeout: number;
    onTimeoutChange: (minutes: number) => void;
    theme: Theme;
    onThemeChange: (t: Theme) => void;
    accent: string;
    onAccentChange: (color: string) => void;
}

export default function SecuritySettings({ lockTimeout, onTimeoutChange, theme, onThemeChange, accent, onAccentChange }: Props) {
    return (
        <div className="space-y-6">
            {/* Accent color */}
            <div className="space-y-3">
                <div className="space-y-1">
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Akzentfarbe</h3>
                    <p className="text-xs" style={{ color: 'var(--text-2)' }}>Farbe für Buttons, Links und Markierungen.</p>
                </div>
                <div className="flex gap-2">
                    {ACCENT_PRESETS.map(p => (
                        <button
                            key={p.value}
                            title={p.label}
                            onClick={() => onAccentChange(p.value)}
                            className="w-8 h-8 rounded-full transition-transform"
                            style={{
                                backgroundColor: p.value,
                                transform: accent === p.value ? 'scale(1.2)' : 'scale(1)',
                                outline: accent === p.value ? `2px solid ${p.value}` : 'none',
                                outlineOffset: '2px',
                            }}
                        />
                    ))}
                </div>
            </div>

            <div className="border-t" style={{ borderColor: 'var(--border)' }} />

            {/* Theme */}
            <div className="space-y-3">
                <div className="space-y-1">
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Erscheinungsbild</h3>
                    <p className="text-xs" style={{ color: 'var(--text-2)' }}>Dunkles oder helles Design wählen.</p>
                </div>
                <div className="flex gap-2">
                    {(['dark', 'light'] as Theme[]).map(t => (
                        <button
                            key={t}
                            onClick={() => onThemeChange(t)}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-sm transition-colors"
                            style={{
                                borderColor: theme === t ? 'var(--accent)' : 'var(--border)',
                                backgroundColor: theme === t ? 'rgba(10,132,255,0.1)' : 'transparent',
                                color: theme === t ? 'var(--accent)' : 'var(--text-2)',
                            }}
                        >
                            {t === 'dark' ? '🌙 Dunkel' : '☀️ Hell'}
                        </button>
                    ))}
                </div>
            </div>

            <div className="border-t" style={{ borderColor: 'var(--border)' }} />

            {/* Lock timeout */}
            <div className="space-y-3">
                <div className="space-y-1">
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Automatische Sperre</h3>
                    <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                        Vault wird nach Inaktivität automatisch gesperrt.
                    </p>
                </div>
                <div className="space-y-1.5">
                    {TIMEOUT_OPTIONS.map(({ value, label }) => {
                        const active = lockTimeout === value;
                        return (
                            <button
                                key={value}
                                onClick={() => onTimeoutChange(value)}
                                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-sm text-left transition-colors"
                                style={{
                                    borderColor: active ? 'var(--accent)' : 'var(--border)',
                                    backgroundColor: active ? 'rgba(10,132,255,0.1)' : 'transparent',
                                    color: active ? 'var(--text)' : 'var(--text-2)',
                                }}
                            >
                                <span
                                    className="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0"
                                    style={{ borderColor: active ? 'var(--accent)' : 'var(--border)' }}
                                >
                                    {active && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />}
                                </span>
                                <span>{label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
