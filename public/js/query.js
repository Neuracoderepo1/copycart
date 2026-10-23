/**
 * Typed querySelector helpers that fail loudly if markup and script drift apart.
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {HTMLElement}
 */
export function $(selector, root = document) {
  const node = root.querySelector(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return /** @type {HTMLElement} */ (node);
}

/** @param {string} selector @param {ParentNode} [root] @returns {HTMLElement[]} */
export function $$(selector, root = document) {
  return /** @type {HTMLElement[]} */ ([...root.querySelectorAll(selector)]);
}
