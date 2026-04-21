export interface GeneratePasswordOptions {
    length: number;
    upper: boolean;
    lower: boolean;
    digits: boolean;
    symbols: boolean;
}

export interface GeneratePassphraseOptions {
    wordCount: number;
    separator: string;
    capitalize: boolean;
    appendNumber: boolean;
}

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{}|;:,.<>?";

// Gleichmäßige Zufallsverteilung ohne Modulo-Bias
function randomIndex(max: number): number {
    const limit = Math.floor(0x100000000 / max) * max;
    const buf = new Uint32Array(1);
    do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % max;
}

export function generatePassword(opts: GeneratePasswordOptions): string {
    let chars = "";
    if (opts.upper) chars += UPPER;
    if (opts.lower) chars += LOWER;
    if (opts.digits) chars += DIGITS;
    if (opts.symbols) chars += SYMBOLS;
    if (!chars) chars = LOWER;
    return Array.from({ length: opts.length }, () => chars[randomIndex(chars.length)]).join("");
}

export function generatePassphrase(opts: GeneratePassphraseOptions): string {
    const words = Array.from({ length: opts.wordCount }, () => {
        const word = WORD_LIST[randomIndex(WORD_LIST.length)];
        return opts.capitalize
            ? word.charAt(0).toUpperCase() + word.slice(1)
            : word;
    });
    let phrase = words.join(opts.separator);
    if (opts.appendNumber) {
        phrase += opts.separator + String(10 + randomIndex(90));
    }
    return phrase;
}

// EFF Large Wordlist (https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt)
// Vollständige Liste einbinden:
//   curl -s https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt \
//     | awk '{print "    \"" $2 "\","}' >> src/utils/generator.ts
// Aktuell: 50-Wort-Beispiel. Für Produktion durch alle 7776 Wörter ersetzen.
const WORD_LIST: string[] = [
    "abacus", "abdomen", "abide", "ability", "ablaze", "aboard", "abode",
    "abrupt", "absence", "absorb", "abyss", "account", "achieve", "acorn",
    "acquire", "action", "adapt", "adobe", "adrift", "advice", "aerial",
    "affirm", "afford", "afoot", "afraid", "again", "agent", "agile",
    "aging", "airy", "alarm", "album", "almond", "alone", "alpine",
    "always", "amber", "ample", "anchor", "ancient", "angel", "anger",
    "ankle", "answer", "anvil", "apple", "apron", "arcade", "arctic",
    "argue",
];
