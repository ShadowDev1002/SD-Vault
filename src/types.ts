export type ItemCategory = 'login' | 'finance' | 'document' | 'totp' | 'tech' | 'note';
export type FieldType = 'text' | 'password' | 'url' | 'email' | 'totp' | 'date';
export type FilterCategory = ItemCategory | 'all' | 'favorites';

export interface PasswordItem {
    id: string;
    category: ItemCategory;
    title: string;
    username: string;
    encrypted_payload: string;
    is_favorite: boolean;
}

export interface CustomField {
    id: string;
    label: string;
    value: string;
    type: FieldType;
}

export interface DecryptedPayload {
    fields: CustomField[];
    notes?: string;
}

export interface Tag {
    id: string;
    name: string;
}

export interface Attachment {
    id: string;
    filename: string;
}

export const CATEGORIES: { id: FilterCategory; label: string }[] = [
    { id: 'all', label: 'Alle Objekte' },
    { id: 'favorites', label: 'Favoriten' },
    { id: 'login', label: 'Anmeldedaten' },
    { id: 'finance', label: 'Kreditkarten' },
    { id: 'document', label: 'Dokumente' },
    { id: 'totp', label: 'Einmalpasswörter' },
    { id: 'tech', label: 'Tech-Geheimnisse' },
    { id: 'note', label: 'Sichere Notizen' },
];

export const DEFAULT_FIELDS: Record<ItemCategory, CustomField[]> = {
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
    note: [],
};

export const AVATAR_COLORS = [
    '#FF2D55', '#FF9500', '#FFCC00', '#4CD964',
    '#5AC8FA', '#007AFF', '#5856D6', '#FF3B30',
];

export function getAvatarColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function generatePassword(length = 24): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+~`|}{[]:;?><,./-=';
    let pass = '';
    for (let i = 0; i < length; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
    return pass;
}
