// Backups (roadmap 26): one .tar.gz of everything the world can't regenerate: the player saves, bots/market
// (trust, IOUs, ledger, careers, teams...), diaries, recaps and the orders. Into 2009scape/backups/, newest
// KEEP_DAYS days kept. Taken daily by the runner and before every launch (so a restart or reset can be undone).
//   node backup.mjs [label]        take one now
//   node backup.mjs list           list them
// Restore: stop the launcher, then `tar -xzf backups/<file> -C <dir>` per the paths printed when it was taken.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = path.resolve(HERE, '..');
const SRV = path.resolve(process.env.SERVER_DIR ?? path.join(ROOT, '..', '..', '2009scape-server'));
const OUT = path.join(ROOT, 'backups');
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS ?? 14);

export function backup(label = 'daily', log = console.log) {
    fs.mkdirSync(OUT, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const file = path.join(OUT, `world-${stamp}-${label}.tar.gz`);
    // -C each base so the archive holds short relative paths: Server/data/players, bots/market, ...
    const parts = [['-C', SRV, 'Server/data/players'], ['-C', ROOT, 'bots/market', 'bots/diaries', 'bots/recaps', 'bots/orders']]
        .map(([c, base, ...rel]) => [c, base, ...rel.filter(r => fs.existsSync(path.join(base, r)))]).filter(p => p.length > 2);
    const r = spawnSync('tar', ['-czf', file, ...parts.flat()], { encoding: 'utf8' });
    if (r.status !== 0) { log(`[backup] failed: ${(r.stderr || r.error?.message || '').slice(0, 200)}`); return null; }
    const mb = (fs.statSync(file).size / 1e6).toFixed(1);
    log(`[backup] ${path.basename(file)} (${mb} MB): players from ${SRV}, the rest from ${ROOT}`);
    // prune
    const cutoff = Date.now() - KEEP_DAYS * 86400_000;
    for (const f of fs.readdirSync(OUT).filter(f => f.startsWith('world-'))) if (fs.statSync(path.join(OUT, f)).mtimeMs < cutoff) fs.rmSync(path.join(OUT, f));
    return file;
}

if (process.argv[1]?.endsWith('backup.mjs')) {
    if (process.argv[2] === 'list') for (const f of fs.existsSync(OUT) ? fs.readdirSync(OUT).sort() : []) console.log(f, `${(fs.statSync(path.join(OUT, f)).size / 1e6).toFixed(1)} MB`);
    else backup(process.argv[2] ?? 'manual');
}
