// Phase 4.3: each bot keeps a diary of notable events in bots/diaries/<bot>.md
// (first death, level milestones, biggest trade, debts, betrayals, grudges, team politics, market days,
// random events, collections, quests). `node recap.mjs` turns the last day of diaries into a recap.
import fs from 'fs';
import path from 'path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
export const DIARY_DIR = path.join(ROOT, 'diaries');
const MARKS = path.join(DIARY_DIR, '.marks.json'); // one-time milestones and personal records per bot
let marks = null;
const loadMarks = () => (marks ??= fs.existsSync(MARKS) ? JSON.parse(fs.readFileSync(MARKS, 'utf8')) : {});
const saveMarks = () => fs.writeFileSync(MARKS, JSON.stringify(marks, null, 2));

// Write one diary line. `once`: a milestone key, written only the first time (e.g. 'first-death'). Returns whether it wrote.
export function note(name, text, { once = null } = {}) {
    if (!name) return;
    fs.mkdirSync(DIARY_DIR, { recursive: true });
    if (once) {
        const m = loadMarks();
        if ((m[name] ??= {})[once]) return false;
        m[name][once] = new Date().toISOString();
        saveMarks();
    }
    const f = path.join(DIARY_DIR, `${name}.md`);
    if (!fs.existsSync(f)) fs.writeFileSync(f, `# ${name}'s diary\n\n`);
    fs.appendFileSync(f, `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} ${text}\n`);
    return true;
}

// Personal record (e.g. biggest trade): true, and remembered, if `value` beats the bot's previous best.
export function record(name, key, value) {
    const m = loadMarks();
    const r = (m[name] ??= {});
    if ((r[key] ?? 0) >= value) return false;
    r[key] = value;
    saveMarks();
    return true;
}

// Level-up chat message -> diary milestone (every 5 levels up to 30, then every 10, and 99).
export function noteLevel(name, text) {
    const m = /advanced an? ([\w ]+?) level! You have reached level (\d+)/i.exec(text);
    if (!m) return;
    const lv = Number(m[2]);
    if ((lv <= 30 && lv % 5 === 0) || lv % 10 === 0 || lv === 99) note(name, `Reached ${m[1]} level ${lv}.`, { once: `${m[1].toLowerCase()}-${lv}` });
}

// Parse diary lines: [{ bot, t (ms), text }]
export function readDiaries(sinceMs = 0) {
    if (!fs.existsSync(DIARY_DIR)) return [];
    const out = [];
    for (const f of fs.readdirSync(DIARY_DIR).filter(f => f.endsWith('.md'))) {
        const bot = f.slice(0, -3);
        for (const line of fs.readFileSync(path.join(DIARY_DIR, f), 'utf8').split('\n')) {
            const m = /^- (\d{4}-\d\d-\d\d \d\d:\d\d) (.*)$/.exec(line);
            if (!m) continue;
            const t = Date.parse(m[1].replace(' ', 'T') + ':00Z');
            if (t >= sinceMs) out.push({ bot, t, text: m[2] });
        }
    }
    return out.sort((a, b) => a.t - b.t);
}
