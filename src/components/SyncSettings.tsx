import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import type { BackupEntry, SftpConfig } from '../types';

interface Props {
    isUnlocked: boolean;
}

export default function SyncSettings({ isUnlocked }: Props) {
    const [backups, setBackups] = useState<BackupEntry[]>([]);
    const [loadingBackup, setLoadingBackup] = useState(false);
    const [syncMsg, setSyncMsg] = useState('');

    // SFTP form state
    const [host, setHost] = useState('');
    const [port, setPort] = useState('22');
    const [username, setUsername] = useState('');
    const [remotePath, setRemotePath] = useState('/backups');
    const [authType, setAuthType] = useState<'KeyFile' | 'Password'>('KeyFile');
    const [keyPath, setKeyPath] = useState('');
    const [password, setPassword] = useState('');
    const [sftpMsg, setSftpMsg] = useState('');

    // WebDAV form state
    const [webdavUrl, setWebdavUrl] = useState('');
    const [webdavUser, setWebdavUser] = useState('');
    const [webdavPass, setWebdavPass] = useState('');
    const [webdavMsg, setWebdavMsg] = useState('');

    // Export / Import state
    const [transferMsg, setTransferMsg] = useState('');

    async function handleExportVault() {
        setTransferMsg('');
        const path = await save({ filters: [{ name: 'SD-Vault Backup', extensions: ['sdpx'] }], defaultPath: 'SD-Vault-Backup.sdpx' });
        if (!path) return;
        try {
            await invoke('export_vault', { savePath: path });
            setTransferMsg('✓ Vault exportiert – Datei sicher aufbewahren!');
        } catch (err) { setTransferMsg('Fehler: ' + String(err)); }
    }

    async function handleImportVault() {
        setTransferMsg('');
        const path = await open({ filters: [{ name: 'SD-Vault Backup', extensions: ['sdpx'] }] });
        if (!path) return;
        try {
            await invoke('import_vault', { sdpxPath: typeof path === 'string' ? path : path[0] });
            setTransferMsg('✓ Vault importiert – App neu starten um ihn zu öffnen.');
        } catch (err) { setTransferMsg('Fehler: ' + String(err)); }
    }

    async function handleLocalBackup() {
        setLoadingBackup(true);
        setSyncMsg('');
        try {
            await invoke('sync_local');
            setSyncMsg('✓ Backup erstellt');
            const list = await invoke<BackupEntry[]>('list_local_backups');
            setBackups(list);
        } catch (err) {
            setSyncMsg('Fehler: ' + String(err));
        } finally {
            setLoadingBackup(false);
        }
    }

    async function handleListBackups() {
        try {
            const list = await invoke<BackupEntry[]>('list_local_backups');
            setBackups(list);
        } catch {
            // ignore
        }
    }

    async function handleSaveSftp(e: React.FormEvent) {
        e.preventDefault();
        setSftpMsg('');
        const sftp_config: SftpConfig = {
            host,
            port: parseInt(port, 10),
            username,
            remote_path: remotePath,
            auth: authType === 'KeyFile'
                ? { type: 'KeyFile', key_path: keyPath }
                : { type: 'Password', password },
        };
        try {
            await invoke('save_sftp_config', { sftpConfig: sftp_config });
            setSftpMsg('✓ Konfiguration gespeichert');
        } catch (err) {
            setSftpMsg('Fehler: ' + String(err));
        }
    }

    async function handleSftpSync() {
        setSyncMsg('');
        try {
            await invoke('sync_sftp');
            setSyncMsg('✓ SFTP Sync erfolgreich');
        } catch (err) {
            setSyncMsg('Fehler: ' + String(err));
        }
    }

    if (!isUnlocked) {
        return <p className="text-sm" style={{ color: 'var(--vault-muted)' }}>Vault entsperren um Sync-Einstellungen zu ändern.</p>;
    }

    return (
        <div className="space-y-6">
            {/* Vault Migration */}
            <section className="space-y-3">
                <h3 className="text-sm font-semibold text-white">Vault-Migration (Neuer PC)</h3>
                <p className="text-xs" style={{ color: 'var(--vault-muted)' }}>
                    Exportiere deinen Vault als <strong style={{ color: 'var(--vault-fg)' }}>.sdpx</strong>-Datei
                    und importiere sie auf dem neuen PC. Du brauchst danach nur noch dein <strong style={{ color: 'var(--vault-fg)' }}>Master-Passwort</strong>.
                </p>
                <div className="flex gap-2">
                    <button onClick={handleExportVault}
                        className="px-4 py-2 rounded-lg text-sm text-white"
                        style={{ backgroundColor: 'var(--vault-accent)' }}>
                        Vault exportieren (.sdpx)
                    </button>
                    <button onClick={handleImportVault}
                        className="px-4 py-2 rounded-lg text-sm border"
                        style={{ borderColor: 'var(--vault-border)', color: 'var(--vault-muted)' }}>
                        Vault importieren (.sdpx)
                    </button>
                </div>
                {transferMsg && (
                    <p className="text-sm" style={{ color: transferMsg.startsWith('✓') ? '#22c55e' : 'var(--vault-danger)' }}>
                        {transferMsg}
                    </p>
                )}
            </section>

            {/* Local Backup */}
            <section className="space-y-3">
                <h3 className="text-sm font-semibold text-white">Lokales Backup</h3>
                <div className="flex gap-2">
                    <button
                        onClick={handleLocalBackup}
                        disabled={loadingBackup}
                        className="px-4 py-2 rounded-lg text-sm text-white disabled:opacity-50"
                        style={{ backgroundColor: 'var(--vault-accent)' }}
                    >
                        {loadingBackup ? 'Erstelle...' : 'Backup erstellen'}
                    </button>
                    <button
                        onClick={handleListBackups}
                        className="px-4 py-2 rounded-lg text-sm border"
                        style={{ borderColor: 'var(--vault-border)', color: 'var(--vault-muted)' }}
                    >
                        Backups anzeigen
                    </button>
                </div>

                {syncMsg && <p className="text-sm" style={{ color: syncMsg.startsWith('✓') ? '#22c55e' : 'var(--vault-danger)' }}>{syncMsg}</p>}

                {backups.length > 0 && (
                    <div className="space-y-1">
                        {backups.map(b => (
                            <div key={b.id} className="flex justify-between text-xs px-3 py-2 rounded border" style={{ borderColor: 'var(--vault-border)', color: 'var(--vault-muted)' }}>
                                <span>{b.id}</span>
                                <span>{(b.size_bytes / 1024).toFixed(1)} KB</span>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* SFTP */}
            <section className="space-y-3">
                <h3 className="text-sm font-semibold text-white">SFTP Sync</h3>
                <form onSubmit={handleSaveSftp} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs mb-1" style={{ color: 'var(--vault-muted)' }}>Host</label>
                            <input value={host} onChange={e => setHost(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-white text-sm" style={{ backgroundColor: 'var(--vault-bg)', borderColor: 'var(--vault-border)' }} placeholder="ssh.example.com" />
                        </div>
                        <div>
                            <label className="block text-xs mb-1" style={{ color: 'var(--vault-muted)' }}>Port</label>
                            <input value={port} onChange={e => setPort(e.target.value)} type="number" className="w-full px-3 py-2 rounded-lg border text-white text-sm" style={{ backgroundColor: 'var(--vault-bg)', borderColor: 'var(--vault-border)' }} />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs mb-1" style={{ color: 'var(--vault-muted)' }}>Benutzername</label>
                        <input value={username} onChange={e => setUsername(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-white text-sm" style={{ backgroundColor: 'var(--vault-bg)', borderColor: 'var(--vault-border)' }} />
                    </div>
                    <div>
                        <label className="block text-xs mb-1" style={{ color: 'var(--vault-muted)' }}>Remote-Pfad</label>
                        <input value={remotePath} onChange={e => setRemotePath(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-white text-sm" style={{ backgroundColor: 'var(--vault-bg)', borderColor: 'var(--vault-border)' }} />
                    </div>
                    <div>
                        <label className="block text-xs mb-1" style={{ color: 'var(--vault-muted)' }}>Authentifizierung</label>
                        <select value={authType} onChange={e => setAuthType(e.target.value as 'KeyFile' | 'Password')} className="w-full px-3 py-2 rounded-lg border text-white text-sm" style={{ backgroundColor: 'var(--vault-bg)', borderColor: 'var(--vault-border)' }}>
                            <option value="KeyFile">SSH-Key</option>
                            <option value="Password">Passwort</option>
                        </select>
                    </div>
                    {authType === 'KeyFile' ? (
                        <div>
                            <label className="block text-xs mb-1" style={{ color: 'var(--vault-muted)' }}>Pfad zum SSH-Key</label>
                            <input value={keyPath} onChange={e => setKeyPath(e.target.value)} className="w-full px-3 py-2 rounded-lg border text-white text-sm font-mono" style={{ backgroundColor: 'var(--vault-bg)', borderColor: 'var(--vault-border)' }} placeholder="/home/user/.ssh/id_ed25519" />
                        </div>
                    ) : (
                        <div>
                            <label className="block text-xs mb-1" style={{ color: 'var(--vault-muted)' }}>Passwort</label>
                            <input value={password} onChange={e => setPassword(e.target.value)} type="password" className="w-full px-3 py-2 rounded-lg border text-white text-sm" style={{ backgroundColor: 'var(--vault-bg)', borderColor: 'var(--vault-border)' }} />
                        </div>
                    )}
                    <div className="flex gap-2">
                        <button type="submit" className="px-4 py-2 rounded-lg text-sm text-white" style={{ backgroundColor: 'var(--vault-accent)' }}>
                            Speichern
                        </button>
                        <button type="button" onClick={handleSftpSync} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: 'var(--vault-border)', color: 'var(--vault-muted)' }}>
                            Jetzt synchronisieren
                        </button>
                    </div>
                    {sftpMsg && <p className="text-sm" style={{ color: sftpMsg.startsWith('✓') ? '#22c55e' : 'var(--vault-danger)' }}>{sftpMsg}</p>}
                </form>
            </section>

            {/* WebDAV */}
            <section className="space-y-3">
                <h3 className="text-sm font-semibold text-white">WebDAV Sync</h3>
                <p className="text-xs" style={{ color: 'var(--vault-muted)' }}>
                    Kompatibel mit Nextcloud, ownCloud und anderen WebDAV-Servern.
                </p>
                <form onSubmit={async e => {
                    e.preventDefault(); setWebdavMsg('');
                    try {
                        await invoke('save_webdav_config', {
                            webdavConfig: { url: webdavUrl, username: webdavUser, password: webdavPass, remote_path: '/sd-vault' }
                        });
                        setWebdavMsg('✓ Konfiguration gespeichert');
                    } catch (err) { setWebdavMsg('Fehler: ' + String(err)); }
                }} className="space-y-3">
                    <div>
                        <label className="block text-xs mb-1" style={{ color: 'var(--vault-muted)' }}>Server-URL</label>
                        <input value={webdavUrl} onChange={e => setWebdavUrl(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border text-white text-sm"
                            style={{ backgroundColor: 'var(--vault-bg)', borderColor: 'var(--vault-border)' }}
                            placeholder="https://nextcloud.example.com/remote.php/dav/files/user" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs mb-1" style={{ color: 'var(--vault-muted)' }}>Benutzername</label>
                            <input value={webdavUser} onChange={e => setWebdavUser(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border text-white text-sm"
                                style={{ backgroundColor: 'var(--vault-bg)', borderColor: 'var(--vault-border)' }} />
                        </div>
                        <div>
                            <label className="block text-xs mb-1" style={{ color: 'var(--vault-muted)' }}>Passwort</label>
                            <input value={webdavPass} onChange={e => setWebdavPass(e.target.value)}
                                type="password"
                                className="w-full px-3 py-2 rounded-lg border text-white text-sm"
                                style={{ backgroundColor: 'var(--vault-bg)', borderColor: 'var(--vault-border)' }} />
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button type="submit" className="px-4 py-2 rounded-lg text-sm text-white" style={{ backgroundColor: 'var(--vault-accent)' }}>
                            Speichern
                        </button>
                        <button type="button" onClick={async () => {
                            setWebdavMsg('');
                            try { await invoke('sync_webdav'); setWebdavMsg('✓ WebDAV Sync erfolgreich'); }
                            catch (err) { setWebdavMsg('Fehler: ' + String(err)); }
                        }} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: 'var(--vault-border)', color: 'var(--vault-muted)' }}>
                            Jetzt synchronisieren
                        </button>
                    </div>
                    {webdavMsg && <p className="text-sm" style={{ color: webdavMsg.startsWith('✓') ? '#22c55e' : 'var(--vault-danger)' }}>{webdavMsg}</p>}
                </form>
            </section>
        </div>
    );
}
