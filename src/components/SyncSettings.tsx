import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import type { BackupEntry, SftpConfig } from '../types';

interface Props {
    isUnlocked: boolean;
}

function SyncCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-2)' }}>
            <div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{title}</h3>
                {description && <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>{description}</p>}
            </div>
            {children}
        </div>
    );
}

function SyncInput({ label, value, onChange, type = 'text', placeholder, mono }: {
    label: string; value: string; onChange: (v: string) => void;
    type?: string; placeholder?: string; mono?: boolean;
}) {
    return (
        <div>
            <label className="block text-xs mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{label}</label>
            <input
                value={value}
                onChange={e => onChange(e.target.value)}
                type={type}
                placeholder={placeholder}
                className={`sd-input${mono ? ' font-mono' : ''}`}
            />
        </div>
    );
}

function StatusMsg({ msg }: { msg: string }) {
    if (!msg) return null;
    const ok = msg.startsWith('✓');
    return (
        <p className="text-xs px-3 py-2 rounded-lg" style={{
            color: ok ? 'var(--success)' : 'var(--danger)',
            backgroundColor: ok ? 'rgba(50,215,75,0.08)' : 'rgba(255,69,58,0.08)',
        }}>{msg}</p>
    );
}

function ActionRow({ children }: { children: React.ReactNode }) {
    return <div className="flex gap-2 flex-wrap">{children}</div>;
}

function PrimaryBtn({ onClick, disabled, children }: { onClick?: () => void; disabled?: boolean; children: React.ReactNode }) {
    return (
        <button onClick={onClick} disabled={disabled}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-opacity hover:opacity-85"
            style={{ backgroundColor: 'var(--accent)' }}>
            {children}
        </button>
    );
}

function SecondaryBtn({ onClick, children, type }: { onClick?: () => void; children: React.ReactNode; type?: 'button' | 'submit' }) {
    return (
        <button onClick={onClick} type={type ?? 'button'}
            className="px-4 py-2 rounded-lg text-sm border transition-colors hover:opacity-80"
            style={{ borderColor: 'var(--border)', color: 'var(--text-2)', backgroundColor: 'transparent' }}>
            {children}
        </button>
    );
}

