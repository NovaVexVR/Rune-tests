#!/usr/bin/env node
// One launcher for Windows and Linux (CachyOS/Arch etc.): sets up, starts, stops and checks the server + bots.
//
//   node launch.mjs setup     clone 2009Scape next to this repo, apply the bot API patch, build (once)
//   node launch.mjs start     start the server, wait for the bot API, start the bots
//   node launch.mjs stop      stop the bots and the server
//   node launch.mjs status    is everything running? how many bots are online?
//   node launch.mjs restart   stop + start
//
// Needs: git + git-lfs, JDK 11 (set JAVA11_HOME if it isn't the default java), Node.js 22+.
// Options (env): SERVER_DIR (default ../../2009scape-server), SCRIPTED_BOTS (10), CLAUDE_BOTS (5 = all with orders)
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'); // Windows: /C:/... -> C:/...
const SRV = path.resolve(process.env.SERVER_DIR ?? path.join(HERE, '..', '..', '2009scape-server'));
const BOTS = path.join(HERE, 'bots');
const PIDS = path.join(HERE, '.launch-pids.json');
const API = 'http://127.0.0.1:8899';
const WIN = process.platform === 'win32';
const JAVA_HOME = process.env.JAVA11_HOME ?? process.env.JAVA_HOME;
const JAVA = JAVA_HOME ? path.join(JAVA_HOME, 'bin', WIN ? 'java.exe' : 'java') : 'java';
const JAR = path.join(SRV, 'Server', 'target', 'server-1.0.0-jar-with-dependencies.jar');
const RUN_JAR = path.join(SRV, 'Server', 'target', 'server-running.jar');

const log = (...a) => console.log('[launch]', ...a);
const die = msg => { console.error('[launch] ' + msg); process.exit(1); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => {
    const r = spawnSync(cmd, args, { stdio: 'inherit', shell: WIN, ...opts });
    if (r.status !== 0) die(`${cmd} ${args.join(' ')} failed (exit ${r.status})`);
};
const has = (cmd, args = ['--version']) => spawnSync(cmd, args, { stdio: 'ignore', shell: WIN }).status === 0;
const loadPids = () => { try { return JSON.parse(fs.readFileSync(PIDS, 'utf8')); } catch { return {}; } };
const savePids = p => fs.writeFileSync(PIDS, JSON.stringify(p, null, 2));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function api(p) { try { const r = await fetch(API + p); return r.ok ? r.json() : null; } catch { return null; } }

function javaVersion() {
    const r = spawnSync(JAVA, ['-version'], { encoding: 'utf8', shell: WIN });
    const m = `${r.stderr}${r.stdout}`.match(/version "(\d+)(?:\.(\d+))?/);
    return m ? (m[1] === '1' ? Number(m[2]) : Number(m[1])) : null;
}

function checkTools({ build = false } = {}) {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 22) die(`Node.js 22+ needed (this is ${process.versions.node})`);
    const jv = javaVersion();
    if (!jv) die(`no java found (${JAVA}). Install JDK 11 and/or set JAVA11_HOME.`);
    if (jv !== 11) log(`warning: java ${jv} found; the server is built for JDK 11 (set JAVA11_HOME to a JDK 11)`);
    if (build) {
        if (!has('git')) die('git not found');
        if (!has('git', ['lfs', 'version'])) die('git-lfs not found (needed for the game cache)');
    }
}

// Maven Central sometimes answers with a rate-limit page, which Maven then caches as a .pom/.jar: remove those
function cleanMavenCache() {
    const repo = path.join(os.homedir(), '.m2', 'repository');
    if (!fs.existsSync(repo)) return;
    let n = 0;
    const walk = d => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const f = path.join(d, e.name);
            if (e.isDirectory()) walk(f);
            else if (/\.(pom|jar)$/.test(e.name) && fs.statSync(f).size < 4096 && /rate limits|<html/i.test(fs.readFileSync(f, 'utf8'))) { fs.rmSync(path.dirname(f), { recursive: true, force: true }); n++; return; }
        }
    };
    walk(repo);
    if (n) log(`removed ${n} broken Maven cache entries (rate-limit pages)`);
}

