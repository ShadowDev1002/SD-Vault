export type Category = 'login' | 'card' | 'note' | 'identity';
export type FieldType = 'text' | 'password' | 'url' | 'email' | 'phone' | 'date';

export interface CustomField {
    id: string;
    label: string;
    value: string;
    field_type: FieldType;
}

export interface ItemPayload {
    // Universal
    title: string;
    notes: string;
    favorite: boolean;
    fields: CustomField[];

    // Login
    username: string;
    password: string;
    url: string;
    totp: string;

    // Card
    cardholder: string;
    card_number: string;
    expiry: string;
    cvv: string;
    pin: string;

    // Identity
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    company: string;
    job_title: string;
    address: string;
    city: string;
    zip: string;
    country: string;
    birthday: string;
}

export interface Item {
    id: string;
    category: Category;
    updated_at: number;
    payload: ItemPayload;
}

export interface VaultMeta {
    id: string;
    created_at: number;
    argon2_mem: number;
    argon2_ops: number;
}

export interface BackupEntry {
    id: string;
    timestamp: number;
    size_bytes: number;
}

export interface SftpConfig {
    host: string;
    port: number;
    username: string;
    remote_path: string;
    auth:
        | { type: 'Password'; password: string }
        | { type: 'KeyFile'; key_path: string };
}

export interface AttachmentMeta {
    id: string;
    item_id: string;
    name: string;
    mime: string;
    size: number;
}

export interface WebDavConfig {
    url: string;
    username: string;
    password: string;
    remote_path: string;
}

export interface CreateVaultResult {
    vault_id: string;
    secret_key_formatted: string;
    created_at_formatted: string;
    pdf_bytes: number[];
}
