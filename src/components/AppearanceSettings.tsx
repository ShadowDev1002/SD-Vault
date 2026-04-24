import type { Theme } from '../utils/theme';
import { ACCENT_PRESETS } from '../utils/theme';

interface Props {
    theme: Theme;
    onThemeChange: (t: Theme) => void;
    accent: string;
    onAccentChange: (color: string) => void;
}

export default function AppearanceSettings({ theme, onThemeChange, accent, onAccentChange }: Props) {
    return (
        <div className="space-y-6">
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
        </div>
    );
}
