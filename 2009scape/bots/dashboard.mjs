// Live dashboard (roadmap 58): node bots/dashboard.mjs, then open http://127.0.0.1:8090 (DASHBOARD_PORT to change).
// One page that refreshes itself every 30 s: every bot on a map of the free-to-play world with its team colour, a table
// (team, career, combat, total level, task, where), total levels over time, and the economy (coins in circulation,
// median wealth, Gini). Reads logs/progress.jsonl, market/*.json(l) and the bot API's /bots; writes nothing.
import http from 'http';
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.env.DASHBOARD_PORT ?? 8090);
const API = process.env.BOT_API ?? 'http://127.0.0.1:8899';
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8')); } catch { return d; } };
const readLines = f => { try { return fs.readFileSync(path.join(HERE, f), 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

async function data() {
    const progress = readLines('logs/progress.jsonl');
    const latest = {};
    for (const r of progress) latest[r.bot] = r;
    const teams = readJson('market/teams.json', { teams: {} }).teams;
    const careers = readJson('market/careers.json', {});
    const teamOf = n => Object.entries(teams).find(([, t]) => t.members.includes(n))?.[0] ?? 'individual';
    const online = new Set((await fetch(`${API}/bots`).then(r => r.json()).catch(() => [])).filter(b => b.online).map(b => b.name));
    const bots = Object.values(latest).map(r => ({ name: r.bot, team: teamOf(r.bot), career: careers[r.bot]?.career ?? '', combat: r.combat, total: r.total, task: r.task, x: r.x, y: r.y, online: online.has(r.bot), seen: r.t }))
        .sort((a, b) => b.total - a.total);
    // total level over time: the average across bots seen in each hour
    const hours = {};
    for (const r of progress) { const h = Math.floor(r.t / 3600_000); (hours[h] ??= {})[r.bot] = r.total; }
    const levels = Object.entries(hours).map(([h, m]) => ({ t: Number(h) * 3600_000, avg: Object.values(m).reduce((a, b) => a + b, 0) / Object.values(m).length, sum: Object.values(m).reduce((a, b) => a + b, 0) }));
    const economy = readLines('market/economy.jsonl').map(e => ({ t: Date.parse(e.t), coins: e.coins, median: e.medianWealth, gini: e.gini }));
    return { at: Date.now(), bots, levels, economy, teams: Object.keys(teams) };
}

const PAGE = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rune Bots Live</title>
<style>
:root{--bg:#eef1ec;--panel:#fbfcf9;--ink:#1f2a24;--muted:#5b6a61;--rule:#d5ddd6;--land:#dfe8d6;--water:#cfe0ea;--accent:#2f5d46}
@media (prefers-color-scheme:dark){:root{--bg:#141a17;--panel:#1b231f;--ink:#e4ebe6;--muted:#9db0a4;--rule:#2e3a33;--land:#22302a;--water:#1e2c35;--accent:#7fc29f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,sans-serif;padding:16px}
h1{font-size:20px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 14px}
.grid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:14px}@media(max-width:900px){.grid{grid-template-columns:minmax(0,1fr)}}
.panel{background:var(--panel);border:1px solid var(--rule);border-radius:6px;padding:12px;min-width:0}
h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;margin:0 0 8px;color:var(--muted)}
canvas{width:100%;height:auto;display:block;background:var(--land);border-radius:4px}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:13px}th,td{text-align:left;padding:3px 6px;border-bottom:1px solid var(--rule);white-space:nowrap}
th{color:var(--muted);font-weight:600}.tablewrap{max-height:520px;overflow:auto}.off{opacity:.45}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}
svg{width:100%;height:160px;display:block}.legend{display:flex;flex-wrap:wrap;gap:4px 12px;color:var(--muted);font-size:12px;margin-top:6px}
</style></head><body>
<h1>Rune Bots Live</h1><p class="sub" id="sub">Loading…</p>
<div class="grid">
 <div class="panel"><h2>Where the bots are</h2><canvas id="map" width="900" height="760"></canvas><div class="legend" id="legend"></div></div>
 <div class="panel"><h2>Bots</h2><div class="tablewrap"><table id="tbl"></table></div></div>
 <div class="panel"><h2>Average total level</h2><svg id="lv"></svg></div>
 <div class="panel"><h2>Coins in circulation</h2><svg id="coins"></svg><div class="legend" id="eco"></div></div>
</div>
<script>
const PLACES=[['Lumbridge',3222,3218],['Varrock',3212,3424],['Falador',2964,3378],['Draynor',3093,3244],['Al Kharid',3293,3175],['Port Sarim',3015,3220],['Barbarian Village',3082,3420],['Edgeville',3094,3491],['Rimmington',2957,3214],['Goblin Village',2956,3505],["Wizards' Tower",3109,3162],['Draynor Manor',3109,3353],['Grand Exchange',3165,3487]];
const X0=2880,X1=3330,Y0=3120,Y1=3560;
const COLORS=['#2f7d5b','#c4572f','#3a6fb0','#a05aa8','#b08a1e','#2a9a9a','#8a5a3a','#5a6b2f'];
const teamColor=(t,teams)=>t==='individual'?'#7a7a7a':COLORS[teams.indexOf(t)%COLORS.length];
function drawMap(d){const c=document.getElementById('map'),g=c.getContext('2d'),W=c.width,H=c.height,css=getComputedStyle(document.documentElement);
 const px=x=>(x-X0)/(X1-X0)*W,py=y=>H-(y-Y0)/(Y1-Y0)*H;g.clearRect(0,0,W,H);
 g.fillStyle=css.getPropertyValue('--water');g.fillRect(px(3245),py(3330),px(3262)-px(3245),py(3150)-py(3330)); // the River Lum, roughly
 g.strokeStyle=css.getPropertyValue('--rule');for(let x=2900;x<X1;x+=50){g.beginPath();g.moveTo(px(x),0);g.lineTo(px(x),H);g.stroke();}for(let y=3150;y<Y1;y+=50){g.beginPath();g.moveTo(0,py(y));g.lineTo(W,py(y));g.stroke();}
 g.font='12px system-ui';g.fillStyle=css.getPropertyValue('--muted');for(const[n,x,y]of PLACES){g.fillText(n,px(x)-g.measureText(n).width/2,py(y)-10);g.fillRect(px(x)-1.5,py(y)-1.5,3,3);}
 for(const b of d.bots){if(b.x<X0||b.x>X1||b.y<Y0||b.y>Y1)continue;g.globalAlpha=b.online?1:.3;g.fillStyle=teamColor(b.team,d.teams);g.beginPath();g.arc(px(b.x),py(b.y),5,0,7);g.fill();}
 g.globalAlpha=1;const under=d.bots.filter(b=>b.y>6000||b.x<X0||b.x>X1||b.y<Y0||b.y>Y1).length;
 document.getElementById('legend').innerHTML=[...d.teams,'individual'].map(t=>'<span><span class="dot" style="background:'+teamColor(t,d.teams)+'"></span>'+t+'</span>').join('')+(under?'<span>'+under+' underground or off the map</span>':'');}
function table(d){const ago=t=>{const m=Math.round((Date.now()-t)/60000);return m<60?m+'m':Math.round(m/60)+'h'};
 document.getElementById('tbl').innerHTML='<tr><th>Bot</th><th>Team</th><th>Career</th><th>Cb</th><th>Total</th><th>Task</th><th>Seen</th></tr>'+d.bots.map(b=>'<tr class="'+(b.online?'':'off')+'"><td><span class="dot" style="background:'+teamColor(b.team,d.teams)+'"></span>'+b.name+'</td><td>'+b.team+'</td><td>'+b.career+'</td><td>'+b.combat+'</td><td>'+b.total+'</td><td>'+(b.task??'')+'</td><td>'+ago(b.seen)+'</td></tr>').join('');}
function line(id,pts,key,fmt){const s=document.getElementById(id);if(pts.length<2){s.innerHTML='<text x="8" y="20" fill="currentColor">Not enough data yet</text>';return;}
 const W=600,H=160,P=34,t0=pts[0].t,t1=pts.at(-1).t,vs=pts.map(p=>p[key]),lo=Math.min(...vs),hi=Math.max(...vs)||1,sx=t=>P+(t-t0)/(t1-t0||1)*(W-P-8),sy=v=>H-18-(v-lo)/((hi-lo)||1)*(H-34);
 s.setAttribute('viewBox','0 0 '+W+' '+H);const path=pts.map((p,i)=>(i?'L':'M')+sx(p.t).toFixed(1)+' '+sy(p[key]).toFixed(1)).join(' ');
 s.innerHTML='<path d="'+path+'" fill="none" stroke="var(--accent)" stroke-width="2"/><text x="2" y="'+(sy(hi)+4)+'" font-size="11" fill="var(--muted)">'+fmt(hi)+'</text><text x="2" y="'+(sy(lo)+4)+'" font-size="11" fill="var(--muted)">'+fmt(lo)+'</text><text x="'+P+'" y="'+(H-3)+'" font-size="11" fill="var(--muted)">'+new Date(t0).toLocaleString()+'</text><text x="'+(W-8)+'" y="'+(H-3)+'" font-size="11" text-anchor="end" fill="var(--muted)">'+new Date(t1).toLocaleString()+'</text><circle cx="'+sx(t1)+'" cy="'+sy(pts.at(-1)[key])+'" r="3.5" fill="var(--accent)"/>';}
async function load(){try{const d=await fetch('data.json').then(r=>r.json());
 document.getElementById('sub').textContent=d.bots.filter(b=>b.online).length+' of '+d.bots.length+' bots online · updated '+new Date(d.at).toLocaleTimeString();
 drawMap(d);table(d);line('lv',d.levels,'avg',v=>v.toFixed(0));line('coins',d.economy,'coins',v=>Math.round(v).toLocaleString()+'gp');
 const e=d.economy.at(-1);document.getElementById('eco').innerHTML=e?'<span>median wealth '+Math.round(e.median).toLocaleString()+'gp</span><span>Gini '+e.gini+'</span>':'';}catch(e){document.getElementById('sub').textContent='Waiting for data: '+e.message;}}
load();setInterval(load,30000);
</script></body></html>`;

http.createServer(async (req, res) => {
    if (req.url.startsWith('/data.json')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(await data())); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE);
}).listen(PORT, '127.0.0.1', () => console.log(`dashboard on http://127.0.0.1:${PORT}`));
