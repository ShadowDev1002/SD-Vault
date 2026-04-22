import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { VaultMeta } from '../types';

interface Props {
    onUnlocked: (meta: VaultMeta) => void;
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
        <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--vault-bg)' }}>
            <div className="w-full max-w-md p-8 rounded-xl border" style={{ backgroundColor: 'var(--vault-surface)', borderColor: 'var(--vault-border)' }}>
                <div className="text-center mb-8">
                    <div className="text-4xl mb-3">🔒</div>
                    <h1 className="text-2xl font-bold text-white">SD-Vault</h1>
                    <p className="mt-1 text-sm" style={{ color: 'var(--vault-muted)' }}>Geben Sie Ihre Zugangsdaten ein</p>
                </div>

                <form onSubmit={handleUnlock} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Master-Passwort</label>
                        <input
                            type="password"
                            value={masterPw}
                            onChange={e => setMasterPw(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border text-white text-sm focus:outline-none focus:ring-2"
                            style={{ backgroundColor: 'var(--vault-bg)', borderColor: 'var(--vault-border)', '--tw-ring-color': 'var(--vault-accent)' } as React.CSSProperties}
                            placeholder="Master-Passwort"
                            required
                            autoFocus
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Secret Key</label>
                        <input
                            type="text"
                            value={secretKey}
                            onChange={e => setSecretKey(e.target.value.toUpperCase())}
                            className="w-full px-3 py-2 rounded-lg border text-white text-sm font-mono focus:outline-none focus:ring-2"
                            style={{ backgroundColor: 'var(--vault-bg)', borderColor: 'var(--vault-border)' } as React.CSSProperties}
                            placeholder="SDVLT-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
                            required
                        />
                    </div>

                    {error && (
                        <p className="text-sm rounded-lg px-3 py-2" style={{ color: 'var(--vault-danger)', backgroundColor: '#1f0a0a' }}>
                            {error}
                        </p>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-2.5 rounded-lg font-semibold text-white text-sm transition-opacity disabled:opacity-50"
                        style={{ backgroundColor: 'var(--vault-accent)' }}
                    >
                        {loading ? 'Entsperre...' : 'Vault entsperren'}
                    </button>
                </form>
            </div>
        </div>
    );
}
