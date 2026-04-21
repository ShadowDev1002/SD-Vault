import { useState, useEffect, useCallback } from "react";
import { X, RefreshCw, Copy } from "lucide-react";
import { generatePassword, generatePassphrase } from "../utils/generator";
import type { GeneratePasswordOptions, GeneratePassphraseOptions } from "../utils/generator";

interface PasswordGeneratorProps {
    onClose: () => void;
}

const DEFAULT_PW_OPTS: GeneratePasswordOptions = {
    length: 20,
    upper: true,
    lower: true,
    digits: true,
    symbols: true,
};

const DEFAULT_PP_OPTS: GeneratePassphraseOptions = {
    wordCount: 4,
    separator: "-",
    capitalize: false,
    appendNumber: false,
};

export function PasswordGenerator({ onClose }: PasswordGeneratorProps) {
    const [tab, setTab] = useState<"classic" | "passphrase">("classic");
    const [result, setResult] = useState("");
    const [copied, setCopied] = useState(false);
    const [pwOpts, setPwOpts] = useState<GeneratePasswordOptions>(DEFAULT_PW_OPTS);
    const [ppOpts, setPpOpts] = useState<GeneratePassphraseOptions>(DEFAULT_PP_OPTS);

    const regenerate = useCallback(() => {
        if (tab === "classic") {
            setResult(generatePassword(pwOpts));
        } else {
            setResult(generatePassphrase(ppOpts));
        }
    }, [tab, pwOpts, ppOpts]);

    useEffect(() => { regenerate(); }, [regenerate]);

    async function handleCopy() {
        await navigator.clipboard.writeText(result);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }

    function setPwOpt<K extends keyof GeneratePasswordOptions>(key: K, value: GeneratePasswordOptions[K]) {
        setPwOpts(prev => {
            const next = { ...prev, [key]: value };
            // Mindestens eine Checkbox aktiv
            if (!next.upper && !next.lower && !next.digits && !next.symbols) return prev;
            return next;
        });
    }

    return (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(4px)" }}>
            <div style={{ background: "#1c1c1e", padding: "32px", borderRadius: "12px", width: "480px", border: "1px solid var(--border-color)", boxShadow: "0 24px 48px rgba(0,0,0,0.5)" }}>

                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
                    <h2 style={{ fontSize: "18px", margin: 0 }}>Passwort-Generator</h2>
                    <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: "4px" }}>
                        <X size={20} />
                    </button>
                </div>

                {/* Tabs */}
                <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
                    {(["classic", "passphrase"] as const).map(t => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            style={{ flex: 1, padding: "8px", borderRadius: "6px", border: "none", cursor: "pointer", fontSize: "14px", background: tab === t ? "var(--accent-blue)" : "var(--bg-secondary)", color: tab === t ? "#fff" : "var(--text-secondary)" }}
                        >
                            {t === "classic" ? "Klassisch" : "Passphrase"}
                        </button>
                    ))}
                </div>

                {/* Optionen */}
                {tab === "classic" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                        <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "14px" }}>
                            <span>Länge: <strong>{pwOpts.length}</strong></span>
                            <input
                                type="range" min={8} max={64} value={pwOpts.length}
                                onChange={e => setPwOpt("length", Number(e.target.value))}
                                style={{ width: "200px" }}
                            />
                        </label>
                        {([
                            { key: "upper" as const, label: "Großbuchstaben (A–Z)" },
                            { key: "lower" as const, label: "Kleinbuchstaben (a–z)" },
                            { key: "digits" as const, label: "Zahlen (0–9)" },
                            { key: "symbols" as const, label: "Sonderzeichen (!@#…)" },
                        ]).map(({ key, label }) => (
                            <label key={key} style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "14px", cursor: "pointer" }}>
                                <input
                                    type="checkbox" checked={pwOpts[key]}
                                    onChange={e => setPwOpt(key, e.target.checked)}
                                />
                                {label}
                            </label>
                        ))}
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                        <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "14px" }}>
                            <span>Wörter: <strong>{ppOpts.wordCount}</strong></span>
                            <input
                                type="range" min={3} max={8} value={ppOpts.wordCount}
                                onChange={e => setPpOpts(prev => ({ ...prev, wordCount: Number(e.target.value) }))}
                                style={{ width: "200px" }}
                            />
                        </label>
                        <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "14px" }}>
                            <span>Trennzeichen</span>
                            <select
                                value={ppOpts.separator}
                                onChange={e => setPpOpts(prev => ({ ...prev, separator: e.target.value }))}
                                style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "4px 8px" }}
                            >
                                <option value="-">Bindestrich (-)</option>
                                <option value="_">Unterstrich (_)</option>
                                <option value=".">Punkt (.)</option>
                                <option value=" ">Leerzeichen ( )</option>
                            </select>
                        </label>
                        {([
                            { key: "capitalize" as const, label: "Ersten Buchstaben groß" },
                            { key: "appendNumber" as const, label: "Zahl anhängen" },
                        ]).map(({ key, label }) => (
                            <label key={key} style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "14px", cursor: "pointer" }}>
                                <input
                                    type="checkbox" checked={ppOpts[key]}
                                    onChange={e => setPpOpts(prev => ({ ...prev, [key]: e.target.checked }))}
                                />
                                {label}
                            </label>
                        ))}
                    </div>
                )}

                {/* Ergebnis */}
                <div style={{ marginTop: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
                    <input
                        type="text" readOnly value={result}
                        style={{ width: "100%", padding: "12px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px", color: "var(--text-primary)", fontSize: "15px", fontFamily: "monospace", boxSizing: "border-box" }}
                    />
                    <div style={{ display: "flex", gap: "8px" }}>
                        <button
                            onClick={regenerate}
                            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "10px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "6px", color: "var(--text-primary)", cursor: "pointer", fontSize: "14px" }}
                        >
                            <RefreshCw size={14} /> Neu generieren
                        </button>
                        <button
                            onClick={handleCopy}
                            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "10px", background: copied ? "var(--accent-green, #4CD964)" : "var(--accent-blue)", border: "none", borderRadius: "6px", color: "#fff", cursor: "pointer", fontSize: "14px" }}
                        >
                            <Copy size={14} /> {copied ? "Kopiert!" : "Kopieren"}
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
}
