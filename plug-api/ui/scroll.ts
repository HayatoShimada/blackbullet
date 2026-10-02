/**
 * `block: "nearest"` scrolling, confined to one container.
 *
 * scrollIntoView can cross a same-origin iframe boundary and scroll the host
 * editor. Restricting the calculation to one container prevents that.
 */
export function revealInContainer(el: Element, container: Element) {
  const c = container.getBoundingClientRect();
  const e = el.getBoundingClientRect();
  if (e.top < c.top) {
    container.scrollTop += e.top - c.top;
  } else if (e.bottom > c.bottom) {
    // An element taller than the container aligns to its top rather than
    // scrolling past it, same as `block: "nearest"`.
    container.scrollTop += Math.min(e.bottom - c.bottom, e.top - c.top);
  }
}

/**
 * `revealInContainer`, with the container found by walking up from `el` via
 * `closest(selector)` -- for a caller that doesn't already hold a reference
 * to the scroll container.
 */
export function revealInClosest(
  el: Element | null | undefined,
  selector: string,
) {
  const container = el?.closest(selector);
  if (el && container) revealInContainer(el, container);
}