function setup() {
    checkTools({ build: true });
    if (!fs.existsSync(SRV)) {
        log(`cloning 2009Scape into ${SRV}`);
        run('git', ['clone', '--depth', '1', 'https://gitlab.com/2009scape/2009scape.git', SRV]);
        run('git', ['lfs', 'install', '--local'], { cwd: SRV });
        run('git', ['lfs', 'pull'], { cwd: SRV });
    }
    log('applying the bot API patch');
    const dest = path.join(SRV, 'Server', 'src', 'main', 'content', 'botapi');
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(path.join(HERE, 'server-patch', 'content', 'botapi', 'BotApi.kt'), path.join(dest, 'BotApi.kt'));
    const applied = spawnSync('git', ['apply', '--check', '--reverse', path.join(HERE, 'server-patch', 'core-changes.patch')], { cwd: SRV, shell: WIN }).status === 0;
    if (!applied) run('git', ['apply', '--3way', path.join(HERE, 'server-patch', 'core-changes.patch')], { cwd: SRV });
    const players = path.join(SRV, 'Server', 'data', 'players');
    fs.mkdirSync(players, { recursive: true });
    for (const f of fs.existsSync(path.join(HERE, 'saves')) ? fs.readdirSync(path.join(HERE, 'saves')) : [])
        if (f.endsWith('.json') && !fs.existsSync(path.join(players, f))) fs.copyFileSync(path.join(HERE, 'saves', f), path.join(players, f));
    log('building the server (first time takes a few minutes)');
    const env = { ...process.env, ...(JAVA_HOME ? { JAVA_HOME } : {}) };
    for (let attempt = 1; attempt <= 3; attempt++) {
        cleanMavenCache();
        const r = spawnSync(WIN ? 'mvnw.cmd' : 'sh', WIN ? ['-q', '-B', 'package', '-DskipTests'] : ['mvnw', '-q', '-B', 'package', '-DskipTests'], { cwd: path.join(SRV, 'Server'), stdio: 'inherit', shell: WIN, env });
        if (r.status === 0) { log('built. Next: node launch.mjs start'); return; }
        log(`build failed (attempt ${attempt}); Maven Central may be rate-limiting, retrying in 30s`);
        spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},30000)']);
    }
    die('build failed 3 times. If the error mentions "Non-parseable POM" or "zip END header", run setup again later.');
}

function startProc(name, cmd, args, cwd, logFile) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const out = fs.openSync(logFile, 'a');
    const p = spawn(cmd, args, { cwd, detached: true, stdio: ['ignore', out, out], windowsHide: true });
    p.unref();
    log(`started ${name} (pid ${p.pid}); log: ${path.relative(HERE, logFile)}`);
    return p.pid;
}

async function start() {
    checkTools();
    if (!fs.existsSync(JAR)) die(`server not built yet: run "node launch.mjs setup" first (looked for ${JAR})`);
    const pids = loadPids();
    if (await api('/bots')) log('server already running');
    else {
        fs.copyFileSync(JAR, RUN_JAR); // a rebuild while it runs can't break the running server
        pids.server = startProc('server', JAVA, ['-Dnashorn.args=--no-deprecation-warning', '-jar', RUN_JAR], path.join(SRV, 'Server'), path.join(HERE, 'server.log'));
        savePids(pids);
        log('waiting for the server (up to 4 minutes)...');
        let up = false;
        for (let i = 0; i < 120 && !up; i++) { await sleep(2000); up = !!(await api('/bots')); if (!alive(pids.server)) die('the server exited during startup; see server.log'); }
        if (!up) die('the bot API did not come up; see server.log');
        log('server is up (bot API on 127.0.0.1:8899)');
    }
    for (const k of ['scripted', 'claude']) if (pids[k] && alive(pids[k])) { log(`${k} bots already running (pid ${pids[k]})`); }
    if (!(pids.scripted && alive(pids.scripted)))
        pids.scripted = startProc('scripted bots', process.execPath, ['scripted.mjs', process.env.SCRIPTED_BOTS ?? '10', 'scriptbot'], BOTS, path.join(BOTS, 'logs', 'scripted.out'));
    if (!(pids.claude && alive(pids.claude)))
        pids.claude = startProc('claude-directed bots', process.execPath, ['claude_runner.mjs', process.env.CLAUDE_BOTS ?? '5'], BOTS, path.join(BOTS, 'logs', 'claude_runner.out'));
    savePids(pids);
    log('bots are logging in; check with: node launch.mjs status');
}

function kill(pid) {
    if (!pid || !alive(pid)) return false;
    if (WIN) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else { try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch {} } }
    return true;
}

async function stop() {
    const pids = loadPids();
    for (const k of ['claude', 'scripted', 'server']) if (kill(pids[k])) log(`stopped ${k} (pid ${pids[k]})`);
    savePids({});
    for (let i = 0; i < 15 && (await api('/bots')); i++) await sleep(1000);
    log((await api('/bots')) ? 'server still answering (started outside the launcher?)' : 'stopped');
}

async function status() {
    const pids = loadPids();
    for (const k of ['server', 'scripted', 'claude']) log(`${k.padEnd(8)} ${pids[k] && alive(pids[k]) ? `running (pid ${pids[k]})` : 'not running (from this launcher)'}`);
    const bots = await api('/bots');
    if (!bots) return log('bot API: not answering');
    log(`bot API: up; ${bots.filter(b => b.online).length}/${bots.length} bots online`);
}

const cmd = process.argv[2] ?? 'status';
const cmds = { setup, start, stop, status, restart: async () => { await stop(); await start(); } };
if (!cmds[cmd]) die(`unknown command "${cmd}" (use: setup, start, stop, status, restart)`);
await cmds[cmd]();
