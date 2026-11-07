// Public notice board (roadmap D15): what everyone in town can read. Rebuilt every few minutes from the shared
// files (bounties, the trade ledger, trust) into bots/market/noticeboard.json, printed in the recap, and read by
// the bots: a posted going price pulls each bot's own price for that item toward it, so prices converge.
//   import { buildBoard, boardPrice } from './noticeboard.mjs'
import fs from 'fs';
import path from 'path';

const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'market');
const FILE = path.join(DIR, 'noticeboard.json');
const PRICE_WINDOW = 48 * 3600_000;
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return d; } };
const jsonl = f => { try { return fs.readFileSync(path.join(DIR, f), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

export function buildBoard() {
    const now = Date.now();
    // going prices: the median unit price of completed sales in the last two days (3+ sales)
    const sales = jsonl('ledger.jsonl').filter(r => r.outcome === 'completed' && r.kind === 'sale' && r.item !== 'Coins' && now - Date.parse(r.t) < PRICE_WINDOW && r.price > 0);
    const byItem = {};
    for (const r of sales) (byItem[r.item] ??= []).push(r.price / (r.amount || 1));
    const prices = Object.fromEntries(Object.entries(byItem).filter(([, p]) => p.length >= 3).map(([item, p]) => [item, { price: Math.round(median(p) * 10) / 10, sales: p.length }]));
    // open jobs
    const bounties = read('bounties.json', []).filter(b => b.status === 'open').map(b => ({ id: b.id, poster: b.poster, item: b.item, qty: b.qty, reward: b.reward }));
    // reputations: average trust others hold in each bot (5+ opinions), the best and worst five
    const trust = read('trust.json', {});
    const held = {};
    for (const [, row] of Object.entries(trust)) for (const [b, v] of Object.entries(row ?? {})) (held[b] ??= []).push(v);
    const rep = Object.entries(held).filter(([, v]) => v.length >= 5).map(([bot, v]) => ({ bot, trust: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100, opinions: v.length })).sort((a, b) => b.trust - a.trust);
    // who owes: overdue IOUs
    const overdue = read('ious.json', []).filter(i => i.status === 'open' && i.due && i.due < now).map(i => ({ debtor: i.debtor, creditor: i.creditor, amount: i.owed }));
    const board = { updated: new Date(now).toISOString(), prices, bounties, mostTrusted: rep.slice(0, 5), leastTrusted: rep.slice(-5).reverse().filter(r => r.trust < 0), overdue };
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(board, null, 1));
    fs.renameSync(FILE + '.tmp', FILE);
    return board;
}

let cache = null, cachedAt = 0;
export function readBoard() {
    if (Date.now() - cachedAt > 60_000) { cache = read('noticeboard.json', null); cachedAt = Date.now(); }
    return cache;
}
export const boardPrice = item => readBoard()?.prices?.[item]?.price ?? null;

// Markdown for the recap
export function boardMarkdown(board = readBoard()) {
    if (!board) return [];
    const out = ['## The notice board', ''];
    const p = Object.entries(board.prices).sort((a, b) => b[1].sales - a[1].sales).slice(0, 12);
    if (p.length) out.push(`- **Going prices:** ${p.map(([i, x]) => `${i} ${x.price}gp`).join(', ')}.`);
    if (board.bounties.length) out.push(`- **Wanted:** ${board.bounties.slice(0, 8).map(b => `${b.qty} ${b.item} for ${b.reward}gp (${b.poster})`).join('; ')}.`);
    if (board.mostTrusted.length) out.push(`- **Good names in town:** ${board.mostTrusted.map(r => `${r.bot} (${r.trust})`).join(', ')}.`);
    if (board.leastTrusted.length) out.push(`- **Watch out for:** ${board.leastTrusted.map(r => `${r.bot} (${r.trust})`).join(', ')}.`);
    if (board.overdue.length) out.push(`- **Overdue debts:** ${board.overdue.slice(0, 8).map(o => `${o.debtor} owes ${o.creditor} ${o.amount}gp`).join('; ')}.`);
    return out.length > 2 ? [...out, ''] : [];
}
