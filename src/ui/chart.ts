import type { Observation } from '../providers/types';
import { el } from './dom';
import { sameResetCycle } from '../calculations/quota';
export function chart(points: Observation[], days: number, now = Date.now()): HTMLElement {
  const box = el('div', 'chart');
  const ns = 'http://www.w3.org/2000/svg';
  const sorted = points
    .filter((p) => p.timestamp >= now - days * 86400000)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (sorted.length < 2) {
    box.append(el('p', 'muted', 'Not enough history for a graph yet.'));
    return box;
  }
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 340 100');
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    `Reported percentage remaining over the last ${days === 1 ? '24 hours' : `${days} days`}. Gaps and reset cycles are separated.`,
  );
  const start = now - days * 86400000;
  const line = document.createElementNS(ns, 'path');
  let d = '';
  let previous: Observation | undefined;
  for (const p of sorted) {
    const x = 10 + ((p.timestamp - start) / (days * 86400000)) * 320,
      y = 90 - p.remaining * 0.8;
    const gap =
      !previous ||
      !sameResetCycle(previous.resetAt, p.resetAt) ||
      p.timestamp - previous.timestamp > 3600000 ||
      p.account !== previous.account;
    d += `${gap ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;
    previous = p;
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', String(x));
    dot.setAttribute('cy', String(y));
    dot.setAttribute('r', '1.8');
    dot.setAttribute('fill', 'currentColor');
    const title = document.createElementNS(ns, 'title');
    title.textContent = `${new Date(p.timestamp).toLocaleString()}: ${p.remaining.toFixed(1)}% remaining`;
    dot.append(title);
    svg.append(dot);
  }
  line.setAttribute('d', d);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'currentColor');
  line.setAttribute('stroke-width', '2');
  svg.append(line);
  box.append(svg, el('div', 'spread muted', '100% → 0% remaining · hover points for readings'));
  return box;
}
