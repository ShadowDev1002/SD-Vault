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
}

export default function SecuritySettings({ lockTimeout, onTimeoutChange }: Props) {
    return (
        <div className="space-y-6">
            <div className="space-y-1">
                <h3 className="text-sm font-semibold text-white">Automatische Sperre</h3>
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
                                color: active ? 'white' : 'var(--text-2)',
                            }}
                        >
                            {/* Radio dot */}
                            <span
                                className="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0"
                                style={{ borderColor: active ? 'var(--accent)' : 'var(--border)' }}
                            >
                                {active && (
                                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
                                )}
                            </span>
                            <span>{label}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
