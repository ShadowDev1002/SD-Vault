import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, RefreshCw, CheckCircle, AlertTriangle, Upload, Download } from "lucide-react";

interface SyncConfig {
    id: string;
    provider: string;
    enabled: boolean;
    interval_secs: number;
    remote_url: string;
    remote_path: string;
    username: string;
    password: string;
    last_synced_at: number | null;
    last_remote_hash: string | null;
}

type SyncResult =
    | { status: "UpToDate" }
    | { status: "Uploaded" }
    | { status: "Downloaded" }
    | { status: "Conflict"; detail: { backup_path: string } }
    | { status: "Error"; detail: string };

interface SyncStatusProps {
    onClose: () => void;
}

const EMPTY_CONFIG = (provider: string): SyncConfig => ({
    id: provider,
    provider,
    enabled: false,
    interval_secs: 300,
    remote_url: "",
    remote_path: "/vaultzero.db",
    username: "",
    password: "",
    last_synced_at: null,
    last_remote_hash: null,
});

function formatTs(ts: number | null): string {
    if (!ts) return "Noch nie";
    return new Date(ts * 1000).toLocaleString("de-DE");
}

function SyncResultBadge({ result }: { result: SyncResult | null }) {
    if (!result) return null;
    const map: Record<string, { label: string; color: string; Icon: React.ElementType }> = {
        UpToDate: { label: "Aktuell", color: "#4CD964", Icon: CheckCircle },
        Uploaded: { label: "Hochgeladen", color: "#5AC8FA", Icon: Upload },
        Downloaded: { label: "Heruntergeladen", color: "#5AC8FA", Icon: Download },
        Conflict: { label: "Konflikt!", color: "#FF9500", Icon: AlertTriangle },
        Error: { label: "Fehler", color: "#FF3B30", Icon: AlertTriangle },
    };
    const entry = map[result.status] ?? map.Error;
    const { label, color, Icon } = entry;
    return (
        <div style={{ display: "flex", alignItems: "center", gap: "6px", color, fontSize: "13px" }}>
            <Icon size={14} /> {label}
            {result.status === "Conflict" && (
                <span style={{ color: "var(--text-secondary)", fontSize: "11px" }}>
                    — Backup: {(result as Extract<SyncResult, { status: "Conflict" }>).detail.backup_path}
                </span>
            )}
            {result.status === "Error" && (
                <span style={{ color: "var(--text-secondary)", fontSize: "11px" }}>
                    — {(result as Extract<SyncResult, { status: "Error" }>).detail}
                </span>
            )}
        </div>
    );
}

