// Run the staged in-game tests one after another and write a pass/fail report to bots/tests/last-run.md.
//   node run_tests.mjs            quick set: random events, Grand Exchange, quest party (about 30 minutes)
//   node run_tests.mjs all        everything: + team stash, social mechanics, market day, escort, duel (about 2 hours)
//   node run_tests.mjs ge events  just the named ones
// Needs the server running (the fleet can keep running: the tests use their own bots). Each test's own output
// is saved next to the report. Run it after any server or bot-API change.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(ROOT, 'tests');
fs.mkdirSync(OUT, { recursive: true });
const env = { ...process.env, BOT_EVENTS: 'none' }; // test bots only get the events a test forces

// name -> steps (argv lists) and how to read the result from the output
const TESTS = {
    events: {
        steps: [['test_events.mjs', 'testbot', 'GENIE', 'DRUNKEN_DWARF', 'RICK_TURPENTINE', 'STRANGE_PLANT', 'SANDWICH_LADY', 'CERTER', 'EVIL_CHICKEN', 'FREAKY_FORESTER', 'MAZE']],
        judge: out => { const r = [...out.matchAll(/^(\w+): (resolved|STILL ACTIVE)/gm)]; return { pass: r.length > 0 && r.every(m => m[2] === 'resolved'), detail: r.map(m => `${m[1]} ${m[2]}`).join(', ') }; }
    },
    ge: { steps: [['test_ge.mjs', 'setup'], ['test_ge.mjs', 'run']], judge: out => ({ pass: /seller COMPLETED 10\/10.*buyer COMPLETED 10\/10/.test(out) && /collected: seller [1-9], buyer [1-9]/.test(out), detail: (out.match(/^collected:.*$/m) ?? ['no result'])[0] + '; ' + ((out.match(/seller COMPLETED[^|]*\| buyer COMPLETED \S+/) ?? ['offers did not fill'])[0]).slice(0, 120) }) },
    stash: { steps: [['test_stash.mjs', 'setup'], ['test_stash.mjs', 'run']], judge: judgeChecks },
    party: { steps: [['test_party.mjs']], judge: judgeChecks },
    social: { steps: [['test_social.mjs', 'setup'], ['test_social.mjs', 'run']], judge: judgeChecks },
    marketday: { steps: [['test_marketday.mjs', 'setup'], ['test_marketday.mjs', 'run']], judge: judgeChecks },
    escort: { steps: [['test_escort.mjs', 'setup'], ['test_escort.mjs', 'run']], judge: judgeChecks },
    duel: { steps: [['test_duel.mjs', 'setup'], ['test_duel.mjs', 'run']], judge: out => ({ pass: /RESULT winner (?!null)/.test(out) && !/never got into the arena/.test(out), detail: (out.match(/RESULT.*$/m) ?? ['no result'])[0].slice(0, 160) }) }
};
function judgeChecks(out) {
    const lines = out.split('\n').filter(l => /^(PASS|FAIL)\b/.test(l));
    return { pass: lines.length > 0 && lines.every(l => l.startsWith('PASS')), detail: lines.map(l => l.replace(/\s+/g, ' ')).join('; ') };
}

const args = process.argv.slice(2);
const which = args[0] === 'all' ? Object.keys(TESTS) : args.length ? args : ['events', 'ge', 'party'];
const results = [];
for (const name of which) {
    const t = TESTS[name];
    if (!t) { console.log(`unknown test ${name}`); continue; }
    const t0 = Date.now();
    let out = '';
    for (const step of t.steps) {
        console.log(`[tests] ${name}: node ${step.join(' ')}`);
        const r = spawnSync(process.execPath, step, { cwd: ROOT, env, encoding: 'utf8', timeout: 60 * 60_000 });
        out += (r.stdout ?? '') + (r.stderr ?? '');
    }
    fs.writeFileSync(path.join(OUT, `${name}.log`), out);
    const { pass, detail } = t.judge(out);
    results.push({ name, pass, detail, minutes: Math.round((Date.now() - t0) / 60_000) });
    console.log(`[tests] ${name}: ${pass ? 'PASS' : 'FAIL'} (${detail})`);
}
const report = [`# Test run ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, '',
    ...results.map(r => `- **${r.pass ? 'PASS' : 'FAIL'}** \`${r.name}\` (${r.minutes} min): ${r.detail}`), '',
    `${results.filter(r => r.pass).length}/${results.length} passed. Full output: \`bots/tests/<name>.log\`.`].join('\n');
fs.writeFileSync(path.join(OUT, 'last-run.md'), report + '\n');
console.log('\n' + report);
process.exit(results.every(r => r.pass) ? 0 : 1);
