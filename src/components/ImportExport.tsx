import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

export function ImportExport() {
    const [exportPwd, setExportPwd] = useState("");
    const [exportPwdConfirm, setExportPwdConfirm] = useState("");
    const [exportStatus, setExportStatus] = useState("");
    const [isExporting, setIsExporting] = useState(false);

    const [sdpxPwd, setSdpxPwd] = useState("");
    const [importStatus, setImportStatus] = useState("");
    const [isImporting, setIsImporting] = useState(false);

    const sdpxRef = useRef<HTMLInputElement>(null);
    const csvRef = useRef<HTMLInputElement>(null);

    async function handleExport() {
        if (exportPwd.length < 1) { setExportStatus("Passwort darf nicht leer sein."); return; }
        if (exportPwd !== exportPwdConfirm) { setExportStatus("Passwörter stimmen nicht überein."); return; }
        setIsExporting(true);
        setExportStatus("");
        try {
            const b64 = await invoke<string>("export_items", { password: exportPwd });
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes], { type: "application/octet-stream" });
            const el = document.createElement("a");
            el.href = URL.createObjectURL(blob);
            el.download = `SD_Passwort_Export_${new Date().toISOString().slice(0,10)}.sdpx`;
            document.body.appendChild(el); el.click(); document.body.removeChild(el);
            setExportStatus("Export erfolgreich!");
            setExportPwd(""); setExportPwdConfirm("");
        } catch (err) {
            setExportStatus(`Fehler: ${err}`);
        } finally {
            setIsExporting(false);
        }
    }

    function handleSdpxFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!sdpxPwd) { setImportStatus("Bitte zuerst das Export-Passwort eingeben."); return; }
        setIsImporting(true);
        setImportStatus("");
        const reader = new FileReader();
        reader.onload = async () => {
            const b64 = (reader.result as string).split(",")[1];
            if (!b64) { setImportStatus("Ungültige Datei."); setIsImporting(false); return; }
            try {
                const count = await invoke<number>("import_sdpx", { dataBase64: b64, password: sdpxPwd });
                setImportStatus(`${count} Einträge importiert.`);
                setSdpxPwd("");
            } catch (err) {
                setImportStatus(`Fehler: ${err}`);
            } finally {
                setIsImporting(false);
                if (sdpxRef.current) sdpxRef.current.value = "";
            }
        };
        reader.readAsDataURL(file);
    }

    function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!confirm("Bitwarden CSV ist unverschlüsselt. Bitte die Datei nach dem Import löschen. Fortfahren?")) return;
        setIsImporting(true);
        setImportStatus("");
        const reader = new FileReader();
        reader.onload = async () => {
            const csvText = reader.result as string;
            try {
                const count = await invoke<number>("import_bitwarden_csv", { csvText });
                setImportStatus(`${count} Einträge aus Bitwarden importiert.`);
            } catch (err) {
                setImportStatus(`Fehler: ${err}`);
            } finally {
                setIsImporting(false);
                if (csvRef.current) csvRef.current.value = "";
            }
        };
        reader.readAsText(file);
    }

    const labelStyle: React.CSSProperties = {
        fontSize: "12px", fontWeight: 600, color: "var(--text-tertiary)",
        marginBottom: "8px", display: "block",
    };
    const inputStyle: React.CSSProperties = {
        width: "100%", padding: "10px", borderRadius: "6px",
        border: "1px solid var(--border-color)", background: "rgba(255,255,255,0.03)",
        color: "white", marginBottom: "12px", boxSizing: "border-box",
    };
    const btnStyle: React.CSSProperties = {
        padding: "10px 16px", borderRadius: "6px", border: "1px solid var(--border-color)",
        background: "transparent", color: "white", cursor: "pointer", fontSize: "13px",
    };

    return (
        <div>
            <hr style={{ border: "none", borderTop: "1px solid var(--border-color)", margin: "32px 0" }} />
            <h3 style={{ fontSize: "14px", marginBottom: "16px" }}>Import / Export</h3>

            {/* Export */}
            <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px", lineHeight: 1.5 }}>
                Alle Einträge verschlüsselt exportieren (.sdpx). Das Export-Passwort wird zum Importieren benötigt.
            </p>
            <label style={labelStyle}>EXPORT-PASSWORT</label>
            <input type="password" value={exportPwd} onChange={e => setExportPwd(e.target.value)}
                placeholder="Export-Passwort" style={inputStyle} />
            <label style={labelStyle}>PASSWORT BESTÄTIGEN</label>
            <input type="password" value={exportPwdConfirm} onChange={e => setExportPwdConfirm(e.target.value)}
                placeholder="Wiederholen" style={{ ...inputStyle, marginBottom: "16px" }} />
            <button onClick={handleExport} disabled={isExporting || !exportPwd || exportPwd !== exportPwdConfirm}
                style={{ ...btnStyle, background: "var(--accent-blue)", border: "none", width: "100%", opacity: (!exportPwd || exportPwd !== exportPwdConfirm) ? 0.5 : 1 }}>
                {isExporting ? "Exportiere..." : "Exportieren (.sdpx)"}
            </button>
            {exportStatus && (
                <p style={{ fontSize: "12px", marginTop: "8px", color: exportStatus.startsWith("Fehler") ? "var(--danger)" : "#4CD964" }}>
                    {exportStatus}
                </p>
            )}

            {/* Import */}
            <div style={{ marginTop: "24px" }}>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px", lineHeight: 1.5 }}>
                    Einträge importieren aus .sdpx-Datei oder Bitwarden CSV.
                </p>
                <label style={labelStyle}>EXPORT-PASSWORT FÜR .SDPX</label>
                <input type="password" value={sdpxPwd} onChange={e => setSdpxPwd(e.target.value)}
                    placeholder="Passwort der .sdpx-Datei" style={inputStyle} />
                <div style={{ display: "flex", gap: "12px" }}>
                    <label style={{ ...btnStyle, flex: 1, textAlign: "center", cursor: isImporting ? "not-allowed" : "pointer", opacity: isImporting ? 0.5 : 1 }}>
                        SD-Passwort (.sdpx)
                        <input ref={sdpxRef} type="file" accept=".sdpx" onChange={handleSdpxFile}
                            disabled={isImporting} style={{ display: "none" }} />
                    </label>
                    <label style={{ ...btnStyle, flex: 1, textAlign: "center", cursor: isImporting ? "not-allowed" : "pointer", opacity: isImporting ? 0.5 : 1 }}>
                        Bitwarden CSV
                        <input ref={csvRef} type="file" accept=".csv" onChange={handleCsvFile}
                            disabled={isImporting} style={{ display: "none" }} />
                    </label>
                </div>
                {importStatus && (
                    <p style={{ fontSize: "12px", marginTop: "8px", color: importStatus.startsWith("Fehler") ? "var(--danger)" : "#4CD964" }}>
                        {importStatus}
                    </p>
                )}
            </div>
        </div>
    );
}
