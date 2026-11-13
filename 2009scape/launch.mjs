#!/usr/bin/env node
// One launcher for Linux (e.g. CachyOS), macOS and Windows: sets up the 2009Scape server if needed, starts it,
// waits until it's up, then starts the bots. Ctrl+C stops everything (bots first, so they log out cleanly).
//
//   node launch.mjs                 set up if needed, start server + all bots
//   node launch.mjs --server-only   just the server (and bot API)
//   node launch.mjs --setup         only clone/patch/build the server
//   node launch.mjs --rebuild       re-apply BotApi.kt and rebuild before starting
//
// Needs: git with git-lfs, JDK 11 (JAVA11_HOME, JAVA_HOME or `java` on PATH), Node.js 22+.
// Server checkout: ../../2009scape-server next to this repo (override with SERVER_DIR).
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'); // Windows drive paths
const SRV = path.resolve(process.env.SERVER_DIR ?? path.join(HERE, '..', '..', '2009scape-server'));
const WIN = os.platform() === 'win32';
const args = new Set(process.argv.slice(2));
const log = (...a) => console.log(`[launch] ${a.join(' ')}`);
const die = msg => { console.error(`[launch] ${msg}`); process.exit(1); };

function run(cmd, cmdArgs, opts = {}) {
    const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: WIN, ...opts });
    if (r.status !== 0) die(`failed: ${cmd} ${cmdArgs.join(' ')}`);
}
const has = (cmd, a = ['--version']) => spawnSync(cmd, a, { stdio: 'ignore', shell: WIN }).status === 0;

// ---- prerequisites ----
function javaHome() {
    for (const h of [process.env.JAVA11_HOME, process.env.JAVA_HOME].filter(Boolean)) {
        const bin = path.join(h, 'bin', WIN ? 'java.exe' : 'java');
        if (fs.existsSync(bin)) return h;
    }
    return null; // fall back to `java` on PATH
}
function javaVersion(bin) {
    const r = spawnSync(bin, ['-version'], { encoding: 'utf8', shell: WIN });
    const m = /version "(\d+)(?:\.(\d+))?/.exec((r.stderr ?? '') + (r.stdout ?? ''));
    return m ? (m[1] === '1' ? Number(m[2]) : Number(m[1])) : null;
}
const JH = javaHome();
const JAVA = JH ? path.join(JH, 'bin', WIN ? 'java.exe' : 'java') : 'java';
const env = { ...process.env, ...(JH ? { JAVA_HOME: JH, PATH: path.join(JH, 'bin') + path.delimiter + process.env.PATH } : {}) };

function checkPrereqs() {
    const node = Number(process.versions.node.split('.')[0]);
    if (node < 22) die(`Node.js 22+ needed (have ${process.versions.node})`);
    if (!has('git')) die('git not found');
    if (!has('git', ['lfs', 'version'])) die('git-lfs not found (Linux: install git-lfs; Windows: included with Git for Windows)');
    const jv = javaVersion(JAVA);
    if (jv == null) die('Java not found: install JDK 11 and set JAVA11_HOME (or JAVA_HOME)');
    if (jv !== 11) log(`warning: Java ${jv} found; the server is built and tested with JDK 11 (set JAVA11_HOME)`);
}

// ---- setup: clone, patch, build (same steps as setup.sh) ----
const JAR = path.join(SRV, 'Server', 'target', 'server-1.0.0-jar-with-dependencies.jar');
function setup({ rebuild = false } = {}) {
    if (!fs.existsSync(SRV)) {
        log(`cloning 2009Scape into ${SRV}`);
        run('git', ['clone', '--depth', '1', 'https://gitlab.com/2009scape/2009scape.git', SRV]);
        run('git', ['lfs', 'install', '--local'], { cwd: SRV });
        run('git', ['lfs', 'pull'], { cwd: SRV });
    }
    const apiDir = path.join(SRV, 'Server', 'src', 'main', 'content', 'botapi');
    fs.mkdirSync(apiDir, { recursive: true });
    const apiSrc = path.join(HERE, 'server-patch', 'content', 'botapi', 'BotApi.kt');
    const apiDst = path.join(apiDir, 'BotApi.kt');
    const apiChanged = !fs.existsSync(apiDst) || fs.readFileSync(apiSrc, 'utf8') !== fs.readFileSync(apiDst, 'utf8');
    fs.copyFileSync(apiSrc, apiDst);
    // the core patch: skip if already applied
    const check = spawnSync('git', ['apply', '--check', '--reverse', path.join(HERE, 'server-patch', 'core-changes.patch')], { cwd: SRV, stdio: 'ignore', shell: WIN });
    if (check.status !== 0) run('git', ['apply', '--3way', path.join(HERE, 'server-patch', 'core-changes.patch')], { cwd: SRV });
    const players = path.join(SRV, 'Server', 'data', 'players');
    fs.mkdirSync(players, { recursive: true });
    const saves = path.join(HERE, 'saves');
    if (fs.existsSync(saves)) for (const f of fs.readdirSync(saves)) if (!fs.existsSync(path.join(players, f))) fs.copyFileSync(path.join(saves, f), path.join(players, f));
    if (rebuild || apiChanged || !fs.existsSync(JAR)) {
        log('building the server (first time: a few minutes)');
        const mvnw = WIN ? 'mvnw.cmd' : 'sh';
        const mvnArgs = WIN ? ['-q', '-B', 'package', '-DskipTests'] : ['mvnw', '-q', '-B', 'package', '-DskipTests'];
        run(mvnw, mvnArgs, { cwd: path.join(SRV, 'Server'), env });
    }
}

