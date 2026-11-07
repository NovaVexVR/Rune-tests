// Where each Claude-directed bot is in its plan loop. Runtime progress, kept out of orders/ (which holds
// the plans and personalities, tracked in git) in bots/market/steps.json (gitignored, cleared on a reset).
import fs from 'fs';
import path from 'path';

const FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'market', 'steps.json');
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };

export const getStep = name => read()[name];
export function setStep(name, step) {
    const all = read();
    all[name] = step;
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(all, null, 1));
    fs.renameSync(FILE + '.tmp', FILE); // atomic: the runner and politics both write it
}
