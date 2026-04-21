import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { ImportExport } from "./ImportExport";
import { GoogleDriveSync } from "./GoogleDriveSync";

interface SettingsProps {
    onClose: () => void;
}

export function Settings({ onClose }: SettingsProps) {
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [isDeriving, setIsDeriving] = useState(false);

    async function handleChangePassword(e: React.FormEvent) {
        e.preventDefault();
        if (newPassword.length < 8) { alert("Mindestens 8 Zeichen."); return; }
        if (newPassword !== confirmPassword) { alert("Passwörter stimmen nicht überein!"); return; }
        setIsDeriving(true);
        try {
            await invoke("change_password", { newPassword });
            alert("Passwort erfolgreich geändert!");
            onClose();
            setNewPassword(""); setConfirmPassword("");
        } catch { alert("Fehler beim Ändern des Passworts."); }
        finally { setIsDeriving(false); }
    }

    async function handleExportVault() {
        try {
            const b64 = await invoke<string>("export_vault_data");
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const blob = new Blob([bytes], { type: "application/octet-stream" });
            const el = document.createElement("a");
            el.href = URL.createObjectURL(blob);
            el.download = "SD_Passwort_Backup.sdvault";
            document.body.appendChild(el); el.click(); document.body.removeChild(el);
        } catch { alert("Fehler beim Exportieren!"); }
    }

    async function handleImportVault(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!confirm("Achtung! Der aktuelle Tresor wird überschrieben! Fortfahren?")) return;
        const reader = new FileReader();
        reader.onload = async () => {
            const base64Data = (reader.result as string).split(",")[1];
            if (!base64Data) { alert("Ungültige Datei."); return; }
            try {
                await invoke("import_vault_data", { base64Data });
                alert("Backup importiert! Bitte entsperre den Tresor erneut.");
                window.location.reload();
            } catch { alert("Fehler beim Importieren!"); }
        };
        reader.readAsDataURL(file);
    }

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
            <div style={{ background: 'var(--bg-card)', padding: '32px', borderRadius: '12px', width: '400px', border: '1px solid var(--border-color)', boxShadow: '0 24px 48px rgba(0,0,0,0.5)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                    <h2 style={{ fontSize: '18px', margin: 0 }}>Tresor Einstellungen</h2>
                    <button className="icon-btn" onClick={onClose}><X size={20} /></button>
                </div>

                <form onSubmit={handleChangePassword}>
                    <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
                        Hier kannst du dein Master-Passwort ändern.
                    </p>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>NEUES MASTER-PASSWORT</label>
                    <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Mindestens 8 Zeichen" style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.03)', color: 'white', marginBottom: '16px' }} autoFocus />
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>PASSWORT BESTÄTIGEN</label>
                    <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Passwort wiederholen" style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.03)', color: 'white', marginBottom: '24px' }} />
                    <button type="submit" disabled={isDeriving} style={{ width: '100%', padding: '12px', background: 'var(--accent-blue)', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}>
                        {isDeriving ? "Wird geändert..." : "Passwort ändern"}
                    </button>
                </form>

                <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '32px 0' }} />

                <h3 style={{ fontSize: '14px', marginBottom: '16px' }}>Backup & Wiederherstellung</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.5 }}>
                    Exportiere deinen verschlüsselten Tresor als Backup-Datei.
                </p>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button type="button" onClick={handleExportVault} style={{ flex: 1, padding: '10px', background: 'transparent', color: 'white', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer' }}>
                        Backup exportieren
                    </button>
                    <label style={{ flex: 1, padding: '10px', background: 'transparent', color: 'white', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer', textAlign: 'center' }}>
                        Backup importieren
                        <input type="file" onChange={handleImportVault} accept=".sdvault,.db" style={{ display: 'none' }} />
                    </label>
                </div>

                <ImportExport />
                <GoogleDriveSync />
            </div>
        </div>
    );
}