// ---- run ----
const children = [];
function start(name, cmd, cmdArgs, opts, logFile) {
    const out = fs.openSync(logFile, 'a');
    const p = spawn(cmd, cmdArgs, { ...opts, stdio: ['ignore', out, out], shell: false });
    children.push({ name, p });
    p.on('exit', code => log(`${name} exited (${code})`));
    return p;
}
async function waitFor(file, re, seconds) {
    for (let i = 0; i < seconds; i++) {
        if (fs.existsSync(file) && re.test(fs.readFileSync(file, 'utf8'))) return true;
        await new Promise(r => setTimeout(r, 1000));
    }
    return false;
}
function stopAll() {
    for (const { name, p } of children.reverse()) if (p.exitCode == null) { log(`stopping ${name}`); p.kill(WIN ? undefined : 'SIGTERM'); }
    setTimeout(() => process.exit(0), 3000);
}

checkPrereqs();
setup({ rebuild: args.has('--rebuild') });
if (args.has('--setup')) { log('setup done'); process.exit(0); }

const serverLog = path.join(HERE, 'server.log');
fs.writeFileSync(serverLog, '');
// broken player saves (empty or unreadable, e.g. written during a crash) lock that bot out for good: put back the
// newest good copy from a backup, or set the file aside so the bot starts as a new character, and say so
(function repairSaves() {
    const dir = path.join(SRV, 'Server', 'data', 'players');
    const backups = (() => { try { return fs.readdirSync(path.join(HERE, 'backups')).filter(f => f.endsWith('.tar.gz')).sort().reverse(); } catch { return []; } })();
    for (const f of (() => { try { return fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch { return []; } })()) {
        const file = path.join(dir, f);
        try { JSON.parse(fs.readFileSync(file, 'utf8')); continue; } catch {}
        let restored = null;
        for (const b of backups) {
            const r = spawnSync('tar', ['-xzOf', path.join(HERE, 'backups', b), `Server/data/players/${f}`], { maxBuffer: 64 << 20 });
            try { if (r.status === 0 && r.stdout.length) { JSON.parse(r.stdout.toString('utf8')); fs.writeFileSync(file, r.stdout); restored = b; break; } } catch {}
        }
        if (restored) log(`repaired the broken save ${f} from ${restored}`);
        else { fs.renameSync(file, `${file}.broken-${Date.now()}`); log(`the save ${f} was broken with no good copy in the backups: set aside, so ${f.replace(/\.json$/, '')} starts as a new character`); }
    }
})();
// a backup before every launch, so a bad restart or a reset can be undone (bots/backup.mjs; kept 14 days)
spawnSync(process.execPath, [path.join(HERE, 'bots', 'backup.mjs'), 'launch'], { stdio: 'inherit' });
log('starting the server (bot API on 127.0.0.1:8899)');
start('server', JAVA, ['-Dnashorn.args=--no-deprecation-warning', '-jar', JAR], { cwd: path.join(SRV, 'Server'), env }, serverLog);
if (!(await waitFor(serverLog, /started in/, 300))) { stopAll(); die(`server didn't start; see ${serverLog}`); }
log('server is up');

if (!args.has('--server-only')) {
    const bots = path.join(HERE, 'bots');
    fs.mkdirSync(path.join(bots, 'logs'), { recursive: true });
    fs.mkdirSync(path.join(bots, 'market'), { recursive: true }); // runtime state, not in git: a fresh checkout has none
    start('scripted bots', process.execPath, ['scripted.mjs', '10', 'scriptbot'], { cwd: bots }, path.join(bots, 'logs', 'scripted.out'));
    start('Claude-directed bots', process.execPath, ['claude_runner.mjs', '5'], { cwd: bots }, path.join(bots, 'logs', 'claude_runner.out'));
    log('bots started (logs in bots/logs/); `node bots/status.mjs` shows levels');
    if (!args.has('--no-dashboard')) {
        start('dashboard', process.execPath, ['dashboard.mjs'], { cwd: bots }, path.join(bots, 'logs', 'dashboard.out'));
        log(`live dashboard on http://127.0.0.1:${process.env.DASHBOARD_PORT ?? 8090} (--no-dashboard to skip)`);
    }
}
log('running; press Ctrl+C to stop');
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
