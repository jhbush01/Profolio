/**
 * Opening and closing the capture overlay.
 *
 * Separate from capture-ui.ts, which is the controller for what is inside it.
 * This is only about the sheet: showing it, hiding it, keeping the browser's
 * back button honest, and not loading the controller until somebody actually
 * captures something.
 *
 * The lazy load matters. Capture pulls in the de-identification scanner, the
 * standards list and the dimension vocabularies; that is a cost worth paying
 * when you press Capture and not worth paying on every page of the app just in
 * case you do.
 */

/** Marks the overlay open, so the back gesture has something to pop. */
const HISTORY_MARK = 'profolio:capture';

let started = false;

function overlay(): HTMLElement | null {
  return document.getElementById('capture-overlay');
}

export function isCaptureOpen(): boolean {
  return overlay()?.classList.contains('hidden') === false;
}

export async function openCapture(options: { replace?: boolean } = {}): Promise<void> {
  const host = overlay();
  if (!host || isCaptureOpen()) return;

  host.classList.remove('hidden');
  // The page behind must not scroll under the sheet; a phone will happily
  // scroll the document while you are halfway through a form on top of it.
  document.body.style.overflow = 'hidden';

  /*
   * A history entry, so back closes the sheet instead of leaving the app.
   *
   * `replace` is for the case where we arrived at /capture directly: there is
   * no page behind to go back to, so the entry is swapped for Home and back
   * takes you out of the app the way it would from any first page.
   */
  const url = options.replace ? '/' : window.location.href;
  if (options.replace) window.history.replaceState({ [HISTORY_MARK]: true }, '', url);
  else window.history.pushState({ [HISTORY_MARK]: true }, '', url);

  if (!started) {
    started = true;
    const { initCapture } = await import('./capture-ui');
    await initCapture();
  }

  document.getElementById('capture-close')?.focus();
}

/**
 * Closes the sheet.
 *
 * `fromHistory` distinguishes the back gesture — where the entry is already
 * gone — from the Done button, which has to pop it. Without that the button
 * would leave a dead entry behind and the next back press would do nothing.
 */
export function closeCapture(fromHistory = false): void {
  const host = overlay();
  if (!host || !isCaptureOpen()) return;

  host.classList.add('hidden');
  document.body.style.overflow = '';

  if (!fromHistory && window.history.state?.[HISTORY_MARK]) window.history.back();
}

export function wireCaptureOverlay(): void {
  document.getElementById('capture-close')?.addEventListener('click', () => closeCapture());

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isCaptureOpen()) closeCapture();
  });

  window.addEventListener('popstate', () => {
    if (isCaptureOpen()) closeCapture(true);
  });
}
