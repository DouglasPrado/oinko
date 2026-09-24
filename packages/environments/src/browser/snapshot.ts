import { BrowserError } from './errors.js';

/**
 * Structured page reading. The in-page code is plain JavaScript kept in
 * strings and turned into functions with `new Function`, so it never depends
 * on transpiler helpers when Playwright serializes it into the page.
 */
interface SnapshotElement {
  ref: string;
  role: string;
  name: string;
  tag: string;
  type?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  sensitive?: boolean;
  href?: string;
}
export interface SnapshotData {
  title: string;
  url: string;
  text: string;
  textLength: number;
  elements: SnapshotElement[];
  fingerprints: string[];
  totalElements: number;
}

const HELPERS = String.raw`
  var SENSITIVE = /pass(word|wd)?|pwd|secret|token|otp|one[-_]?time|cvv|cvc|card[-_]?number|ssn|\bpin\b|api[-_]?key|apikey|auth|credential/i;
  var AUTOCOMPLETE = ['current-password', 'new-password', 'one-time-code', 'cc-number', 'cc-csc', 'cc-exp'];
  var INPUT_ROLES = { checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button', reset: 'button', image: 'button', range: 'slider', search: 'searchbox' };
  var TAG_ROLES = { A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', SUMMARY: 'button', OPTION: 'option' };
  function clean(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
  function roleOf(el) {
    var role = el.getAttribute('role');
    if (role) return role;
    if (el.tagName === 'INPUT') return INPUT_ROLES[(el.type || '').toLowerCase()] || 'textbox';
    if (TAG_ROLES[el.tagName]) return TAG_ROLES[el.tagName];
    return el.isContentEditable ? 'textbox' : 'generic';
  }
  function nameOf(el) {
    var aria = el.getAttribute('aria-label');
    if (clean(aria)) return clean(aria);
    var labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      var joined = labelledby.split(/\s+/).map(function (id) { var t = document.getElementById(id); return t ? t.innerText : ''; }).join(' ');
      if (clean(joined)) return clean(joined);
    }
    if (el.labels && el.labels.length) {
      var labels = clean(Array.prototype.map.call(el.labels, function (l) { return l.innerText; }).join(' '));
      if (labels) return labels;
    }
    if (el.tagName === 'INPUT' && ['submit', 'button', 'reset'].indexOf((el.type || '').toLowerCase()) >= 0) return clean(el.value);
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT') {
      var text = clean(el.innerText || el.textContent);
      if (text) return text;
    }
    return clean(el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('name') || '');
  }
  function sensitive(el) {
    if ((el.type || '').toLowerCase() === 'password') return true;
    var auto = (el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/);
    for (var i = 0; i < auto.length; i++) if (AUTOCOMPLETE.indexOf(auto[i]) >= 0) return true;
    return SENSITIVE.test(el.getAttribute('name') || '') || SENSITIVE.test(el.id || '');
  }
  function fingerprint(el) {
    return [el.tagName, roleOf(el), nameOf(el).slice(0, 80), (el.type || ''), el.id || '', el.getAttribute('name') || ''].join('|');
  }
`;

const SNAPSHOT_BODY = String.raw`
  ${HELPERS}
  var SELECTOR = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[role=textbox],[role=combobox],[role=searchbox],[contenteditable=""],[contenteditable=true],[onclick]';
  function visible(el) {
    var rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    var style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0;
  }
  var all = Array.prototype.filter.call(document.querySelectorAll(SELECTOR), visible);
  var nodes = all.slice(0, options.maxElements);
  var elements = nodes.map(function (el, index) {
    var item = { ref: 'e' + (index + 1), role: roleOf(el), name: nameOf(el).slice(0, 160), tag: el.tagName.toLowerCase() };
    var field = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
    if (field) {
      if (el.type) item.type = String(el.type).toLowerCase();
      var credential = el.getAttribute('data-oinko-credential');
      if (credential) item.value = '[credential ' + credential + ']';
      else if (sensitive(el)) { item.sensitive = true; if (el.value) item.value = '[redacted]'; }
      else if (item.type === 'checkbox' || item.type === 'radio') item.checked = !!el.checked;
      else if (el.value) item.value = String(el.value).slice(0, 200);
      if (el.required) item.required = true;
    }
    if (el.getAttribute('aria-invalid') === 'true' || (field && el.willValidate && el.validity && !el.validity.valid)) item.invalid = true;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') item.disabled = true;
    if (el.tagName === 'A' && el.href) item.href = String(el.href);
    return item;
  });
  var raw = document.body ? document.body.innerText || '' : '';
  var text = raw.replace(/[ \t\f\v]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  return {
    data: {
      title: document.title || '',
      url: location.href,
      text: text.slice(0, options.maxText),
      textLength: text.length,
      elements: elements,
      fingerprints: nodes.map(fingerprint),
      totalElements: all.length
    },
    nodes: nodes
  };
`;

