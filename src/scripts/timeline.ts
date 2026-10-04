// Month strip above the list: one bar per month, height = meetings starting that month.
// The faint bar is every upcoming meeting; the solid bar is those matching the other filters.
// Click a month to filter by it, drag (or shift-click) to pick a range, click it again to clear.

export type MonthRange = { from: string; to: string } | null;

const monthName = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthShort = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' });
const monthShortYear = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const toDate = (m: string) => Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1);

/** Every YYYY-MM from `first` to `last`, inclusive. */
export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let y = Number(first.slice(0, 4));
  let m = Number(first.slice(5, 7));
  for (let guard = 0; guard < 240; guard++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key >= last) break;
    m = m === 12 ? 1 : m + 1;
    if (m === 1) y++;
  }
  return out;
}

export function rangeLabel(r: MonthRange): string {
  if (!r) return 'Any month';
  if (r.from === r.to) return monthName.format(toDate(r.from));
  return `${monthShortYear.format(toDate(r.from))} – ${monthShortYear.format(toDate(r.to))}`;
}

export function createTimeline(root: HTMLElement, months: string[], onChange: (r: MonthRange) => void) {
  const bars = root.querySelector<HTMLElement>('[data-tl-bars]')!;
  const label = root.querySelector<HTMLElement>('[data-tl-label]')!;
  const clear = root.querySelector<HTMLButtonElement>('[data-tl-clear]')!;
  let range: MonthRange = null;

  const buttons = months.map((m, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tl-bar';
    b.dataset.month = m;
    b.setAttribute('aria-pressed', 'false');
    const isJan = m.endsWith('-01');
    b.innerHTML = `<span class="tl-n"></span><span class="tl-track"><span class="tl-total"></span><span class="tl-fill"></span></span>
      <span class="tl-m">${monthShort.format(toDate(m))}</span>
      <span class="tl-y">${i === 0 || isJan ? m.slice(0, 4) : ''}</span>`;
    if (isJan && i > 0) b.classList.add('tl-jan');
    bars.append(b);
    return b;
  });

  function render() {
    for (const b of buttons) {
      const m = b.dataset.month!;
      const on = !!range && m >= range.from && m <= range.to;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('is-edge', !!range && (m === range.from || m === range.to));
    }
    bars.classList.toggle('has-range', !!range);
    label.textContent = rangeLabel(range);
    label.hidden = !!range;
    clear.hidden = !range;
    clear.lastChild!.textContent = ` ${rangeLabel(range)}`;
  }

  function set(next: MonthRange, notify = true) {
    range = next;
    render();
    if (notify) onChange(range);
  }

  // Drag across bars to select a range (live), without pointer capture so `click` still lands
  // on the bar for plain clicks.
  let anchor: number | null = null;
  let dragged = false;
  let swallowClick = false;
  const indexAt = (x: number) => {
    for (let i = 0; i < buttons.length; i++) {
      const r = buttons[i].getBoundingClientRect();
      if (x < r.right) return i;
    }
    return buttons.length - 1;
  };
  bars.addEventListener('pointerdown', (e) => {
    const bar = (e.target as HTMLElement).closest<HTMLElement>('.tl-bar');
    if (!bar || e.button !== 0) return;
    anchor = buttons.indexOf(bar as HTMLButtonElement);
    dragged = false;
    swallowClick = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (anchor === null || !(e.buttons & 1)) return;
    const i = indexAt(e.clientX);
    if (i === anchor && !dragged) return;
    dragged = true;
    const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
    const next = { from: months[a], to: months[b] };
    if (!range || range.from !== next.from || range.to !== next.to) set(next);
  });
  window.addEventListener('pointerup', () => {
    if (anchor !== null && dragged) swallowClick = true;
    anchor = null;
  });

  bars.addEventListener('click', (e) => {
    const bar = (e.target as HTMLElement).closest<HTMLButtonElement>('.tl-bar');
    if (swallowClick || !bar) {
      swallowClick = false;
      return;
    }
    const m = bar.dataset.month!;
    if (e.shiftKey && range) {
      set({ from: m < range.from ? m : range.from, to: m > range.to ? m : range.to });
    } else if (range && range.from === m && range.to === m) {
      set(null);
    } else {
      set({ from: m, to: m });
    }
  });

  // Arrow keys move between months.
  bars.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))].focus();
  });

  clear.addEventListener('click', () => set(null));

  return {
    /** counts: matching meetings per month; totals: all upcoming meetings per month. */
    update(counts: Map<string, number>, totals: Map<string, number>) {
      const max = Math.max(1, ...totals.values());
      for (const b of buttons) {
        const m = b.dataset.month!;
        const n = counts.get(m) ?? 0;
        const total = totals.get(m) ?? 0;
        b.style.setProperty('--fill', String(n / max));
        b.style.setProperty('--total', String(total / max));
        b.querySelector('.tl-n')!.textContent = n ? String(n) : '';
        b.classList.toggle('is-empty', n === 0);
        b.setAttribute(
          'aria-label',
          `${monthName.format(toDate(m))}: ${n} ${n === 1 ? 'meeting' : 'meetings'}${n !== total ? ` of ${total}` : ''}`,
        );
      }
    },
    set: (r: MonthRange) => set(r, false),
    get: () => range,
  };
}
