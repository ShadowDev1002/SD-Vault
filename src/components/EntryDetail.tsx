import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Copy, Trash2, RefreshCw, Eye, Star, Paperclip } from "lucide-react";
import type { PasswordItem, DecryptedPayload, CustomField, ItemCategory, Tag, Attachment } from "../types";
import { getAvatarColor, generatePassword, DEFAULT_FIELDS, CATEGORIES } from "../types";

interface EntryDetailProps {
    item: PasswordItem | null;
    isCreating: boolean;
    onSaved: (savedId: string) => void;
    onDeleted: () => void;
    onCancelCreate: () => void;
    onFavoriteToggled: () => void;
}

export function EntryDetail({ item, isCreating, onSaved, onDeleted, onCancelCreate, onFavoriteToggled }: EntryDetailProps) {
    const [payload, setPayload] = useState<DecryptedPayload | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editTitle, setEditTitle] = useState("");
    const [editCategory, setEditCategory] = useState<ItemCategory>('login');
    const [editFields, setEditFields] = useState<CustomField[]>([]);
    const [editNotes, setEditNotes] = useState("");
    const [allTags, setAllTags] = useState<Tag[]>([]);
    const [itemTags, setItemTags] = useState<Tag[]>([]);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [revealedFields, setRevealedFields] = useState<Set<string>>(new Set());
    const loadCancelRef = useRef(false);

    useEffect(() => {
        invoke<[string, string][]>("get_tags").then(raw =>
            setAllTags(raw.map(([id, name]) => ({ id, name })))
        );
    }, []);

    useEffect(() => {
        if (isCreating) {
            loadCancelRef.current = true;
            setRevealedFields(new Set());
            setIsEditing(true);
            setEditTitle("Ohne Titel");
            setEditCategory('login');
            setEditFields(JSON.parse(JSON.stringify(DEFAULT_FIELDS['login'])));
            setEditNotes("");
            setItemTags([]);
            setPayload(null);
        } else if (item) {
            setRevealedFields(new Set());
            setIsEditing(false);
            loadItem(item);
        }
        return () => { loadCancelRef.current = true; };
    }, [item?.id, isCreating]);

    async function loadItem(item: PasswordItem) {
        loadCancelRef.current = false;
        try {
            const raw = await invoke<string>("decrypt_data", { encryptedHex: item.encrypted_payload });
            if (loadCancelRef.current) return;
            const parsed = JSON.parse(raw);
            setPayload(parsed.fields ? parsed : {
                fields: Object.entries(parsed)
                    .filter(([k]) => k !== 'notes')
                    .map(([k, v]) => ({
                        id: crypto.randomUUID(), label: k, value: String(v),
                        type: k.toLowerCase().includes('password') ? 'password' as const : 'text' as const,
                    })),
                notes: parsed.notes,
            });
        } catch { setPayload({ fields: [], notes: '' }); }

        if (loadCancelRef.current) return;
        const rawTags = await invoke<[string, string][]>("get_item_tags", { itemId: item.id });
        if (!loadCancelRef.current) setItemTags(rawTags.map(([id, name]) => ({ id, name })));

        const rawAtts = await invoke<[string, string][]>("get_attachments", { itemId: item.id });
        if (!loadCancelRef.current) setAttachments(rawAtts.map(([id, filename]) => ({ id, filename })));
    }

    async function handleSave() {
        if (!editTitle.trim()) return;
        setIsSaving(true);
        try {
            const usernameField = editFields.find(f =>
                f.label.toLowerCase().includes('benutzer') || f.label.toLowerCase().includes('email')
            );
            const id = item?.id ?? crypto.randomUUID();
            await invoke("add_item", {
                id,
                category: editCategory,
                title: editTitle,
                username: usernameField?.value ?? "",
                payload: JSON.stringify({ fields: editFields.filter(f => f.value.trim()), notes: editNotes }),
            });
            await invoke("set_item_tags", { itemId: id, tagIds: itemTags.map(t => t.id) });
            setIsEditing(false);
            onSaved(id);
        } catch { alert("Fehler beim Speichern."); }
        finally { setIsSaving(false); }
    }

    async function handleDelete() {
        if (!item || !confirm("Eintrag wirklich löschen?")) return;
        await invoke("delete_item", { id: item.id });
        onDeleted();
    }

    async function handleToggleFavorite() {
        if (!item) return;
        await invoke("toggle_favorite", { id: item.id });
        onFavoriteToggled();
    }

    async function handleAddAttachment(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file || !item) return;
        const reader = new FileReader();
        reader.onload = async () => {
            if (typeof reader.result !== 'string') return;
            const b64 = reader.result.split(",")[1];
            if (!b64) return;
            await invoke("add_attachment", { id: crypto.randomUUID(), itemId: item.id, filename: file.name, dataB64: b64 });
            const raw = await invoke<[string, string][]>("get_attachments", { itemId: item.id });
            setAttachments(raw.map(([id, filename]) => ({ id, filename })));
        };
        reader.readAsDataURL(file);
    }

    async function handleDownloadAttachment(att: Attachment) {
        const data = await invoke<string>("get_attachment_data", { id: att.id });
        const bin = atob(data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes]);
        const el = document.createElement("a");
        el.href = URL.createObjectURL(blob);
        el.download = att.filename;
        el.click();
        setTimeout(() => URL.revokeObjectURL(el.href), 100);
    }

    async function handleDeleteAttachment(id: string) {
        await invoke("delete_attachment", { id });
        setAttachments(prev => prev.filter(a => a.id !== id));
    }

    async function handleNewTag() {
        const name = prompt("Tag-Name:");
        if (!name?.trim()) return;
        const id = crypto.randomUUID();
        await invoke("create_tag", { id, name: name.trim() });
        const raw = await invoke<[string, string][]>("get_tags");
        const updated = raw.map(([id, name]) => ({ id, name }));
        setAllTags(updated);
    }

    function toggleEditTag(tag: Tag) {
        setItemTags(prev => prev.find(t => t.id === tag.id)
            ? prev.filter(t => t.id !== tag.id)
            : [...prev, tag]
        );
    }

    const copy = (text: string) => navigator.clipboard.writeText(text);

    if (!item && !isCreating) {
        return (
            <div className="details-pane" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontSize: '64px', opacity: 0.1 }}>🔒</div>
            </div>
        );
    }

    const displayTitle = isEditing ? editTitle : (item?.title ?? "");
    const displayCategory = isEditing ? editCategory : (item?.category ?? 'login');

    return (
        <div className="details-pane">
            <div className="details-toolbar">
                {isEditing ? (
                    <>
                        <button className="btn" onClick={() => { if (isCreating) onCancelCreate(); else { setIsEditing(false); if (item) loadItem(item); } }}>Abbrechen</button>
                        <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>{isSaving ? "..." : "Speichern"}</button>
                    </>
                ) : (
                    <>
                        <button className="btn" onClick={() => {
                            if (!item) return;
                            setEditTitle(item.title);
                            setEditCategory(item.category);
                            setEditFields(JSON.parse(JSON.stringify(payload?.fields ?? [])));
                            setEditNotes(payload?.notes ?? "");
                            setIsEditing(true);
                        }}>Bearbeiten</button>
                        <button className="btn" onClick={handleToggleFavorite} title={item?.is_favorite ? "Aus Favoriten entfernen" : "Zu Favoriten"}>
                            <Star size={15} fill={item?.is_favorite ? "#FFCC00" : "none"} color={item?.is_favorite ? "#FFCC00" : "currentColor"} />
                        </button>
                        <button className="btn" style={{ color: 'var(--danger)' }} onClick={handleDelete}>Löschen</button>
                    </>
                )}
            </div>

            <div className="details-content">
                {/* Header */}
                <div className="details-header-large">
                    <div className="large-avatar" style={{ backgroundColor: getAvatarColor(displayTitle || "A") }}>
                        {(displayTitle || "O").charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                        {isEditing ? (
                            <>
                                <input className="large-title-input" value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="Titel" autoFocus />
                                <select value={editCategory} onChange={e => { const cat = e.target.value as ItemCategory; setEditCategory(cat); if (isCreating) setEditFields(JSON.parse(JSON.stringify(DEFAULT_FIELDS[cat]))); }}
                                    style={{ marginTop: '8px', background: 'transparent', color: 'var(--accent-blue)', border: 'none', outline: 'none', fontSize: '14px', cursor: 'pointer' }}>
                                    {CATEGORIES.filter(c => c.id !== 'all' && c.id !== 'favorites').map(c =>
                                        <option key={c.id} value={c.id} style={{ background: '#333', color: 'white' }}>{c.label}</option>
                                    )}
                                </select>
                            </>
                        ) : (
                            <>
                                <div className="large-title">{displayTitle}</div>
                                <div className="large-subtitle">{CATEGORIES.find(c => c.id === displayCategory)?.label}</div>
                            </>
                        )}
                    </div>
                </div>

                {/* Fields */}
                <div className="section-card">
                    {isEditing ? (
                        <>
                            {editFields.map(field => (
                                <div className="field-row" key={field.id} style={{ padding: '8px 20px', alignItems: 'center' }}>
                                    <div className="field-label" style={{ paddingRight: '12px' }}>
                                        <input className="edit-label-input" value={field.label} onChange={e => setEditFields(fs => fs.map(f => f.id === field.id ? { ...f, label: e.target.value } : f))} />
                                    </div>
                                    <div className="field-value" style={{ gap: '8px' }}>
                                        <input className="edit-input" type="text" value={field.value} onChange={e => setEditFields(fs => fs.map(f => f.id === field.id ? { ...f, value: e.target.value } : f))} placeholder="Wert" style={field.type === 'password' ? { fontFamily: 'monospace' } : {}} />
                                        {field.type === 'password' && (
                                            <button className="icon-btn" onClick={() => setEditFields(fs => fs.map(f => f.id === field.id ? { ...f, value: generatePassword() } : f))}><RefreshCw size={16} /></button>
                                        )}
                                        <button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => setEditFields(fs => fs.filter(f => f.id !== field.id))}><Trash2 size={16} /></button>
                                    </div>
                                </div>
                            ))}
                            <div className="add-field-row">
                                <button className="add-field-btn" onClick={() => setEditFields([...editFields, { id: crypto.randomUUID(), label: 'Neues Feld', value: '', type: 'text' }])}>
                                    <Plus size={14} /> Weiteres Feld
                                </button>
                            </div>
                        </>
                    ) : (
                        payload?.fields?.map(field => {
                            const sensitive = field.type === 'password' || field.type === 'totp';
                            const isRevealed = revealedFields.has(field.id);
                            return (
                                <div className="field-row" key={field.id}>
                                    <div className="field-label">{field.label}</div>
                                    <div className={`field-value ${sensitive && !isRevealed ? 'obscured monospace' : ''}`}>
                                        {sensitive && !isRevealed ? field.value.replace(/./g, '•') : field.value}
                                    </div>
                                    <div className="field-actions">
                                        {sensitive && (
                                            <button className="icon-btn" onClick={() => {
                                                setRevealedFields(prev => {
                                                    const next = new Set(prev);
                                                    next.add(field.id);
                                                    return next;
                                                });
                                                setTimeout(() => {
                                                    setRevealedFields(prev => {
                                                        const next = new Set(prev);
                                                        next.delete(field.id);
                                                        return next;
                                                    });
                                                }, 5000);
                                            }}><Eye size={16} /></button>
                                        )}
                                        <button className="icon-btn" onClick={() => copy(field.value)}><Copy size={16} /></button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Notes */}
                {(isEditing || payload?.notes) && (
                    <>
                        <div className="section-card-title">NOTIZEN</div>
                        <div className="section-card" style={{ padding: '12px' }}>
                            {isEditing ? (
                                <textarea className="edit-input" value={editNotes} onChange={e => setEditNotes(e.target.value)} style={{ border: 'none', background: 'transparent', width: '100%', minHeight: '80px' }} placeholder="Zusätzliche Informationen..." />
                            ) : (
                                <div style={{ padding: '16px 20px', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{payload?.notes}</div>
                            )}
                        </div>
                    </>
                )}

                {/* Tags */}
                <div className="section-card-title">TAGS</div>
                <div className="section-card" style={{ padding: '12px 20px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {isEditing ? (
                        <>
                            {allTags.map(tag => (
                                <button key={tag.id} onClick={() => toggleEditTag(tag)}
                                    style={{ padding: '4px 10px', borderRadius: '12px', border: '1px solid var(--border-color)', background: itemTags.find(t => t.id === tag.id) ? 'var(--accent-blue)' : 'transparent', color: 'white', cursor: 'pointer', fontSize: '12px' }}>
                                    {tag.name}
                                </button>
                            ))}
                            <button onClick={handleNewTag} style={{ padding: '4px 10px', borderRadius: '12px', border: '1px dashed var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '12px' }}>
                                + Neuer Tag
                            </button>
                        </>
                    ) : itemTags.length > 0 ? (
                        itemTags.map(tag => (
                            <span key={tag.id} style={{ padding: '4px 10px', borderRadius: '12px', background: 'rgba(0,122,255,0.15)', color: 'var(--accent-blue)', fontSize: '12px' }}>
                                {tag.name}
                            </span>
                        ))
                    ) : (
                        <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>Keine Tags</span>
                    )}
                </div>

                {/* Attachments — only for existing items */}
                {!isCreating && item && (
                    <>
                        <div className="section-card-title">ANHÄNGE</div>
                        <div className="section-card" style={{ padding: '12px 20px' }}>
                            {attachments.map(att => (
                                <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
                                    <Paperclip size={14} color="var(--text-secondary)" />
                                    <span style={{ flex: 1, fontSize: '14px' }}>{att.filename}</span>
                                    <button className="icon-btn" onClick={() => handleDownloadAttachment(att)} title="Herunterladen"><Copy size={14} /></button>
                                    <button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => handleDeleteAttachment(att.id)}><Trash2 size={14} /></button>
                                </div>
                            ))}
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px', marginTop: attachments.length ? '8px' : '0' }}>
                                <Plus size={14} /> Datei anhängen
                                <input type="file" onChange={handleAddAttachment} style={{ display: 'none' }} />
                            </label>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
