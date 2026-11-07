// Disputes and justice (roadmap D17). Each council, the most trusted bot in town (not a party to the case)
// hears every unjudged default. A first offence gets a public warning; a repeat offender (2+ defaults in a week)
// is fined: a court-ordered IOU for the debt plus 50%, due in a day, and its team's treasurer is told. Judges
// earn a little respect from everyone; verdicts go in diaries and in the team history the recap reads.
//   hearCases(market, event)  -> verdicts given
import { note } from './diary.mjs';

const WEEK = 7 * 86400_000;
const FINE = 0.5;

// the most trusted bot (average trust others hold in it, 5+ opinions), online, not in the case
function chooseJudge(market, exclude) {
    const social = market.social, held = {};
    for (const [, row] of Object.entries(social.trustMap)) for (const [b, v] of Object.entries(row ?? {})) (held[b] ??= []).push(v);
    return Object.entries(held)
        .filter(([b, v]) => v.length >= 5 && !exclude.includes(b) && market.bots.get(b)?.bot.s?.online)
        .map(([b, v]) => [b, v.reduce((x, y) => x + y, 0) / v.length])
        .filter(([, t]) => t > 0)
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function hearCases(market, event = market.log, treasurerOf = () => null) {
    const social = market.social, now = Date.now();
    const say = (name, text) => market.bots.get(name)?.bot.act({ type: 'say', text: text.slice(0, 80) }).catch(() => {});
    const verdicts = [];
    // recent defaults only (the last day), a few per council so the court doesn't flood the chat
    for (const iou of social.ious.filter(i => i.status === 'defaulted' && !i.judged && !i.courtOrder && now - (i.settled ?? 0) < 86400_000).slice(0, 3)) {
        const judge = chooseJudge(market, [iou.debtor, iou.creditor]);
        if (!judge) break; // nobody fit to judge right now: the cases wait
        const priors = social.ious.filter(i => i.debtor === iou.debtor && i.status === 'defaulted' && now - (i.settled ?? 0) < WEEK).length;
        let verdict;
        if (priors >= 2) {
            const fine = Math.round(iou.owed * (1 + FINE));
            const order = social.createIou(iou.debtor, iou.creditor, 'Coins', fine / (1 + social.interest(iou.creditor)), 24 * 60);
            order.courtOrder = { judge, case: iou.id };
            order.owed = fine;
            social.saveIous?.();
            verdict = `fined ${fine}gp (payable to ${iou.creditor} within a day)`;
            for (const [other] of market.bots) if (other !== iou.debtor) social.adjustTrust(other, iou.debtor, -0.05);
            const tre = treasurerOf(iou.debtor);
            if (tre && tre !== iou.debtor) market.dm?.(judge, tre, `Your ${iou.debtor} owes ${iou.creditor} ${fine}gp by order. See it paid.`);
            say(judge, `${iou.debtor}: ${priors} defaults this week. Fined ${fine}gp to ${iou.creditor}.`);
        } else {
            verdict = 'warned';
            say(judge, `${iou.debtor} defaulted on ${iou.creditor}. Pay your debts, ${iou.debtor}.`);
        }
        iou.judged = { judge, verdict, t: now };
        // justice done (and seen to be done): a little respect for the judge from both sides and the town
        social.adjustTrust(iou.creditor, judge, 0.05);
        for (const [other] of market.bots) if (other !== judge) social.adjustTrust(other, judge, 0.01);
        note(judge, `Judged ${iou.debtor}'s default on ${iou.creditor}: ${verdict}.`);
        note(iou.debtor, `Judged by ${judge} for defaulting on ${iou.creditor}: ${verdict}.`);
        note(iou.creditor, `${judge} heard my case against ${iou.debtor}: ${verdict}.`);
        event(`COURT: ${judge} judged ${iou.debtor} (default on ${iou.creditor}, ${iou.owed}gp): ${verdict}`);
        verdicts.push({ case: iou.id, judge, debtor: iou.debtor, verdict });
    }
    if (verdicts.length) { social.saveIous?.(); social.save?.(); }
    return verdicts;
}
