import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { VaultMeta } from '../types';

interface Props {
    onUnlocked: (meta: VaultMeta) => void;
}

function ShieldIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" className="w-10 h-10" aria-hidden="true">
            <path
                d="M12 2L3 6v6c0 5.25 3.75 10.15 9 11.25C17.25 22.15 21 17.25 21 12V6L12 2z"
                fill="url(#shieldGrad)"
            />
            <path
                d="M9 12l2 2 4-4"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <defs>
                <linearGradient id="shieldGrad" x1="3" y1="2" x2="21" y2="23" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#818cf8" />
                    <stop offset="1" stopColor="#6366f1" />
                </linearGradient>
            </defs>
        </svg>
    );
}

export default function LockScreen({ onUnlocked }: Props) {
    const [masterPw, setMasterPw] = useState('');
    const [secretKey, setSecretKey] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    async function handleUnlock(e: React.FormEvent) {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const meta = await invoke<VaultMeta>('unlock_vault', {
                masterPw,
                secretKeyFormatted: secretKey,
            });
            onUnlocked(meta);
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--vault-bg)' }}>
            {/* Background glow */}
            <div
                className="absolute w-96 h-96 rounded-full pointer-events-none"
                style={{
                    background: 'radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                }}
            />

            <div
                className="relative w-full max-w-sm rounded-2xl border"
                style={{
                    backgroundColor: 'var(--vault-surface)',
                    borderColor: 'var(--vault-border)',
                    boxShadow: '0 25px 50px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.08)',
                }}
            >
                {/* Top accent line */}
                <div
                    className="h-px w-full rounded-t-2xl"
                    style={{ background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.6), transparent)' }}
                />

                <div className="px-8 py-8">
                    {/* Logo */}
                    <div className="flex flex-col items-center mb-8">
                        <div
                            className="p-3 rounded-2xl mb-4"
                            style={{ backgroundColor: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}
                        >
                            <ShieldIcon />
                        </div>
                        <h1 className="text-xl font-semibold tracking-wide text-white">SD-Vault</h1>
                        <p className="mt-1 text-xs tracking-widest uppercase" style={{ color: 'var(--vault-muted)', letterSpacing: '0.15em' }}>
                            Sicherer Zugang
                        </p>
                    </div>

                    <form onSubmit={handleUnlock} className="space-y-5">
                        <div>
                            <label className="block text-xs font-medium mb-1.5 uppercase tracking-wider" style={{ color: 'var(--vault-muted)' }}>
                                Master-Passwort
                            </label>
                            <input
                                type="password"
                                value={masterPw}
                                onChange={e => setMasterPw(e.target.value)}
                                className="w-full px-4 py-2.5 rounded-xl border text-white text-sm transition-colors focus:outline-none"
                                style={{
                                    backgroundColor: '#0d0f18',
                                    borderColor: 'var(--vault-border)',
                                }}
                                onFocus={e => (e.currentTarget.style.borderColor = 'rgba(99,102,241,0.6)')}
                                onBlur={e => (e.currentTarget.style.borderColor = 'var(--vault-border)')}
                                placeholder="••••••••••••"
                                required
                                autoFocus
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-medium mb-1.5 uppercase tracking-wider" style={{ color: 'var(--vault-muted)' }}>
                                Secret Key
                            </label>
                            <input
                                type="text"
                                value={secretKey}
                                onChange={e => setSecretKey(e.target.value.toUpperCase())}
                                className="w-full px-4 py-2.5 rounded-xl border text-white text-xs font-mono transition-colors focus:outline-none"
                                style={{
                                    backgroundColor: '#0d0f18',
                                    borderColor: 'var(--vault-border)',
                                    letterSpacing: '0.05em',
                                }}
                                onFocus={e => (e.currentTarget.style.borderColor = 'rgba(99,102,241,0.6)')}
                                onBlur={e => (e.currentTarget.style.borderColor = 'var(--vault-border)')}
                                placeholder="SDVLT-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
                                required
                            />
                        </div>

                        {error && (
                            <div
                                className="px-4 py-3 rounded-xl text-sm"
                                style={{
                                    backgroundColor: 'rgba(239,68,68,0.08)',
                                    border: '1px solid rgba(239,68,68,0.2)',
                                    color: '#fca5a5',
                                }}
                            >
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-2.5 rounded-xl font-semibold text-white text-sm transition-all disabled:opacity-50"
                            style={{
                                background: loading ? 'var(--vault-accent)' : 'linear-gradient(135deg, #818cf8, #6366f1)',
                                boxShadow: loading ? 'none' : '0 4px 15px rgba(99,102,241,0.3)',
                            }}
                        >
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="white" strokeWidth="4" />
                                        <path className="opacity-75" fill="white" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                                    </svg>
                                    Entsperren…
                                </span>
                            ) : 'Vault entsperren'}
                        </button>
                    </form>

                    <p className="mt-6 text-center text-xs" style={{ color: '#374151' }}>
                        Ende-zu-Ende verschlüsselt · XChaCha20-Poly1305
                    </p>
                </div>
            </div>
        </div>
    );
}
