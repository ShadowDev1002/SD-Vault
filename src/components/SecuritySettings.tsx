import { useState } from 'react';

const TIMEOUT_OPTIONS = [
    { value: 1, label: '1 Minute' },
    { value: 5, label: '5 Minuten' },
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
        <div className="space-y-4">
            <h3 className="text-sm font-semibold text-white">Auto-Lock</h3>
            <div className="grid grid-cols-1 gap-2">
                {TIMEOUT_OPTIONS.map(({ value, label }) => (
                    <button
                        key={value}
                        onClick={() => onTimeoutChange(value)}
                        className="flex items-center justify-between px-4 py-3 rounded-lg border text-sm transition-colors"
                        style={{
                            borderColor: lockTimeout === value ? 'var(--vault-accent)' : 'var(--vault-border)',
                            backgroundColor: lockTimeout === value ? '#1e1e5e' : 'var(--vault-bg)',
                            color: lockTimeout === value ? 'white' : 'var(--vault-muted)',
                        }}
                    >
                        <span>{label}</span>
                        {lockTimeout === value && <span style={{ color: 'var(--vault-accent)' }}>✓</span>}
                    </button>
                ))}
            </div>
        </div>
    );
}