const FINGERPRINT_BODY = String.raw`
  ${HELPERS}
  return { connected: element.isConnected, fingerprint: element.isConnected ? fingerprint(element) : '' };
`;

const FULL_TEXT_BODY = String.raw`
  var raw = document.body ? document.body.innerText || '' : '';
  return raw.replace(/[ \t\f\v]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
`;

type PageFunction<A, R> = (arg: A) => R;
/** `(options) => { data, nodes }`, evaluated with `page.evaluateHandle`. */
export const snapshotScript = new Function('options', SNAPSHOT_BODY) as PageFunction<
  { maxText: number; maxElements: number },
  { data: SnapshotData; nodes: unknown[] }
>;
/** `(element) => { connected, fingerprint }`, evaluated on an element handle. */
export const fingerprintScript = new Function('element', FINGERPRINT_BODY) as PageFunction<
  unknown,
  { connected: boolean; fingerprint: string }
>;
export const fullTextScript = new Function(FULL_TEXT_BODY) as () => string;
/** Marks an element filled with a test credential (name only) so output masks it. */
export const markCredentialScript = new Function(
  'element',
  'name',
  "element.setAttribute('data-oinko-credential', name);",
) as (element: unknown, name: string) => void;

interface BoundSnapshot<H> {
  id: string;
  page: unknown;
  navigation: number;
  handles: H[];
  fingerprints: string[];
}

/**
 * Refs (`e12`) are valid only for the latest snapshot of the same page and
 * document. Anything else is stale: callers must observe again instead of
 * acting on an outdated element or position.
 */
export class RefTable<H> {
  private current?: BoundSnapshot<H>;
  private counter = 0;
  constructor(private readonly release: (handles: H[]) => void = () => {}) {}

  bind(snapshot: Omit<BoundSnapshot<H>, 'id'>): string {
    if (this.current) this.release(this.current.handles);
    const id = `s${++this.counter}`;
    this.current = { ...snapshot, id };
    return id;
  }

  get snapshotId() {
    return this.current?.id;
  }

  lookup(input: { ref: string; snapshotId?: string; page: unknown; navigation: number }): {
    handle: H;
    fingerprint: string;
  } {
    const current = this.current;
    if (!current)
      throw new BrowserError('snapshot_required', 'Faça um snapshot da página antes de agir.');
    const stale = () =>
      new BrowserError(
        'stale_element',
        'A página mudou desde o snapshot. Faça um novo snapshot antes de agir.',
        { snapshotId: current.id },
      );
    if (input.snapshotId && input.snapshotId !== current.id) throw stale();
    if (current.page !== input.page || current.navigation !== input.navigation) throw stale();
    const index = Number(input.ref.slice(1)) - 1;
    const handle = current.handles[index];
    if (!Number.isInteger(index) || index < 0 || handle === undefined)
      throw new BrowserError('invalid_ref', `Referência ${input.ref} não existe no snapshot.`, {
        snapshotId: current.id,
      });
    return { handle, fingerprint: current.fingerprints[index] ?? '' };
  }

  /** Compares the live element with what the snapshot saw. */
  static verify(
    target: { fingerprint: string },
    live: { connected: boolean; fingerprint: string },
  ): void {
    if (!live.connected || live.fingerprint !== target.fingerprint)
      throw new BrowserError(
        'stale_element',
        'O elemento mudou ou saiu da página. Faça um novo snapshot antes de agir.',
      );
  }

  /** Invalidates refs without waiting for the next snapshot. */
  clear() {
    if (this.current) this.release(this.current.handles);
    this.current = undefined;
  }
}
