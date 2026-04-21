import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { 
  Shield, KeyRound, Plus, Copy, Trash2, 
  CreditCard, FileText, Code, StickyNote, Smartphone, Database, Search,
  RefreshCw, X, Eye
} from "lucide-react";
import "./App.css";

type ItemCategory = 'login' | 'finance' | 'document' | 'totp' | 'tech' | 'note';
type FieldType = 'text' | 'password' | 'url' | 'email' | 'totp' | 'date';

interface PasswordItem {
  id: string;
  category: ItemCategory;
  title: string;
  username: string;
  encrypted_payload: string;
}

interface CustomField {
  id: string;
  label: string;
  value: string;
  type: FieldType;
}

interface DecryptedPayload {
  fields: CustomField[];
  notes?: string;
}

const CATEGORIES: { id: ItemCategory | 'all', label: string, icon: any }[] = [
  { id: 'all', label: 'Alle Objekte', icon: Database },
  { id: 'login', label: 'Anmeldedaten', icon: KeyRound },
  { id: 'finance', label: 'Kreditkarten', icon: CreditCard },
  { id: 'document', label: 'Dokumente', icon: FileText },
  { id: 'totp', label: 'Einmalpasswörter', icon: Smartphone },
  { id: 'tech', label: 'Tech-Geheimnisse', icon: Code },
  { id: 'note', label: 'Sichere Notizen', icon: StickyNote },
];

const DEFAULT_FIELDS: Record<ItemCategory, CustomField[]> = {
  login: [
    { id: 'u1', label: 'Benutzername', value: '', type: 'text' },
    { id: 'p1', label: 'Passwort', value: '', type: 'password' },
    { id: 'w1', label: 'Website', value: '', type: 'url' },
    { id: 't1', label: 'Einmalpasswort', value: '', type: 'totp' },
  ],
  finance: [
    { id: 'f1', label: 'Karteninhaber', value: '', type: 'text' },
    { id: 'f2', label: 'Kartennummer', value: '', type: 'text' },
    { id: 'f3', label: 'Ablaufdatum', value: '', type: 'text' },
    { id: 'f4', label: 'Prüfnummer (CVV)', value: '', type: 'password' },
    { id: 'f5', label: 'PIN', value: '', type: 'password' },
  ],
  document: [
    { id: 'd1', label: 'Typ', value: '', type: 'text' },
    { id: 'd2', label: 'Nummer', value: '', type: 'text' },
    { id: 'd3', label: 'Ausstellungsdatum', value: '', type: 'date' },
    { id: 'd4', label: 'Ablaufdatum', value: '', type: 'date' },
  ],
  totp: [
    { id: 'to1', label: 'Dienst', value: '', type: 'text' },
    { id: 'to2', label: 'Secret Key', value: '', type: 'password' },
  ],
  tech: [
    { id: 'tc1', label: 'Host', value: '', type: 'url' },
    { id: 'tc2', label: 'API Key', value: '', type: 'password' },
    { id: 'tc3', label: 'SSH Private Key', value: '', type: 'password' },
  ],
  note: []
};

const COLORS = ['#FF2D55', '#FF9500', '#FFCC00', '#4CD964', '#5AC8FA', '#007AFF', '#5856D6', '#FF3B30'];

