import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Shield } from "lucide-react";

interface LockScreenProps {
    vaultExists: boolean;
    onUnlocked: () => void;
}

export function LockScreen({ vaultExists, onUnlocked }: LockScreenProps) {
    const [masterPassword, setMasterPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [secretKeyInput, setSecretKeyInput] = useState("");
    const [isDeriving, setIsDeriving] = useState(false);
    const [regStep, setRegStep] = useState(1);
    const [generatedSecretKey] = useState(() => {
        const segs = Array.from({ length: 4 }, () =>
            Math.random().toString(36).substring(2, 8).toUpperCase()
        );
        return `SD-${segs.join('-')}`;
    });
    const [showRecovery, setShowRecovery] = useState(false);
    const [recoverySecretKey, setRecoverySecretKey] = useState("");
    const [recoveryNewPassword, setRecoveryNewPassword] = useState("");
    const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState("");

    async function handleRegister(e: React.FormEvent) {
        e.preventDefault();
        if (masterPassword !== confirmPassword) { alert("Passwörter stimmen nicht überein!"); return; }
        if (masterPassword.length < 8) { alert("Mindestens 8 Zeichen."); return; }
        setIsDeriving(true);
        try {
            await invoke("create_vault", { password: masterPassword, secretKey: generatedSecretKey });
            localStorage.setItem("sd_secret_key", generatedSecretKey);
            onUnlocked();
        } catch { alert("Fehler beim Erstellen des Tresors."); }
        finally { setIsDeriving(false); setMasterPassword(""); setConfirmPassword(""); }
    }

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault();
        if (!masterPassword) return;
        setIsDeriving(true);
        try {
            await invoke("unlock_vault", { password: masterPassword });
            const deviceSecret = localStorage.getItem("sd_secret_key") || secretKeyInput.trim().toUpperCase();
            if (!localStorage.getItem("sd_secret_key") && deviceSecret)
                localStorage.setItem("sd_secret_key", deviceSecret);
            onUnlocked();
        } catch { alert("Falsches Master-Passwort."); }
        finally { setIsDeriving(false); setMasterPassword(""); }
    }

    async function handleRecover(e: React.FormEvent) {
        e.preventDefault();
        if (recoveryNewPassword.length < 8) { alert("Mindestens 8 Zeichen."); return; }
        if (recoveryNewPassword !== recoveryConfirmPassword) { alert("Passwörter stimmen nicht überein!"); return; }
        setIsDeriving(true);
        try {
            const cleanSecret = recoverySecretKey.trim().toUpperCase();
            await invoke("recover_vault", { secretKey: cleanSecret, newPassword: recoveryNewPassword });
            localStorage.setItem("sd_secret_key", cleanSecret);
            alert("Passwort zurückgesetzt!");
            setShowRecovery(false);
            onUnlocked();
        } catch { alert("Ungültiger Secret Key."); }
        finally { setIsDeriving(false); setRecoveryNewPassword(""); setRecoveryConfirmPassword(""); }
    }

    const header = (
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <Shield size={64} color="var(--accent-blue)" style={{ marginBottom: '16px' }} />
            <h1 style={{ fontSize: '24px', fontWeight: 600 }}>
                {vaultExists ? 'SD-Passwort' : 'Willkommen bei SD-Passwort'}
            </h1>
            {!vaultExists && (
                <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>
                    Lokaler 100% Zero-Knowledge Tresor
                </p>
            )}
        </div>
    );

    if (!vaultExists) {
        return (
            <div className="login-screen">
                {header}
                <form onSubmit={handleRegister} className="login-card" style={{ maxWidth: '420px' }}>
                    {regStep === 1 ? (
                        <>
                            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
                                Dein Tresor wird ausschließlich lokal verschlüsselt. Bitte erstelle ein sicheres Master-Passwort.
                            </p>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>MASTER-PASSWORT</label>
                            <input type="password" value={masterPassword} onChange={e => setMasterPassword(e.target.value)} placeholder="Mindestens 8 Zeichen" autoFocus />
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>PASSWORT BESTÄTIGEN</label>
                            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Passwort wiederholen" />
                            <button type="button" onClick={() => {
                                if (masterPassword.length >= 8 && masterPassword === confirmPassword) setRegStep(2);
                                else alert("Bitte ein gültiges Passwort (min. 8 Zeichen) festlegen.");
                            }}>Weiter</button>
                        </>
                    ) : (
                        <>
                            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
                                Zusätzlich zum Passwort wird ein <strong style={{ color: 'white' }}>Secret Key</strong> für dieses Gerät generiert.
                            </p>
                            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '24px', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '24px', textAlign: 'center' }}>
                                <div style={{ fontSize: '12px', color: 'var(--accent-blue)', fontWeight: 600, marginBottom: '8px' }}>DEIN SECRET KEY (Emergency Kit)</div>
                                <div style={{ fontSize: '18px', fontFamily: 'monospace', letterSpacing: '1px', color: 'white' }}>{generatedSecretKey}</div>
                            </div>
                            <p style={{ fontSize: '13px', color: 'var(--danger)', marginBottom: '24px', lineHeight: 1.5 }}>
                                <strong>Achtung:</strong> Speichere diesen Key sicher ab!
                            </p>
                            <button type="button" onClick={() => {
                                const el = document.createElement("a");
                                const file = new Blob([`SD-PASSWORT EMERGENCY KIT\n\nSecret Key: ${generatedSecretKey}\n\nMaster-Passwort: ________________________`], { type: 'text/plain' });
                                el.href = URL.createObjectURL(file);
                                el.download = "SD_Passwort_Emergency_Kit.txt";
                                document.body.appendChild(el); el.click(); document.body.removeChild(el);
                            }} style={{ background: 'var(--accent-blue)', color: 'white', marginBottom: '12px' }}>
                                Emergency Kit speichern (.txt)
                            </button>
                            <button type="submit" disabled={isDeriving}>
                                {isDeriving ? "Erstelle Tresor..." : "Tresor jetzt erstellen"}
                            </button>
                            <button type="button" onClick={() => setRegStep(1)} style={{ background: 'transparent', color: 'var(--text-secondary)', marginTop: '12px', boxShadow: 'none' }}>
                                Zurück
                            </button>
                        </>
                    )}
                </form>
            </div>
        );
    }

    const needsSecret = !localStorage.getItem("sd_secret_key");

    return (
        <div className="login-screen">
            {header}
            {showRecovery ? (
                <form onSubmit={handleRecover} className="login-card">
                    <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
                        Gib deinen <strong style={{ color: 'white' }}>Secret Key</strong> ein um ein neues Master-Passwort zu vergeben.
                    </p>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>SECRET KEY</label>
                    <input type="text" value={recoverySecretKey} onChange={e => setRecoverySecretKey(e.target.value)} placeholder="SD-XXXX-XXXX-XXXX-XXXX" style={{ fontFamily: 'monospace' }} autoFocus />
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block', marginTop: '16px' }}>NEUES MASTER-PASSWORT</label>
                    <input type="password" value={recoveryNewPassword} onChange={e => setRecoveryNewPassword(e.target.value)} placeholder="Mindestens 8 Zeichen" />
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block', marginTop: '16px' }}>PASSWORT BESTÄTIGEN</label>
                    <input type="password" value={recoveryConfirmPassword} onChange={e => setRecoveryConfirmPassword(e.target.value)} placeholder="Passwort wiederholen" />
                    <button type="submit" disabled={isDeriving}>{isDeriving ? "Wiederherstellen..." : "Tresor wiederherstellen"}</button>
                    <button type="button" onClick={() => setShowRecovery(false)} style={{ background: 'transparent', color: 'var(--text-secondary)', marginTop: '12px', boxShadow: 'none' }}>Abbrechen</button>
                </form>
            ) : (
                <form onSubmit={handleLogin} className="login-card">
                    {needsSecret && (
                        <>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>SECRET KEY (NEUES GERÄT)</label>
                            <input type="text" value={secretKeyInput} onChange={e => setSecretKeyInput(e.target.value)} placeholder="SD-XXXX-XXXX-XXXX-XXXX" style={{ fontFamily: 'monospace' }} autoFocus />
                        </>
                    )}
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>MASTER-PASSWORT</label>
                    <input type="password" value={masterPassword} onChange={e => setMasterPassword(e.target.value)} placeholder="Dein Master-Passwort" autoFocus={!needsSecret} />
                    <button type="submit" disabled={isDeriving}>{isDeriving ? "Wird entsperrt..." : "Entsperren"}</button>
                    <button type="button" onClick={() => setShowRecovery(true)} style={{ background: 'transparent', color: 'var(--text-secondary)', marginTop: '12px', boxShadow: 'none' }}>
                        Passwort vergessen? (Wiederherstellung mit Secret Key)
                    </button>
                    <button type="button" onClick={async () => {
                        if (confirm("ACHTUNG: Dies löscht deinen gesamten Tresor unwiderruflich! Fortfahren?")) {
                            try { await invoke("reset_vault"); } catch (e) { console.error(e); }
                            localStorage.removeItem("sd_secret_key");
                            window.location.reload();
                        }
                    }} style={{ background: 'transparent', color: 'var(--danger)', marginTop: '24px', border: '1px solid var(--danger)', opacity: 0.5 }}>
                        ⚠️ Tresor unwiderruflich löschen
                    </button>
                </form>
            )}
        </div>
    );
}
