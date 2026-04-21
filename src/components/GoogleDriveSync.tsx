import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

interface SyncConfig {
    id: string;
    provider: string;
    last_synced_at: number | null;
}

type SyncResult =
    | { status: "UpToDate" }
    | { status: "Uploaded" }
    | { status: "Downloaded" }
    | { status: "Conflict"; detail: { backup_path: string } }
    | { status: "Error"; detail: string };

export function GoogleDriveSync() {
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [status, setStatus] = useState("");
    const [lastSynced, setLastSynced] = useState<number | null>(null);

    useEffect(() => {
        invoke<SyncConfig[]>("get_sync_configs")
            .then(configs => {
                const drive = configs.find(c => c.provider === "google_drive");
                setIsConnected(!!drive);
                if (drive) setLastSynced(drive.last_synced_at);
            })
            .catch(() => {});
    }, []);

    async function handleConnect() {
        setIsConnecting(true);
        setStatus("Öffne Browser...");
        try {
            const authUrl = await invoke<string>("start_google_oauth");
            await openUrl(authUrl);
            setStatus("Warte auf Browser-Bestätigung (max. 2 Minuten)...");
            await invoke<void>("complete_google_oauth");
            setIsConnected(true);
            setStatus("Erfolgreich verbunden!");
        } catch (err) {
            setStatus(`Fehler: ${err}`);
        } finally {
            setIsConnecting(false);
        }
    }

    async function handleSync() {
        setIsSyncing(true);
        setStatus("");
        try {
            const result = await invoke<SyncResult>("trigger_sync", { configId: "google_drive" });
            const labels: Record<string, string> = {
                UpToDate: "Bereits aktuell",
                Uploaded: "Hochgeladen",
                Downloaded: "Heruntergeladen",
                Conflict: "Konflikt — lokales Backup erstellt",
            };
            setStatus(labels[result.status] ?? "Synchronisiert");
            setLastSynced(Math.floor(Date.now() / 1000));
        } catch (err) {
            setStatus(`Fehler: ${err}`);
        } finally {
            setIsSyncing(false);
        }
    }

    async function handleDisconnect() {
        if (!confirm("Google Drive Verbindung trennen?")) return;
        try {
            await invoke<void>("disconnect_google_drive");
            setIsConnected(false);
            setStatus("");
            setLastSynced(null);
        } catch (err) {
            setStatus(`Fehler: ${err}`);
        }
    }

    const btnStyle: React.CSSProperties = {
        padding: "10px 16px", borderRadius: "6px", border: "1px solid var(--border-color)",
        background: "transparent", color: "white", cursor: "pointer", fontSize: "13px",
    };

    return (
        <div>
            <hr style={{ border: "none", borderTop: "1px solid var(--border-color)", margin: "32px 0" }} />
            <h3 style={{ fontSize: "14px", marginBottom: "16px" }}>Google Drive Sync</h3>

            {!isConnected ? (
                <>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px", lineHeight: 1.5 }}>
                        Tresor verschlüsselt mit Google Drive synchronisieren. Daten landen in einem privaten App-Ordner.
                    </p>
                    <button
                        onClick={handleConnect}
                        disabled={isConnecting}
                        style={{ ...btnStyle, width: "100%", opacity: isConnecting ? 0.6 : 1 }}
                    >
                        {isConnecting ? "Verbinde..." : "Mit Google Drive verbinden"}
                    </button>
                </>
            ) : (
                <>
                    <p style={{ fontSize: "12px", color: "#4CD964", marginBottom: "8px" }}>
                        ✓ Verbunden
                    </p>
                    {lastSynced && (
                        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px" }}>
                            Letzter Sync: {new Date(lastSynced * 1000).toLocaleString("de-DE")}
                        </p>
                    )}
                    <div style={{ display: "flex", gap: "12px" }}>
                        <button
                            onClick={handleSync}
                            disabled={isSyncing}
                            style={{ ...btnStyle, flex: 1, background: "var(--accent-blue)", border: "none", opacity: isSyncing ? 0.6 : 1 }}
                        >
                            {isSyncing ? "Synchronisiere..." : "Jetzt synchronisieren"}
                        </button>
                        <button onClick={handleDisconnect} style={btnStyle}>
                            Trennen
                        </button>
                    </div>
                </>
            )}

            {status && (
                <p style={{ fontSize: "12px", marginTop: "8px", color: status.startsWith("Fehler") ? "var(--danger)" : "#4CD964" }}>
                    {status}
                </p>
            )}
        </div>
    );
}
