export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [
  ...root.querySelectorAll<T>(sel),
];

/** Briefly swap a button label (e.g. "Copied!"), then restore it. */
export function flashLabel(label: HTMLElement, text: string, ms = 1800) {
  const original = label.dataset.label ?? label.textContent ?? '';
  label.dataset.label = original;
  label.textContent = text;
  setTimeout(() => (label.textContent = original), ms);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
