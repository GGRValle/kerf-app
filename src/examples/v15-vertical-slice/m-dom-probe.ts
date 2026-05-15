/// <reference lib="DOM" />
/**
 * DOM-side mobile validation probe for V1.5 surfaces (dev harness only).
 * Reports horizontal overflow, undersized touch targets, and document scrollLeft.
 */

export const MOBILE_PROBE_QUERY_PARAM = 'kerf_m_probe';
export const MOBILE_PROBE_MESSAGE_TYPE = 'kerf-v15-mobile-dom-probe';

export const MOBILE_VALIDATION_ROUTES = [
  '/dashboard',
  '/field-capture',
  '/transcript-review',
  '/draft-review',
] as const;

export type MobileValidationRoute = (typeof MOBILE_VALIDATION_ROUTES)[number];

export type HorizontalOverflowFinding = {
  descriptor: string;
  scrollWidth: number;
  clientWidth: number;
};

export type SmallTouchTargetFinding = {
  descriptor: string;
  width: number;
  height: number;
};

export type MobileDomProbePayload = {
  type: typeof MOBILE_PROBE_MESSAGE_TYPE;
  route: string;
  viewportWidth: number;
  documentScrollLeft: number;
  maxDocumentScrollLeft: number;
  horizontalOverflow: HorizontalOverflowFinding[];
  smallTouchTargets: SmallTouchTargetFinding[];
};

const TOUCH_TARGET_MIN_PX = 44;
const INTERACTIVE_SELECTOR =
  'button, a[href], input[type="button"], input[type="submit"], input[type="reset"], [role="button"]';

export function isMobileProbeEnabled(search: string): boolean {
  return new URLSearchParams(search).get(MOBILE_PROBE_QUERY_PARAM) === '1';
}

export function auditHorizontalOverflow(
  candidates: readonly HorizontalOverflowFinding[],
): HorizontalOverflowFinding[] {
  return candidates.filter((c) => c.scrollWidth > c.clientWidth);
}

export function auditSmallTouchTargets(
  candidates: readonly SmallTouchTargetFinding[],
): SmallTouchTargetFinding[] {
  return candidates.filter(
    (c) => c.width < TOUCH_TARGET_MIN_PX || c.height < TOUCH_TARGET_MIN_PX,
  );
}

function elementDescriptor(el: Element): string {
  const id = el.id ? `#${el.id}` : '';
  const classes =
    el.classList.length > 0
      ? `.${Array.from(el.classList).slice(0, 3).join('.')}`
      : '';
  return `${el.tagName.toLowerCase()}${id}${classes}`;
}

export function collectMobileDomProbe(document: Document, route: string): MobileDomProbePayload {
  const horizontalOverflow: HorizontalOverflowFinding[] = [];
  const seenOverflow = new Set<Element>();

  const all = document.querySelectorAll('*');
  for (const el of all) {
    if (!(el instanceof HTMLElement)) {
      continue;
    }
    if (el.scrollWidth <= el.clientWidth) {
      continue;
    }
    if (seenOverflow.has(el)) {
      continue;
    }
    seenOverflow.add(el);
    horizontalOverflow.push({
      descriptor: elementDescriptor(el),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    });
  }

  const smallTouchTargets: SmallTouchTargetFinding[] = [];
  const interactives = document.querySelectorAll(INTERACTIVE_SELECTOR);
  for (const el of interactives) {
    if (!(el instanceof HTMLElement)) {
      continue;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      continue;
    }
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width >= TOUCH_TARGET_MIN_PX && height >= TOUCH_TARGET_MIN_PX) {
      continue;
    }
    smallTouchTargets.push({
      descriptor: elementDescriptor(el),
      width,
      height,
    });
  }

  const docEl = document.documentElement;
  const documentScrollLeft = docEl.scrollLeft;
  const maxDocumentScrollLeft = Math.max(0, docEl.scrollWidth - docEl.clientWidth);

  return {
    type: MOBILE_PROBE_MESSAGE_TYPE,
    route,
    viewportWidth: window.innerWidth,
    documentScrollLeft,
    maxDocumentScrollLeft,
    horizontalOverflow: auditHorizontalOverflow(horizontalOverflow),
    smallTouchTargets: auditSmallTouchTargets(smallTouchTargets),
  };
}

export function postMobileDomProbe(window: Window, payload: MobileDomProbePayload): void {
  if (window.parent === window) {
    return;
  }
  window.parent.postMessage(payload, window.location.origin);
}

let probeScheduleHandle: ReturnType<typeof setTimeout> | null = null;

/** Debounced probe after SPA render settles (harness iframes only). */
export function scheduleMobileDomProbeReport(window: Window, route: string): void {
  if (!isMobileProbeEnabled(window.location.search)) {
    return;
  }
  if (probeScheduleHandle !== null) {
    clearTimeout(probeScheduleHandle);
  }
  probeScheduleHandle = setTimeout(() => {
    probeScheduleHandle = null;
    const payload = collectMobileDomProbe(window.document, route);
    postMobileDomProbe(window, payload);
  }, 350);
}