function getAvatarColor(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

function generatePassword(length = 24): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+~`|}{[]:;?><,./-=";
  let pass = "";
  for (let i = 0; i < length; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

export default function App() {
  const [vaultExists, setVaultExists] = useState<boolean | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [masterPassword, setMasterPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [secretKeyInput, setSecretKeyInput] = useState("");
  const [isDeriving, setIsDeriving] = useState(false);
  
  const [regStep, setRegStep] = useState<number>(1);
  const [generatedSecretKey, setGeneratedSecretKey] = useState<string>("");

  const [items, setItems] = useState<PasswordItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<ItemCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState("");
  
  const [selectedItem, setSelectedItem] = useState<PasswordItem | null>(null);
  const [decryptedItem, setDecryptedItem] = useState<DecryptedPayload | null>(null);
  
  const [isEditing, setIsEditing] = useState(false);
  const [editCategory, setEditCategory] = useState<ItemCategory>('login');
  const [editTitle, setEditTitle] = useState("");
  const [editFields, setEditFields] = useState<CustomField[]>([]);
  const [editNotes, setEditNotes] = useState("");
  
  const [showSettings, setShowSettings] = useState(false);
  const [settingNewPassword, setSettingNewPassword] = useState("");
  const [settingConfirmPassword, setSettingConfirmPassword] = useState("");

  const [showRecovery, setShowRecovery] = useState(false);
  const [recoverySecretKey, setRecoverySecretKey] = useState("");
  const [recoveryNewPassword, setRecoveryNewPassword] = useState("");
  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState("");

  useEffect(() => { initApp(); }, []);

  function generateSecretKey() {
    const segments = [];
    for(let i=0; i<4; i++) {
      segments.push(Math.random().toString(36).substring(2, 8).toUpperCase());
    }
    return `SD-${segments.join('-')}`;
  }

  async function initApp() {
    try {
      const exists = await invoke<boolean>("check_vault_exists");
      setVaultExists(exists);
      if (!exists) {
        setGeneratedSecretKey(generateSecretKey());
      }
      
      const unlocked = await invoke<boolean>("is_unlocked");
      setIsUnlocked(unlocked);
      if (unlocked) await loadItems();
    } catch (e) {
      console.error(e);
    }
  }

  async function loadItems() {
    try {
      setItems(await invoke<PasswordItem[]>("get_items"));
    } catch (e) {}
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (masterPassword !== confirmPassword) {
      alert("Passwörter stimmen nicht überein!");
      return;
    }
    if (masterPassword.length < 8) {
      alert("Das Master-Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }
    
    setIsDeriving(true);
    try {
      await invoke("create_vault", { password: masterPassword, secretKey: generatedSecretKey });
      localStorage.setItem("sd_secret_key", generatedSecretKey);
      
      setVaultExists(true);
      setIsUnlocked(true);
      await loadItems();
    } catch (error) {
      alert("Fehler beim Erstellen des Tresors.");
    } finally {
      setIsDeriving(false);
      setMasterPassword("");
      setConfirmPassword("");
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (settingNewPassword.length < 8) {
        alert("Das neue Passwort muss mindestens 8 Zeichen lang sein.");
        return;
    }
    if (settingNewPassword !== settingConfirmPassword) {
        alert("Passwörter stimmen nicht überein!");
        return;
    }
    setIsDeriving(true);
    try {
        await invoke("change_password", { newPassword: settingNewPassword });
        
        alert("Passwort erfolgreich geändert!");
        setShowSettings(false);
        setSettingNewPassword("");
        setSettingConfirmPassword("");
    } catch (e) {
        console.error(e);
        alert("Fehler beim Ändern des Passworts.");
    } finally {
        setIsDeriving(false);
    }
  }

  async function handleExportVault() {
    try {
      const b64 = await invoke<string>("export_vault_data");
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for(let i=0; i<bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
      const blob = new Blob([bytes], {type: "application/octet-stream"});
      const element = document.createElement("a");
      element.href = URL.createObjectURL(blob);
      element.download = "SD_Passwort_Backup.sdvault";
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
    } catch(e) {
      alert("Fehler beim Exportieren!");
    }
  }

  async function handleImportVault(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if(!file) return;
    
    if(!confirm("Achtung! Der aktuelle Tresor wird durch das Backup überschrieben! Fortfahren?")) return;

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const result = reader.result as string;
        const base64Data = result.split(",")[1];
        if(!base64Data) throw new Error("Invalid base64");
        await invoke("import_vault_data", { base64Data });
        alert("Backup erfolgreich importiert! Bitte entsperre den Tresor erneut.");
        window.location.reload();
      };
      reader.readAsDataURL(file);
    } catch(err) {
      alert("Fehler beim Importieren!");
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!masterPassword) return;
    
    setIsDeriving(true);
    try {
      let deviceSecret = localStorage.getItem("sd_secret_key") || secretKeyInput.trim().toUpperCase();
      await invoke("unlock_vault", { password: masterPassword });
      
      if (!localStorage.getItem("sd_secret_key") && deviceSecret) {
        localStorage.setItem("sd_secret_key", deviceSecret);
      }
      
      setIsUnlocked(true);
      await loadItems();
    } catch (error) {
      alert("Falsches Master-Passwort oder ungültiger Secret Key.");
    } finally {
      setIsDeriving(false);
      setMasterPassword("");
    }
  }

  async function handleRecover(e: React.FormEvent) {
    e.preventDefault();
    if (!recoverySecretKey) return;
    if (recoveryNewPassword.length < 8) {
        alert("Das neue Passwort muss mindestens 8 Zeichen lang sein.");
        return;
    }
    if (recoveryNewPassword !== recoveryConfirmPassword) {
        alert("Passwörter stimmen nicht überein!");
        return;
    }

    setIsDeriving(true);
    try {
      const cleanSecret = recoverySecretKey.trim().toUpperCase();
      await invoke("recover_vault", { secretKey: cleanSecret, newPassword: recoveryNewPassword });
      
      localStorage.setItem("sd_secret_key", cleanSecret);
      
      alert("Passwort erfolgreich zurückgesetzt!");
      setShowRecovery(false);
      setIsUnlocked(true);
      await loadItems();
    } catch (error) {
      alert("Ungültiger Secret Key oder Fehler bei der Wiederherstellung.");
    } finally {
      setIsDeriving(false);
      setRecoveryNewPassword("");
      setRecoveryConfirmPassword("");
    }
  }

  async function lockVault() {
    await invoke("lock_vault");
    setIsUnlocked(false);
    setItems([]);
    setSelectedItem(null);
    setDecryptedItem(null);
  }

  function startNewItem() {
    setSelectedItem(null);
    setDecryptedItem(null);
    setEditCategory('login');
    setEditTitle("Ohne Titel");
    setEditFields(JSON.parse(JSON.stringify(DEFAULT_FIELDS['login'])));
    setEditNotes("");
    setIsEditing(true);
  }

  function startEditItem() {
    if (!selectedItem || !decryptedItem) return;
    setEditCategory(selectedItem.category);
    setEditTitle(selectedItem.title);
    setEditFields(JSON.parse(JSON.stringify(decryptedItem.fields)));
    setEditNotes(decryptedItem.notes || "");
    setIsEditing(true);
  }

  async function selectItem(item: PasswordItem) {
    if(isEditing && !confirm("Änderungen verwerfen?")) return;
    setIsEditing(false);
    setSelectedItem(item);
    try {
      const decrypted = await invoke<string>("decrypt_data", { encryptedHex: item.encrypted_payload });
      const parsed = JSON.parse(decrypted);
      if(parsed.fields) setDecryptedItem(parsed);
      else {
        const fields: CustomField[] = [];
        Object.entries(parsed).forEach(([k, v]) => {
            if (k === 'notes') return;
            fields.push({ id: crypto.randomUUID(), label: k, value: String(v), type: (k.toLowerCase().includes('password') || k.toLowerCase().includes('cvv')) ? 'password' : 'text' });
        });
        setDecryptedItem({ fields, notes: parsed.notes });
      }
    } catch {
      setDecryptedItem({ fields: [], notes: '' });
    }
  }

  async function saveItem() {
    if (!editTitle) return;
    try {
      const usernameField = editFields.find(f => f.label.toLowerCase().includes('benutzer') || f.label.toLowerCase().includes('email'));
      const username = usernameField ? usernameField.value : "";

      const payload: DecryptedPayload = {
        fields: editFields.filter(f => f.value.trim() !== ""),
        notes: editNotes
      };
      
      const idToSave = selectedItem ? selectedItem.id : crypto.randomUUID();
      
      await invoke("add_item", { 
          id: idToSave,
          category: editCategory,
          title: editTitle, 
          username: username, 
          payload: JSON.stringify(payload) 
      });
      
      setIsEditing(false);
      await loadItems();
      
      const updatedItem = { id: idToSave, category: editCategory, title: editTitle, username, encrypted_payload: '' };
      setSelectedItem(updatedItem);
      setDecryptedItem(payload);
    } catch (error) {
      alert("Fehler beim Speichern.");
    }
  }

  async function deleteSelectedItem() {
    if(!selectedItem || !confirm("Eintrag wirklich löschen?")) return;
    try {
        await invoke("delete_item", { id: selectedItem.id });
        setSelectedItem(null);
        setDecryptedItem(null);
        setIsEditing(false);
        await loadItems();
    } catch (error) {
        alert("Fehler beim Löschen.");
    }
  }

  const copy = (text: string) => navigator.clipboard.writeText(text);

  if (vaultExists === null) return null;

  if (!isUnlocked) {
    if (!vaultExists) {
      return (
        <div className="login-screen">
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <Shield size={64} color="var(--accent-blue)" style={{ marginBottom: '16px' }} />
            <h1 style={{ fontSize: '24px', fontWeight: 600 }}>Willkommen bei SD-Passwort</h1>
            <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>Lokaler 100% Zero-Knowledge Tresor</p>
          </div>
          <form onSubmit={handleRegister} className="login-card" style={{ maxWidth: '420px' }}>
            {regStep === 1 ? (
              <>
                <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
                  Dein Tresor wird ausschließlich lokal verschlüsselt. Bitte erstelle ein sicheres Master-Passwort.
                </p>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>MASTER-PASSWORT</label>
                <input type="password" value={masterPassword} onChange={(e) => setMasterPassword(e.target.value)} placeholder="Mindestens 8 Zeichen" autoFocus />
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>PASSWORT BESTÄTIGEN</label>
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Passwort wiederholen" />
                <button type="button" onClick={() => {
                  if(masterPassword.length >= 8 && masterPassword === confirmPassword) setRegStep(2);
                  else alert("Bitte ein gültiges Passwort (min. 8 Zeichen) festlegen. Passwörter müssen übereinstimmen.");
                }}>
                  Weiter
                </button>
              </>
            ) : (
              <>
                <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
                  Um deine Sicherheit zu maximieren, generieren wir zusätzlich zum Passwort einen <strong style={{color:'white'}}>Secret Key</strong> für dieses Gerät. 
                </p>
                
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '24px', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '24px', textAlign: 'center' }}>
                  <div style={{ fontSize: '12px', color: 'var(--accent-blue)', fontWeight: 600, marginBottom: '8px' }}>DEIN SECRET KEY (Emergency Kit)</div>
                  <div style={{ fontSize: '18px', fontFamily: 'monospace', letterSpacing: '1px', color: 'white' }}>{generatedSecretKey}</div>
                </div>

                <p style={{ fontSize: '13px', color: 'var(--danger)', marginBottom: '24px', lineHeight: 1.5 }}>
                  <strong>Achtung:</strong> Speichere diesen Key sicher ab! Ohne Secret Key + Master-Passwort kannst du den Tresor auf einem neuen Gerät nicht öffnen!
                </p>

                <button type="button" onClick={() => {
                  const element = document.createElement("a");
                  const file = new Blob([`SD-PASSWORT EMERGENCY KIT\n\nSecret Key: ${generatedSecretKey}\n\nMaster-Passwort: ________________________\n\nBewahre dieses Dokument sicher auf! Ohne diesen Key und dein Passwort kommst du auf einem neuen Gerät nicht mehr an deine Daten!`], {type: 'text/plain'});
                  element.href = URL.createObjectURL(file);
                  element.download = "SD_Passwort_Emergency_Kit.txt";
                  document.body.appendChild(element);
                  element.click();
                  document.body.removeChild(element);
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

    // Normal Login
    const needsSecret = !localStorage.getItem("sd_secret_key");

    return (
      <div className="login-screen">
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <Shield size={64} color="var(--accent-blue)" style={{ marginBottom: '16px' }} />
          <h1 style={{ fontSize: '24px', fontWeight: 600 }}>SD-Passwort</h1>
        </div>
        
        {showRecovery ? (
          <form onSubmit={handleRecover} className="login-card">
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
              Gib deinen <strong style={{color:'white'}}>Secret Key</strong> ein, um deinen Tresor wiederherzustellen und ein neues Master-Passwort zu vergeben.
            </p>

            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>SECRET KEY</label>
            <input 
              type="text" 
              value={recoverySecretKey}
              onChange={(e) => setRecoverySecretKey(e.target.value)}
              placeholder="SD-A3-XXXXXX-XXXXXX-XXXXXX"
              style={{ fontFamily: 'monospace' }}
              autoFocus
            />
            
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block', marginTop: '16px' }}>NEUES MASTER-PASSWORT</label>
            <input 
              type="password" 
              value={recoveryNewPassword}
              onChange={(e) => setRecoveryNewPassword(e.target.value)}
              placeholder="Mindestens 8 Zeichen"
            />

            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block', marginTop: '16px' }}>PASSWORT BESTÄTIGEN</label>
            <input 
              type="password" 
              value={recoveryConfirmPassword}
              onChange={(e) => setRecoveryConfirmPassword(e.target.value)}
              placeholder="Passwort wiederholen"
            />

            <button type="submit" disabled={isDeriving}>
              {isDeriving ? "Wiederherstellen..." : "Tresor wiederherstellen"}
            </button>
            <button type="button" onClick={() => setShowRecovery(false)} style={{ background: 'transparent', color: 'var(--text-secondary)', marginTop: '12px', boxShadow: 'none' }}>
              Abbrechen
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="login-card">
            {needsSecret && (
              <>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>SECRET KEY (NEUES GERÄT)</label>
                <input 
                  type="text" 
                  value={secretKeyInput}
                  onChange={(e) => setSecretKeyInput(e.target.value)}
                  placeholder="SD-XXXX-XXXX..."
                  style={{ fontFamily: 'monospace' }}
                  autoFocus
                />
              </>
            )}
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>MASTER-PASSWORT</label>
            <input 
              type="password" 
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              placeholder="Dein Master-Passwort"
              autoFocus={!needsSecret}
            />
            <button type="submit" disabled={isDeriving}>
              {isDeriving ? "Wird entsperrt..." : "Entsperren"}
            </button>
            <button type="button" onClick={() => setShowRecovery(true)} style={{ background: 'transparent', color: 'var(--text-secondary)', marginTop: '12px', boxShadow: 'none' }}>
              Passwort vergessen? (Wiederherstellung mit Secret Key)
            </button>
            
            <button type="button" onClick={async () => {
               if(confirm("ACHTUNG: Dies löscht deinen gesamten Tresor unwiderruflich! Fortfahren?")) {
                   try {
                       await invoke("reset_vault");
                   } catch(e) {
                       console.error(e);
                   }
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

  const filteredItems = items.filter(item => {
    const s = searchQuery.toLowerCase();
    return (item.title.toLowerCase().includes(s) || item.username.toLowerCase().includes(s)) && 
           (selectedCategory === 'all' || item.category === selectedCategory);
  });

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <Shield size={22} color="var(--accent-blue)" />
          <h2>SD-Passwort</h2>
        </div>
        
        <div className="sidebar-nav">
          <div className="sidebar-section-title">Tresor</div>
          {CATEGORIES.slice(0,1).map(cat => (
            <div key={cat.id} className={`nav-item ${selectedCategory === cat.id ? 'active' : ''}`} onClick={() => setSelectedCategory(cat.id)}>
              <cat.icon size={16} /> {cat.label}
            </div>
          ))}

          <div className="sidebar-section-title" style={{ marginTop: '16px' }}>Kategorien</div>
          {CATEGORIES.slice(1).map(cat => (
            <div key={cat.id} className={`nav-item ${selectedCategory === cat.id ? 'active' : ''}`} onClick={() => setSelectedCategory(cat.id)}>
              <cat.icon size={16} /> {cat.label}
            </div>
          ))}
        </div>

        <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button className="lock-btn" onClick={() => setShowSettings(true)} style={{ background: 'transparent', color: 'var(--text-secondary)' }}>
            Einstellungen
          </button>
          <button className="lock-btn" onClick={lockVault}>
            Tresor sperren
          </button>
        </div>
      </div>

      {/* Middle Pane */}
      <div className="item-list-pane">
        <div className="list-toolbar">
          <div className="search-box">
            <Search size={14} color="var(--text-secondary)" />
            <input placeholder="Suchen" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </div>
          <button className="icon-btn" onClick={startNewItem} style={{ background: 'var(--accent-blue)', color: 'white' }}>
            <Plus size={16} />
          </button>
        </div>
        <div className="items-scroll">
          {filteredItems.map(item => (
            <div key={item.id} className={`list-item ${selectedItem?.id === item.id ? 'selected' : ''}`} onClick={() => selectItem(item)}>
              <div className="item-avatar" style={{ backgroundColor: getAvatarColor(item.title) }}>
                {item.title.charAt(0).toUpperCase()}
              </div>
              <div className="list-item-details">
                <div className="list-item-title">{item.title}</div>
                <div className="list-item-subtitle">{item.username || CATEGORIES.find(c=>c.id===item.category)?.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Pane */}
      <div className="details-pane">
        {(selectedItem && decryptedItem) || isEditing ? (
          <>
            <div className="details-toolbar">
              {isEditing ? (
                <>
                  <button className="btn" onClick={() => { if(selectedItem) selectItem(selectedItem); else { setIsEditing(false); setSelectedItem(null); } }}>Abbrechen</button>
                  <button className="btn btn-primary" onClick={saveItem}>Speichern</button>
                </>
              ) : (
                <>
                  <button className="btn" onClick={startEditItem}>Bearbeiten</button>
                  <button className="btn" style={{ color: 'var(--danger)' }} onClick={deleteSelectedItem}>Löschen</button>
                </>
              )}
            </div>

            <div className="details-content">
              {isEditing ? (
                // --- EDIT MODE ---
                <div>
                  <div className="details-header-large">
                    <div className="large-avatar" style={{ backgroundColor: getAvatarColor(editTitle || "A") }}>
                      {(editTitle || "O").charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <input className="large-title-input" value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="Titel" autoFocus />
                      <select 
                        value={editCategory} 
                        onChange={(e) => {
                          const cat = e.target.value as ItemCategory;
                          setEditCategory(cat);
                          if (!selectedItem) setEditFields(JSON.parse(JSON.stringify(DEFAULT_FIELDS[cat])));
                        }}
                        style={{ marginTop: '8px', background: 'transparent', color: 'var(--accent-blue)', border: 'none', outline: 'none', fontSize: '14px', cursor: 'pointer' }}
                      >
                        {CATEGORIES.filter(c=>c.id!=='all').map(c => <option key={c.id} value={c.id} style={{background: '#333', color: 'white'}}>{c.label}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="section-card">
                    {editFields.map(field => (
                      <div className="field-row" key={field.id} style={{ padding: '8px 20px', alignItems: 'center' }}>
                        <div className="field-label" style={{ paddingRight: '12px' }}>
                          <input className="edit-label-input" value={field.label} onChange={e => setEditFields(fs => fs.map(f => f.id === field.id ? {...f, label: e.target.value} : f))} />
                        </div>
                        <div className="field-value" style={{ gap: '8px' }}>
                          <input 
                            className="edit-input" 
                            type={field.type === 'password' ? 'text' : 'text'} 
                            value={field.value} 
                            onChange={e => setEditFields(fs => fs.map(f => f.id === field.id ? {...f, value: e.target.value} : f))} 
                            placeholder="Wert"
                            style={field.type === 'password' ? { fontFamily: 'monospace' } : {}}
                          />
                          {field.type === 'password' && (
                            <button className="icon-btn" onClick={() => setEditFields(fs => fs.map(f => f.id === field.id ? {...f, value: generatePassword()} : f))}><RefreshCw size={16} /></button>
                          )}
                          <button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => setEditFields(fs => fs.filter(f => f.id !== field.id))}><Trash2 size={16} /></button>
                        </div>
                      </div>
                    ))}
                    <div className="add-field-row">
                      <button className="add-field-btn" onClick={() => setEditFields([...editFields, {id: crypto.randomUUID(), label: 'Neues Feld', value: '', type: 'text'}])}>
                        <Plus size={14} /> Weiteres Feld
                      </button>
                    </div>
                  </div>

                  <div className="section-card-title">NOTIZEN</div>
                  <div className="section-card" style={{ padding: '12px' }}>
                    <textarea className="edit-input" value={editNotes} onChange={e => setEditNotes(e.target.value)} style={{ border: 'none', background: 'transparent' }} placeholder="Zusätzliche Informationen..."></textarea>
                  </div>
                </div>
              ) : (
                // --- VIEW MODE ---
                <div>
                  <div className="details-header-large">
                    <div className="large-avatar" style={{ backgroundColor: getAvatarColor(selectedItem?.title || "A") }}>
                      {(selectedItem?.title || "A").charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="large-title">{selectedItem?.title}</div>
                      <div className="large-subtitle">{CATEGORIES.find(c => c.id === selectedItem?.category)?.label}</div>
                    </div>
                  </div>

                  {decryptedItem?.fields && decryptedItem.fields.length > 0 && (
                    <div className="section-card">
                      {decryptedItem.fields.map(field => {
                        const isSensitive = field.type === 'password' || field.type === 'totp';
                        return (
                          <div className="field-row" key={field.id}>
                            <div className="field-label">{field.label}</div>
                            <div className={`field-value ${isSensitive ? 'obscured monospace' : ''}`}>
                              {isSensitive ? field.value.replace(/./g, '•') : field.value}
                            </div>
                            <div className="field-actions">
                              {isSensitive && (
                                <button className="icon-btn" onClick={(e) => {
                                  const row = e.currentTarget.parentElement?.parentElement;
                                  const valNode = row?.querySelector('.field-value');
                                  if(valNode) {
                                    valNode.textContent = field.value;
                                    valNode.classList.remove('obscured');
                                    setTimeout(() => { valNode.textContent = field.value.replace(/./g, '•'); valNode.classList.add('obscured'); }, 5000);
                                  }
                                }}><Eye size={16} /></button>
                              )}
                              <button className="icon-btn" onClick={() => copy(field.value)}><Copy size={16} /></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {decryptedItem?.notes && (
                    <>
                      <div className="section-card-title">NOTIZEN</div>
                      <div className="section-card">
                        <div style={{ padding: '16px 20px', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                          {decryptedItem.notes}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)' }}>
            <Shield size={64} style={{ opacity: 0.1 }} />
          </div>
        )}
      </div>
      
      {showSettings && (
        <div className="settings-modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div className="settings-modal" style={{ background: 'var(--bg-card)', padding: '32px', borderRadius: '12px', width: '400px', border: '1px solid var(--border-color)', boxShadow: '0 24px 48px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '18px', margin: 0 }}>Tresor Einstellungen</h2>
              <button className="icon-btn" onClick={() => setShowSettings(false)}><X size={20} /></button>
            </div>
            
            <form onSubmit={handleChangePassword}>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
                Hier kannst du dein Master-Passwort ändern. Deine Einträge werden mit dem neuen Passwort neu verschlüsselt.
              </p>

              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>NEUES MASTER-PASSWORT</label>
              <input 
                type="password" 
                value={settingNewPassword}
                onChange={(e) => setSettingNewPassword(e.target.value)}
                placeholder="Mindestens 8 Zeichen"
                style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.03)', color: 'white', marginBottom: '16px' }}
                autoFocus
              />
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>PASSWORT BESTÄTIGEN</label>
              <input 
                type="password" 
                value={settingConfirmPassword}
                onChange={(e) => setSettingConfirmPassword(e.target.value)}
                placeholder="Passwort wiederholen"
                style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.03)', color: 'white', marginBottom: '24px' }}
              />
              <button type="submit" disabled={isDeriving} style={{ width: '100%', padding: '12px', background: 'var(--accent-blue)', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}>
                {isDeriving ? "Wird geändert..." : "Passwort ändern"}
              </button>
            </form>
            
            <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '32px 0' }} />
            
            <h3 style={{ fontSize: '14px', marginBottom: '16px' }}>Backup & Wiederherstellung</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.5 }}>
              Du kannst deinen lokal verschlüsselten Tresor als Backup exportieren (z.B. für Google Drive, FTP) und wiederherstellen. Die Backup-Datei ist maximal verschlüsselt und kann nur mit deinem Master-Passwort + Secret Key gelesen werden.
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

          </div>
        </div>
      )}
    </div>
  );
}
