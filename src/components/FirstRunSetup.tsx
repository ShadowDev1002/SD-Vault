import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { CreateVaultResult, VaultMeta } from '../types';
import { measureStrength } from '../utils/strength';

interface Props {
    onCreated: (meta: VaultMeta) => void;
}

export default function FirstRunSetup({ onCreated }: Props) {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [masterPw, setMasterPw] = useState('');
    const [confirmPw, setConfirmPw] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<CreateVaultResult | null>(null);
    const [pdfSaved, setPdfSaved] = useState(false);

    const strength = measureStrength(masterPw);

    async function handleCreateVault(e: React.FormEvent) {
        e.preventDefault();
        setError('');
        if (masterPw !== confirmPw) {
            setError('Passwörter stimmen nicht überein');
            return;
        }
        if (masterPw.length < 8) {
            setError('Master-Passwort muss mindestens 8 Zeichen lang sein');
            return;
        }
        setLoading(true);
        try {
            const res = await invoke<CreateVaultResult>('create_vault', { masterPw });
            setResult(res);
            setStep(2);
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }

    function handleSavePdf() {
        if (!result) return;
        const bytes = new Uint8Array(result.pdf_bytes);
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'SD-Vault-Emergency-Kit.pdf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setPdfSaved(true);
        setStep(3);
    }

    async function handleFinish() {
        try {
            const meta = await invoke<VaultMeta>('unlock_vault', {
                masterPw,
                secretKeyFormatted: result!.secret_key_formatted,
            });
            onCreated(meta);
        } catch (err) {
            setError(String(err));
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--vault-bg)' }}>
            <div className="w-full max-w-lg p-8 rounded-xl border" style={{ backgroundColor: 'var(--vault-surface)', borderColor: 'var(--vault-border)' }}>

                {/* Step indicator */}
                <div className="flex items-center justify-center gap-2 mb-8">
                    {[1, 2, 3].map(n => (
                        <div key={n} className="flex items-center gap-2">
                            <div
                                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                                style={{
                                    backgroundColor: step >= n ? 'var(--vault-accent)' : 'var(--vault-border)',
                                    color: 'white',
                                }}
                            >{n}</div>
                            {n < 3 && <div className="w-8 h-px" style={{ backgroundColor: step > n ? 'var(--vault-accent)' : 'var(--vault-border)' }} />}
                        </div>
                    ))}
                </div>

                {/* Step 1: Master Password */}
                {step === 1 && (
                    <form onSubmit={handleCreateVault} className="space-y-4">
                        <h2 className="text-xl font-bold text-white mb-4">Neuen Vault erstellen</h2>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">Master-Passwort</label>
                            <input
                                type="password"
                                value={masterPw}
                                onChange={e => setMasterPw(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border text-white text-sm focus:outline-none"
                                style={{ backgroundColor: 'var(--vault-bg)', borderColor: 'var(--vault-border)' }}
                                placeholder="Starkes Passwort wählen"
                                required
                                autoFocus
                            />
                            {masterPw && (
                                <div className="mt-2">
                                    <div className="flex gap-1 mb-1">
                                        {[0, 1, 2, 3, 4].map(i => (
                                            <div key={i} className="h-1 flex-1 rounded-full transition-colors"
                                                style={{ backgroundColor: i <= strength.score ? strength.color : 'var(--vault-border)' }} />
                                        ))}
                                    </div>
                                    <p className="text-xs" style={{ color: strength.color }}>{strength.label}</p>
                                </div>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">Passwort bestätigen</label>
                            <input
                                type="password"
                                value={confirmPw}
                                onChange={e => setConfirmPw(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border text-white text-sm focus:outline-none"
                                style={{ backgroundColor: 'var(--vault-bg)', borderColor: 'var(--vault-border)' }}
                                placeholder="Passwort wiederholen"
                                required
                            />
                        </div>

                        {error && <p className="text-sm" style={{ color: 'var(--vault-danger)' }}>{error}</p>}

                        <button
                            type="submit"
                            disabled={loading || strength.score < 2}
                            className="w-full py-2.5 rounded-lg font-semibold text-white text-sm disabled:opacity-50"
                            style={{ backgroundColor: 'var(--vault-accent)' }}
                        >
                            {loading ? 'Erstelle Vault...' : 'Vault erstellen'}
                        </button>
                    </form>
                )}

                {/* Step 2: Download Emergency Kit */}
                {step === 2 && result && (
                    <div className="space-y-5">
                        <h2 className="text-xl font-bold text-white">Emergency Kit speichern</h2>
                        <div className="p-4 rounded-lg border" style={{ borderColor: '#b45309', backgroundColor: '#1c1005' }}>
                            <p className="text-sm font-semibold text-yellow-400 mb-2">⚠️ Wichtig</p>
                            <p className="text-sm text-gray-300">
                                Ohne Ihren <strong>Secret Key</strong> und Ihr <strong>Master-Passwort</strong> können
                                Sie Ihren Vault nicht öffnen. Speichern Sie das Emergency Kit an einem sicheren Ort.
                            </p>
                        </div>

                        <div className="p-4 rounded-lg border font-mono text-sm" style={{ borderColor: 'var(--vault-border)', backgroundColor: 'var(--vault-bg)' }}>
                            <p className="text-gray-400 text-xs mb-1">Ihr Secret Key:</p>
                            <p className="text-white text-base tracking-wider">{result.secret_key_formatted}</p>
                        </div>

                        <button
                            onClick={handleSavePdf}
                            className="w-full py-2.5 rounded-lg font-semibold text-white text-sm"
                            style={{ backgroundColor: 'var(--vault-accent)' }}
                        >
                            📥 Emergency Kit PDF speichern
                        </button>

                        {pdfSaved && (
                            <p className="text-sm text-center" style={{ color: '#22c55e' }}>
                                ✓ PDF gespeichert
                            </p>
                        )}
                    </div>
                )}

                {/* Step 3: Confirm */}
                {step === 3 && (
                    <div className="space-y-5 text-center">
                        <div className="text-5xl">✅</div>
                        <h2 className="text-xl font-bold text-white">Vault bereit</h2>
                        <p className="text-sm" style={{ color: 'var(--vault-muted)' }}>
                            Ihr Emergency Kit wurde gespeichert. Bewahren Sie es sicher auf.
                        </p>
                        <button
                            onClick={handleFinish}
                            className="w-full py-2.5 rounded-lg font-semibold text-white text-sm"
                            style={{ backgroundColor: 'var(--vault-accent)' }}
                        >
                            Vault öffnen
                        </button>
                        {error && <p className="text-sm" style={{ color: 'var(--vault-danger)' }}>{error}</p>}
                    </div>
                )}
            </div>
        </div>
    );
}
