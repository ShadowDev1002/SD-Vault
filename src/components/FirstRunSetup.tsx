import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { CreateVaultResult, VaultMeta } from '../types';
import { measureStrength } from '../utils/strength';
import logoUrl from '../assets/logo.svg';

interface Props {
    onCreated: (meta: VaultMeta) => void;
}

function CheckIcon({ size = 20 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function DownloadIcon() {
    return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 3v12m0 0l-4-4m4 4l4-4M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function WarningIcon() {
    return (
        <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

const STEPS = ['Haftung', 'Passwort', 'Emergency Kit', 'Fertig'];

export default function FirstRunSetup({ onCreated }: Props) {
    const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
    const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
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
            setError('Passwörter stimmen nicht überein.');
            return;
        }
        if (masterPw.length < 8) {
            setError('Das Master-Passwort muss mindestens 8 Zeichen lang sein.');
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
        URL.revokeObjectURL(url);
        setResult(null); // PDF-Bytes sofort aus dem Speicher entfernen
        setPdfSaved(true);
        setStep(3);
    }

    async function handleFinish() {
        try {
            const meta = await invoke<VaultMeta>('unlock_vault', { masterPw });
            onCreated(meta);
        } catch (err) {
            setError(String(err));
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
                    transform: 'translate(-50%, -60%)',
                }}
            />

            <div
                className="relative w-full max-w-md rounded-2xl border"
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
                    {/* Header */}
                    <div className="flex items-center gap-3 mb-7">
                        <img src={logoUrl} alt="SD-Vault" className="w-10 h-10 flex-shrink-0" draggable={false} />
                        <div>
                            <p className="text-xs uppercase tracking-widest" style={{ color: 'var(--vault-muted)' }}>
                                Einrichtung
                            </p>
                            <h1 className="text-xl font-semibold text-white leading-tight">SD-Vault erstellen</h1>
                        </div>
                    </div>

                    {/* Step indicator */}
                    <div className="flex items-center mb-8">
                        {STEPS.map((label, idx) => {
                            const isComplete = step > idx;
                            const isActive = step === idx;
                            const n = idx + 1;
                            return (
                                <div key={n} className="flex items-center flex-1 last:flex-none">
                                    <div className="flex flex-col items-center">
                                        <div
                                            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all"
                                            style={{
                                                backgroundColor: isComplete || isActive ? 'var(--vault-accent)' : 'transparent',
                                                border: isComplete || isActive ? 'none' : '1.5px solid var(--vault-border)',
                                                color: isComplete || isActive ? 'white' : 'var(--vault-muted)',
                                            }}
                                        >
                                            {isComplete ? <CheckIcon size={14} /> : n}
                                        </div>
                                        <span
                                            className="text-xs mt-1 whitespace-nowrap"
                                            style={{ color: isActive ? 'white' : 'var(--vault-muted)', fontSize: '10px' }}
                                        >
                                            {label}
                                        </span>
                                    </div>
                                    {idx < STEPS.length - 1 && (
                                        <div
                                            className="h-px flex-1 mx-2 mb-4"
                                            style={{ backgroundColor: step > idx ? 'var(--vault-accent)' : 'var(--vault-border)' }}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Step 0: Disclaimer */}
                    {step === 0 && (
                        <div className="space-y-5">
                            <div className="rounded-xl border p-5 space-y-4 text-sm leading-relaxed"
                                style={{ borderColor: 'var(--vault-border)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
                                <h2 className="text-base font-semibold text-white">Haftungsausschluss</h2>
                                <p style={{ color: 'var(--vault-muted)' }}>
                                    SD-Vault wird <strong className="text-white">so wie es ist</strong> bereitgestellt — ohne jegliche ausdrückliche oder stillschweigende Garantie.
                                </p>
                                <p style={{ color: 'var(--vault-muted)' }}>
                                    Der Entwickler übernimmt <strong className="text-white">keinerlei Haftung</strong> für:
                                </p>
                                <ul className="space-y-1.5 list-none" style={{ color: 'var(--vault-muted)' }}>
                                    {[
                                        'Verlust, Diebstahl oder Kompromittierung gespeicherter Daten',
                                        'Schäden durch Sicherheitslücken in verwendeten Bibliotheken',
                                        'Datenverlust durch Fehler, Abstürze oder fehlerhafte Backups',
                                        'Folgeschäden jeglicher Art durch die Nutzung dieser Software',
                                        'Schäden durch unsachgemäße Verwendung oder schwache Master-Passwörter',
                                    ].map(item => (
                                        <li key={item} className="flex items-start gap-2">
                                            <span className="mt-0.5 shrink-0" style={{ color: 'var(--vault-danger)' }}>—</span>
                                            <span>{item}</span>
                                        </li>
                                    ))}
                                </ul>
                                <p style={{ color: 'var(--vault-muted)' }}>
                                    Die Sicherheit des Vaults hängt maßgeblich von der <strong className="text-white">Stärke deines Master-Passworts</strong> und dem <strong className="text-white">sicheren Aufbewahren des Emergency Kits</strong> ab.
                                    SD-Vault ist <strong className="text-white">Open-Source</strong> — du kannst den Quellcode jederzeit auf GitHub einsehen und prüfen.
                                </p>
                                <p className="text-xs" style={{ color: 'var(--vault-muted)' }}>
                                    Lizenz: MIT · GitHub: github.com/ShadowDev1002/SD-Vault
                                </p>
                            </div>
                            <label className="flex items-start gap-3 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={disclaimerAccepted}
                                    onChange={e => setDisclaimerAccepted(e.target.checked)}
                                    className="mt-0.5 w-4 h-4 rounded shrink-0 accent-blue-500"
                                />
                                <span className="text-sm" style={{ color: 'var(--vault-muted)' }}>
                                    Ich habe den Haftungsausschluss gelesen und akzeptiere ihn.
                                </span>
                            </label>
                            <button
                                onClick={() => setStep(1)}
                                disabled={!disclaimerAccepted}
                                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 transition-opacity"
                                style={{ backgroundColor: 'var(--vault-accent)' }}
                            >
                                Akzeptieren & Vault erstellen
                            </button>
                        </div>
                    )}

                    {/* Step 1: Master Password */}
                    {step === 1 && (
                        <form onSubmit={handleCreateVault} className="space-y-5">
                            <div>
                                <label className="block text-xs font-medium mb-1.5 uppercase tracking-wider" style={{ color: 'var(--vault-muted)' }}>
                                    Master-Passwort
                                </label>
                                <input
                                    type="password"
                                    value={masterPw}
                                    onChange={e => setMasterPw(e.target.value)}
                                    className="w-full px-4 py-2.5 rounded-xl border text-white text-sm transition-colors focus:outline-none"
                                    style={{ backgroundColor: '#0d0f18', borderColor: 'var(--vault-border)' }}
                                    onFocus={e => (e.currentTarget.style.borderColor = 'rgba(99,102,241,0.6)')}
                                    onBlur={e => (e.currentTarget.style.borderColor = 'var(--vault-border)')}
                                    placeholder="Starkes Passwort wählen"
                                    required
                                    autoFocus
                                />
                                {masterPw && (
                                    <div className="mt-2.5">
                                        <div className="flex gap-1 mb-1.5">
                                            {[0, 1, 2, 3, 4].map(i => (
                                                <div
                                                    key={i}
                                                    className="h-1 flex-1 rounded-full transition-all"
                                                    style={{
                                                        backgroundColor: i <= strength.score ? strength.color : 'var(--vault-border)',
                                                    }}
                                                />
                                            ))}
                                        </div>
                                        <p className="text-xs" style={{ color: strength.color }}>{strength.label}</p>
                                    </div>
                                )}
                            </div>

                            <div>
                                <label className="block text-xs font-medium mb-1.5 uppercase tracking-wider" style={{ color: 'var(--vault-muted)' }}>
                                    Passwort bestätigen
                                </label>
                                <input
                                    type="password"
                                    value={confirmPw}
                                    onChange={e => setConfirmPw(e.target.value)}
                                    className="w-full px-4 py-2.5 rounded-xl border text-white text-sm transition-colors focus:outline-none"
                                    style={{ backgroundColor: '#0d0f18', borderColor: 'var(--vault-border)' }}
                                    onFocus={e => (e.currentTarget.style.borderColor = 'rgba(99,102,241,0.6)')}
                                    onBlur={e => (e.currentTarget.style.borderColor = 'var(--vault-border)')}
                                    placeholder="Passwort wiederholen"
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
                                disabled={loading || strength.score < 2}
                                className="w-full py-2.5 rounded-xl font-semibold text-white text-sm transition-all disabled:opacity-40"
                                style={{
                                    background: 'linear-gradient(135deg, #818cf8, #6366f1)',
                                    boxShadow: '0 4px 15px rgba(99,102,241,0.25)',
                                }}
                            >
                                {loading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="white" strokeWidth="4" />
                                            <path className="opacity-75" fill="white" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                                        </svg>
                                        Erstelle Vault…
                                    </span>
                                ) : 'Vault erstellen'}
                            </button>
                        </form>
                    )}

                    {/* Step 2: Download Emergency Kit */}
                    {step === 2 && result && (
                        <div className="space-y-5">
                            {/* Warning */}
                            <div
                                className="flex gap-3 p-4 rounded-xl"
                                style={{
                                    backgroundColor: 'rgba(234,179,8,0.06)',
                                    border: '1px solid rgba(234,179,8,0.2)',
                                }}
                            >
                                <span style={{ color: '#fbbf24', marginTop: '1px' }}><WarningIcon /></span>
                                <div>
                                    <p className="text-sm font-semibold mb-1" style={{ color: '#fcd34d' }}>Sicherungsschlüssel aufbewahren</p>
                                    <p className="text-xs leading-relaxed" style={{ color: '#d1d5db' }}>
                                        Ohne Ihren <strong className="text-white">Secret Key</strong> und Ihr{' '}
                                        <strong className="text-white">Master-Passwort</strong> ist ein Zugang zum Vault
                                        nicht möglich. Speichern Sie das Emergency Kit an einem sicheren, physischen Ort.
                                    </p>
                                </div>
                            </div>

                            {/* Secret key display */}
                            <div
                                className="p-4 rounded-xl"
                                style={{
                                    backgroundColor: '#0d0f18',
                                    border: '1px solid var(--vault-border)',
                                }}
                            >
                                <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--vault-muted)' }}>Ihr Secret Key</p>
                                <p
                                    className="text-sm font-mono tracking-widest break-all select-all"
                                    style={{ color: '#c7d2fe', letterSpacing: '0.08em' }}
                                >
                                    {result.secret_key_formatted}
                                </p>
                                <p className="text-xs mt-2" style={{ color: 'var(--vault-muted)' }}>
                                    Klicken zum Auswählen · Im PDF enthalten
                                </p>
                            </div>

                            <button
                                onClick={handleSavePdf}
                                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-white text-sm transition-all"
                                style={{
                                    background: 'linear-gradient(135deg, #818cf8, #6366f1)',
                                    boxShadow: '0 4px 15px rgba(99,102,241,0.25)',
                                }}
                            >
                                <DownloadIcon />
                                Emergency Kit als PDF speichern
                            </button>

                            {pdfSaved && (
                                <div
                                    className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm"
                                    style={{
                                        backgroundColor: 'rgba(34,197,94,0.08)',
                                        border: '1px solid rgba(34,197,94,0.2)',
                                        color: '#86efac',
                                    }}
                                >
                                    <CheckIcon size={16} />
                                    PDF gespeichert
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step 3: Confirm */}
                    {step === 3 && (
                        <div className="space-y-5">
                            <div className="text-center py-4">
                                <div
                                    className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                                    style={{
                                        backgroundColor: 'rgba(34,197,94,0.1)',
                                        border: '1px solid rgba(34,197,94,0.2)',
                                        color: '#4ade80',
                                    }}
                                >
                                    <CheckIcon size={32} />
                                </div>
                                <h2 className="text-lg font-semibold text-white mb-2">Vault bereit</h2>
                                <p className="text-sm" style={{ color: 'var(--vault-muted)' }}>
                                    Ihr Emergency Kit wurde gespeichert. Bewahren Sie es an einem sicheren Ort auf.
                                </p>
                            </div>

                            <button
                                onClick={handleFinish}
                                className="w-full py-2.5 rounded-xl font-semibold text-white text-sm transition-all"
                                style={{
                                    background: 'linear-gradient(135deg, #818cf8, #6366f1)',
                                    boxShadow: '0 4px 15px rgba(99,102,241,0.25)',
                                }}
                            >
                                Vault öffnen
                            </button>

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
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