function ProviderForm({
    title,
    provider,
    urlLabel,
    urlPlaceholder,
    portHint,
}: {
    title: string;
    provider: string;
    urlLabel: string;
    urlPlaceholder: string;
    portHint?: string;
}) {
    const [config, setConfig] = useState<SyncConfig>(EMPTY_CONFIG(provider));
    const [isSaving, setIsSaving] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

    useEffect(() => {
        invoke<SyncConfig[]>("get_sync_configs")
            .then(configs => {
                const found = configs.find(c => c.id === provider);
                if (found) setConfig(found);
            })
            .catch(() => {});
    }, [provider]);

    async function handleSave(e: React.FormEvent) {
        e.preventDefault();
        setIsSaving(true);
        try {
            await invoke("save_sync_config", { config });
            alert("Gespeichert!");
        } catch (err) {
            alert(`Fehler: ${err}`);
        } finally {
            setIsSaving(false);
        }
    }

    async function handleSync() {
        setIsSyncing(true);
        setSyncResult(null);
        try {
            const result = await invoke<SyncResult>("trigger_sync", { configId: provider });
            setSyncResult(result);
        } catch (err) {
            setSyncResult({ status: "Error", detail: String(err) });
        } finally {
            setIsSyncing(false);
        }
    }

    async function handleDelete() {
        if (!confirm(`${title}-Konfiguration löschen?`)) return;
        await invoke("delete_sync_config", { id: provider });
        setConfig(EMPTY_CONFIG(provider));
        setSyncResult(null);
    }

    const inputStyle: React.CSSProperties = {
        width: "100%",
        padding: "10px",
        borderRadius: "6px",
        border: "1px solid var(--border-color)",
        background: "rgba(255,255,255,0.03)",
        color: "white",
        boxSizing: "border-box",
    };

    const labelStyle: React.CSSProperties = {
        fontSize: "11px",
        fontWeight: 600,
        color: "var(--text-tertiary)",
        display: "block",
        marginBottom: "6px",
    };

    return (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: "10px", padding: "24px", marginBottom: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                <h3 style={{ fontSize: "16px", margin: 0 }}>{title}</h3>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", cursor: "pointer" }}>
                    <input
                        type="checkbox"
                        checked={config.enabled}
                        onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))}
                    />
                    Aktiviert
                </label>
            </div>

            <form onSubmit={handleSave}>
                <div style={{ marginBottom: "16px" }}>
                    <label style={labelStyle}>{urlLabel}</label>
                    <input type="text" value={config.remote_url} onChange={e => setConfig(c => ({ ...c, remote_url: e.target.value }))} placeholder={urlPlaceholder} style={inputStyle} />
                    {portHint && <p style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px", marginBottom: 0 }}>{portHint}</p>}
                </div>
                <div style={{ marginBottom: "16px" }}>
                    <label style={labelStyle}>REMOTE-PFAD</label>
                    <input type="text" value={config.remote_path} onChange={e => setConfig(c => ({ ...c, remote_path: e.target.value }))} placeholder="/vaultzero.db" style={inputStyle} />
                </div>
                <div style={{ marginBottom: "16px" }}>
                    <label style={labelStyle}>BENUTZERNAME</label>
                    <input type="text" value={config.username} onChange={e => setConfig(c => ({ ...c, username: e.target.value }))} style={inputStyle} />
                </div>
                <div style={{ marginBottom: "16px" }}>
                    <label style={labelStyle}>PASSWORT</label>
                    <input type="password" value={config.password} onChange={e => setConfig(c => ({ ...c, password: e.target.value }))} style={inputStyle} />
                </div>

                <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
                    <button type="submit" disabled={isSaving} style={{ flex: 1, padding: "10px", background: "var(--accent-blue)", color: "white", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer" }}>
                        {isSaving ? "Speichern..." : "Speichern"}
                    </button>
                    <button type="button" onClick={handleSync} disabled={isSyncing} style={{ flex: 1, padding: "10px", background: "transparent", border: "1px solid var(--border-color)", color: "white", borderRadius: "6px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                        <RefreshCw size={14} style={{ animation: isSyncing ? "spin 1s linear infinite" : "none" }} />
                        {isSyncing ? "Syncing..." : "Jetzt sync"}
                    </button>
                    <button type="button" onClick={handleDelete} style={{ padding: "10px 14px", background: "transparent", border: "1px solid var(--danger)", color: "var(--danger)", borderRadius: "6px", cursor: "pointer" }}>
                        Löschen
                    </button>
                </div>
            </form>

            <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
                    Zuletzt synchronisiert: {formatTs(config.last_synced_at)}
                </div>
                <SyncResultBadge result={syncResult} />
            </div>
        </div>
    );
}

export function SyncStatus({ onClose }: SyncStatusProps) {
    return (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(4px)" }}>
            <div style={{ background: "#1c1c1e", padding: "32px", borderRadius: "12px", width: "520px", maxHeight: "90vh", overflowY: "auto", border: "1px solid var(--border-color)", boxShadow: "0 24px 48px rgba(0,0,0,0.5)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "28px" }}>
                    <h2 style={{ fontSize: "18px", margin: 0 }}>Sync-Konfiguration</h2>
                    <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: "4px" }}>
                        <X size={20} />
                    </button>
                </div>
                <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "24px", lineHeight: 1.6 }}>
                    Der Tresor wird als verschlüsselte Datei synchronisiert. Das Passwort ist nicht übertragbar — die Datei ist ohne dein Master-Passwort wertlos.
                </p>
                <ProviderForm
                    title="WebDAV (Nextcloud, ownCloud, etc.)"
                    provider="webdav"
                    urlLabel="SERVER-URL"
                    urlPlaceholder="https://nextcloud.example.com/remote.php/dav/files/user"
                />
                <ProviderForm
                    title="SFTP"
                    provider="sftp"
                    urlLabel="HOST"
                    urlPlaceholder="meinserver.de:22"
                    portHint="Format: host:port (Standard-Port: 22)"
                />
            </div>
        </div>
    );
}
