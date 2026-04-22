import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { VaultMeta } from '../types';
import logoUrl from '../assets/logo.svg';

interface Props {
    onUnlocked: (meta: VaultMeta) => void;
}

function Spinner() {
    return (
        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="white" strokeWidth="4" />
            <path className="opacity-75" fill="white" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
        </svg>
    );
}

function ErrorBox({ message }: { message: string }) {
    return (
        <div
            className="px-4 py-3 rounded-xl text-sm"
            style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5' }}
        >
            {message}
        </div>
    );
}

function inputStyle(focused: boolean) {
    return {
        backgroundColor: '#0d0f18',
        borderColor: focused ? 'rgba(99,102,241,0.6)' : 'var(--vault-border)',
    };
}

export default function LockScreen({ onUnlocked }: Props) {
    const [mode, setMode] = useState<'unlock' | 'reset' | 'reset-done'>('unlock');

    // Unlock state
    const [masterPw, setMasterPw] = useState('');
    const [unlockError, setUnlockError] = useState('');
    const [unlockLoading, setUnlockLoading] = useState(false);
    const [pwFocused, setPwFocused] = useState(false);

    // Reset state
    const [secretKey, setSecretKey] = useState('');
    const [newPw, setNewPw] = useState('');
    const [confirmPw, setConfirmPw] = useState('');
    const [resetError, setResetError] = useState('');
    const [resetLoading, setResetLoading] = useState(false);
    const [skFocused, setSkFocused] = useState(false);
    const [np1Focused, setNp1Focused] = useState(false);
    const [np2Focused, setNp2Focused] = useState(false);

    async function handleUnlock(e: React.FormEvent) {
        e.preventDefault();
        setUnlockError('');
        setUnlockLoading(true);
        try {
            const meta = await invoke<VaultMeta>('unlock_vault', { masterPw });
            onUnlocked(meta);
        } catch (err) {
            setUnlockError(String(err));
        } finally {
            setUnlockLoading(false);
        }
    }

    async function handleReset(e: React.FormEvent) {
        e.preventDefault();
        setResetError('');
        if (newPw !== confirmPw) {
            setResetError('Passwörter stimmen nicht überein.');
            return;
        }
        if (newPw.length < 8) {
            setResetError('Das neue Passwort muss mindestens 8 Zeichen lang sein.');
            return;
        }
        setResetLoading(true);
        try {
            await invoke('reset_master_password', {
                secretKeyFormatted: secretKey,
                newMasterPw: newPw,
            });
            setMode('reset-done');
        } catch (err) {
            setResetError(String(err));
        } finally {
            setResetLoading(false);
        }
    }

    function goBack() {
        setMode('unlock');
        setSecretKey('');
        setNewPw('');
        setConfirmPw('');
        setResetError('');
    }

    return (
        <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--vault-bg)' }}>
            <div
                className="absolute w-96 h-96 rounded-full pointer-events-none"
                style={{
                    background: 'radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)',
                    top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
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
                <div className="h-px w-full rounded-t-2xl" style={{ background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.6), transparent)' }} />

                <div className="px-8 py-8">
                    {/* Logo */}
                    <div className="flex flex-col items-center mb-7">
                        <div className="p-2 rounded-2xl mb-4" style={{ backgroundColor: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)' }}>
                            <img src={logoUrl} alt="SD-Vault" className="w-14 h-14" draggable={false} />
                        </div>
                        <h1 className="text-xl font-semibold tracking-wide text-white">SD-Vault</h1>
                        <p className="mt-1 text-xs tracking-widest uppercase" style={{ color: 'var(--vault-muted)', letterSpacing: '0.15em' }}>
                            {mode === 'unlock' ? 'Sicherer Zugang' : mode === 'reset' ? 'Passwort zurücksetzen' : 'Passwort geändert'}
                        </p>
                    </div>

                    {/* ── Unlock form ── */}
                    {mode === 'unlock' && (
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
                                    style={inputStyle(pwFocused)}
                                    onFocus={() => setPwFocused(true)}
                                    onBlur={() => setPwFocused(false)}
                                    placeholder="••••••••••••"
                                    required
                                    autoFocus
                                />
                            </div>

                            {unlockError && <ErrorBox message={unlockError} />}

                            <button
                                type="submit"
                                disabled={unlockLoading}
                                className="w-full py-2.5 rounded-xl font-semibold text-white text-sm transition-all disabled:opacity-50"
                                style={{ background: 'linear-gradient(135deg, #818cf8, #6366f1)', boxShadow: '0 4px 15px rgba(99,102,241,0.3)' }}
                            >
                                {unlockLoading
                                    ? <span className="flex items-center justify-center gap-2"><Spinner />Entsperren…</span>
                                    : 'Vault entsperren'}
                            </button>

                            <button
                                type="button"
                                onClick={() => setMode('reset')}
                                className="w-full text-xs py-1 transition-colors"
                                style={{ color: 'var(--vault-muted)' }}
                                onMouseEnter={e => (e.currentTarget.style.color = '#818cf8')}
                                onMouseLeave={e => (e.currentTarget.style.color = 'var(--vault-muted)')}
                            >
                                Passwort vergessen?
                            </button>
                        </form>
                    )}

                    {/* ── Reset form ── */}
                    {mode === 'reset' && (
                        <form onSubmit={handleReset} className="space-y-4">
                            <div
                                className="px-4 py-3 rounded-xl text-xs leading-relaxed"
                                style={{ backgroundColor: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.15)', color: '#a5b4fc' }}
                            >
                                Gib deinen <strong className="text-white">Secret Key</strong> aus dem Emergency Kit ein, um ein neues Passwort zu setzen.
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
                                    style={{ ...inputStyle(skFocused), letterSpacing: '0.05em' }}
                                    onFocus={() => setSkFocused(true)}
                                    onBlur={() => setSkFocused(false)}
                                    placeholder="SDVLT-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
                                    required
                                    autoFocus
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium mb-1.5 uppercase tracking-wider" style={{ color: 'var(--vault-muted)' }}>
                                    Neues Passwort
                                </label>
                                <input
                                    type="password"
                                    value={newPw}
                                    onChange={e => setNewPw(e.target.value)}
                                    className="w-full px-4 py-2.5 rounded-xl border text-white text-sm transition-colors focus:outline-none"
                                    style={inputStyle(np1Focused)}
                                    onFocus={() => setNp1Focused(true)}
                                    onBlur={() => setNp1Focused(false)}
                                    placeholder="Neues Passwort"
                                    required
                                />
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
                                    style={inputStyle(np2Focused)}
                                    onFocus={() => setNp2Focused(true)}
                                    onBlur={() => setNp2Focused(false)}
                                    placeholder="Passwort wiederholen"
                                    required
                                />
                            </div>

                            {resetError && <ErrorBox message={resetError} />}

                            <button
                                type="submit"
                                disabled={resetLoading}
                                className="w-full py-2.5 rounded-xl font-semibold text-white text-sm transition-all disabled:opacity-50"
                                style={{ background: 'linear-gradient(135deg, #818cf8, #6366f1)', boxShadow: '0 4px 15px rgba(99,102,241,0.3)' }}
                            >
                                {resetLoading
                                    ? <span className="flex items-center justify-center gap-2"><Spinner />Wird zurückgesetzt…</span>
                                    : 'Passwort zurücksetzen'}
                            </button>

                            <button
                                type="button"
                                onClick={goBack}
                                className="w-full text-xs py-1 transition-colors"
                                style={{ color: 'var(--vault-muted)' }}
                                onMouseEnter={e => (e.currentTarget.style.color = '#818cf8')}
                                onMouseLeave={e => (e.currentTarget.style.color = 'var(--vault-muted)')}
                            >
                                Zurück zum Login
                            </button>
                        </form>
                    )}

                    {/* ── Reset success ── */}
                    {mode === 'reset-done' && (
                        <div className="space-y-5 text-center">
                            <div
                                className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto"
                                style={{ backgroundColor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', color: '#4ade80' }}
                            >
                                <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none">
                                    <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </div>
                            <div>
                                <p className="text-white font-semibold">Passwort geändert</p>
                                <p className="text-xs mt-1" style={{ color: 'var(--vault-muted)' }}>
                                    Du kannst dich jetzt mit dem neuen Passwort einloggen.
                                </p>
                            </div>
                            <button
                                onClick={goBack}
                                className="w-full py-2.5 rounded-xl font-semibold text-white text-sm"
                                style={{ background: 'linear-gradient(135deg, #818cf8, #6366f1)', boxShadow: '0 4px 15px rgba(99,102,241,0.3)' }}
                            >
                                Zum Login
                            </button>
                        </div>
                    )}

                    {mode === 'unlock' && (
                        <p className="mt-5 text-center text-xs" style={{ color: '#374151' }}>
                            Ende-zu-Ende verschlüsselt · XChaCha20-Poly1305
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