export default function SyncSettings({ isUnlocked }: Props) {
    const [backups, setBackups] = useState<BackupEntry[]>([]);
    const [loadingBackup, setLoadingBackup] = useState(false);
    const [backupMsg, setBackupMsg] = useState('');
    const [transferMsg, setTransferMsg] = useState('');

    const [host, setHost] = useState('');
    const [port, setPort] = useState('22');
    const [username, setUsername] = useState('');
    const [remotePath, setRemotePath] = useState('/backups');
    const [authType, setAuthType] = useState<'KeyFile' | 'Password'>('KeyFile');
    const [keyPath, setKeyPath] = useState('');
    const [sftpPassword, setSftpPassword] = useState('');
    const [sftpMsg, setSftpMsg] = useState('');

    const [webdavUrl, setWebdavUrl] = useState('');
    const [webdavUser, setWebdavUser] = useState('');
    const [webdavPass, setWebdavPass] = useState('');
    const [webdavMsg, setWebdavMsg] = useState('');

    async function handleExportVault() {
        setTransferMsg('');
        const path = await save({ filters: [{ name: 'SD-Vault Backup', extensions: ['sdpx'] }], defaultPath: 'SD-Vault-Backup.sdpx' });
        if (!path) return;
        try {
            await invoke('export_vault', { savePath: path });
            setTransferMsg('✓ Vault exportiert — Datei sicher aufbewahren.');
        } catch (err) { setTransferMsg('Fehler: ' + String(err)); }
    }

    async function handleImportVault() {
        setTransferMsg('');
        const path = await open({ filters: [{ name: 'SD-Vault Backup', extensions: ['sdpx'] }] });
        if (!path) return;
        try {
            await invoke('import_vault', { sdpxPath: typeof path === 'string' ? path : path[0] });
            setTransferMsg('✓ Vault importiert — App neu starten.');
        } catch (err) { setTransferMsg('Fehler: ' + String(err)); }
    }

    async function handleLocalBackup() {
        setLoadingBackup(true); setBackupMsg('');
        try {
            await invoke('sync_local');
            setBackupMsg('✓ Backup erstellt');
            setBackups(await invoke<BackupEntry[]>('list_local_backups'));
        } catch (err) {
            setBackupMsg('Fehler: ' + String(err));
        } finally { setLoadingBackup(false); }
    }

    async function handleListBackups() {
        try { setBackups(await invoke<BackupEntry[]>('list_local_backups')); } catch {}
    }

    async function handleSaveSftp(e: React.FormEvent) {
        e.preventDefault(); setSftpMsg('');
        const sftp_config: SftpConfig = {
            host, port: parseInt(port, 10), username, remote_path: remotePath,
            auth: authType === 'KeyFile' ? { type: 'KeyFile', key_path: keyPath } : { type: 'Password', password: sftpPassword },
        };
        try {
            await invoke('save_sftp_config', { sftpConfig: sftp_config });
            setSftpMsg('✓ Konfiguration gespeichert');
        } catch (err) { setSftpMsg('Fehler: ' + String(err)); }
    }

    async function handleSftpSync() {
        setSftpMsg('');
        try { await invoke('sync_sftp'); setSftpMsg('✓ Sync erfolgreich'); }
        catch (err) { setSftpMsg('Fehler: ' + String(err)); }
    }

    async function handleSaveWebdav(e: React.FormEvent) {
        e.preventDefault(); setWebdavMsg('');
        try {
            await invoke('save_webdav_config', { webdavConfig: { url: webdavUrl, username: webdavUser, password: webdavPass, remote_path: '/sd-vault' } });
            setWebdavMsg('✓ Konfiguration gespeichert');
        } catch (err) { setWebdavMsg('Fehler: ' + String(err)); }
    }

    async function handleWebdavSync() {
        setWebdavMsg('');
        try { await invoke('sync_webdav'); setWebdavMsg('✓ Sync erfolgreich'); }
        catch (err) { setWebdavMsg('Fehler: ' + String(err)); }
    }

    if (!isUnlocked) {
        return <p className="text-sm" style={{ color: 'var(--text-2)' }}>Vault entsperren um Sync-Einstellungen zu ändern.</p>;
    }

    return (
        <div className="space-y-4">
            {/* Migration */}
            <SyncCard title="Vault-Migration" description="Vault als .sdpx exportieren und auf einem anderen Gerät importieren.">
                <ActionRow>
                    <PrimaryBtn onClick={handleExportVault}>Exportieren (.sdpx)</PrimaryBtn>
                    <SecondaryBtn onClick={handleImportVault}>Importieren (.sdpx)</SecondaryBtn>
                </ActionRow>
                <StatusMsg msg={transferMsg} />
            </SyncCard>

            {/* Local Backup */}
            <SyncCard title="Lokales Backup" description="Backup in deinem Dokumente-Ordner erstellen.">
                <ActionRow>
                    <PrimaryBtn onClick={handleLocalBackup} disabled={loadingBackup}>
                        {loadingBackup ? 'Erstelle…' : 'Backup erstellen'}
                    </PrimaryBtn>
                    <SecondaryBtn onClick={handleListBackups}>Backups anzeigen</SecondaryBtn>
                </ActionRow>
                <StatusMsg msg={backupMsg} />
                {backups.length > 0 && (
                    <div className="space-y-1 pt-1">
                        {backups.map(b => (
                            <div key={b.id} className="flex justify-between text-xs px-3 py-2 rounded-lg"
                                style={{ backgroundColor: 'var(--surface-3)', color: 'var(--text-2)' }}>
                                <span className="font-mono truncate">{b.id}</span>
                                <span className="shrink-0 ml-3">{(b.size_bytes / 1024).toFixed(1)} KB</span>
                            </div>
                        ))}
                    </div>
                )}
            </SyncCard>

            {/* SFTP */}
            <SyncCard title="SFTP Sync" description="Vault auf einem SSH-Server synchronisieren.">
                <form onSubmit={handleSaveSftp} className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2">
                            <SyncInput label="Host" value={host} onChange={setHost} placeholder="ssh.example.com" />
                        </div>
                        <SyncInput label="Port" value={port} onChange={setPort} type="number" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <SyncInput label="Benutzername" value={username} onChange={setUsername} />
                        <SyncInput label="Remote-Pfad" value={remotePath} onChange={setRemotePath} />
                    </div>
                    <div>
                        <label className="block text-xs mb-1.5 uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Authentifizierung</label>
                        <select value={authType} onChange={e => setAuthType(e.target.value as 'KeyFile' | 'Password')} className="sd-input">
                            <option value="KeyFile">SSH-Key</option>
                            <option value="Password">Passwort</option>
                        </select>
                    </div>
                    {authType === 'KeyFile'
                        ? <SyncInput label="SSH-Key Pfad" value={keyPath} onChange={setKeyPath} placeholder="/home/user/.ssh/id_ed25519" mono />
                        : <SyncInput label="Passwort" value={sftpPassword} onChange={setSftpPassword} type="password" />
                    }
                    <ActionRow>
                        <PrimaryBtn>Speichern</PrimaryBtn>
                        <SecondaryBtn onClick={handleSftpSync}>Jetzt synchronisieren</SecondaryBtn>
                    </ActionRow>
                    <StatusMsg msg={sftpMsg} />
                </form>
            </SyncCard>

            {/* WebDAV */}
            <SyncCard title="WebDAV Sync" description="Kompatibel mit Nextcloud, ownCloud und anderen WebDAV-Servern.">
                <form onSubmit={handleSaveWebdav} className="space-y-3">
                    <SyncInput label="Server-URL" value={webdavUrl} onChange={setWebdavUrl} placeholder="https://nextcloud.example.com/remote.php/dav/files/user" />
                    <div className="grid grid-cols-2 gap-3">
                        <SyncInput label="Benutzername" value={webdavUser} onChange={setWebdavUser} />
                        <SyncInput label="Passwort" value={webdavPass} onChange={setWebdavPass} type="password" />
                    </div>
                    <ActionRow>
                        <PrimaryBtn>Speichern</PrimaryBtn>
                        <SecondaryBtn onClick={handleWebdavSync}>Jetzt synchronisieren</SecondaryBtn>
                    </ActionRow>
                    <StatusMsg msg={webdavMsg} />
                </form>
            </SyncCard>
        </div>
    );
}
