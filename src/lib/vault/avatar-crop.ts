/**
 * Choosing which part of a photograph becomes the profile picture.
 *
 * Before this, the whole image was scaled to fit 512px square and sent, so a
 * landscape photo of a person became a wide strip of classroom with a head in
 * the middle of it — and there was nothing to do about it but crop the file
 * somewhere else first.
 *
 * Drag to move, pinch or scroll or drag the slider to zoom. The square you can
 * see is the square that gets saved: the canvas draws exactly the visible
 * region at a fixed output size, so what someone lines up is what appears in
 * the corner of every page.
 *
 * The output is deliberately capped and re-encoded here rather than trusted
 * from the file. A profile picture that could be any size is a profile picture
 * that can be a 40-megapixel panorama sitting behind a 24px badge on every page
 * of the app.
 */

/** Edge of the saved square. Enough for a retina 96px avatar and no more. */
const OUTPUT_EDGE = 512;

/** How far in you may zoom. Past this a phone photo turns to porridge. */
const MAX_ZOOM = 5;

export interface CropResult {
  file: File;
}

interface Session {
  bitmap: ImageBitmap;
  /** Multiplier on the scale at which the image exactly covers the frame. */
  zoom: number;
  /** Centre of the visible region, in image pixels. */
  centreX: number;
  centreY: number;
}

/**
 * Opens the cropper on one image and resolves with the square the user chose,
 * or null if they cancelled.
 *
 * Built as a plain <dialog> appended to <body>, like the artefact viewer, so it
 * escapes whatever transformed or clipped ancestor it was opened from.
 */
export async function cropToSquare(file: File): Promise<File | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // An image this browser cannot decode still deserves to be uploadable; the
    // server enforces type and size, so the worst case is a clear rejection.
    return file;
  }

  const dialog = document.createElement('dialog');
  dialog.className =
    'm-auto w-[min(28rem,92vw)] max-w-none rounded-lg border border-line bg-surface p-0 text-ink ' +
    'backdrop:bg-ink/60 backdrop:backdrop-blur-[1px]';
  dialog.innerHTML = `
    <form method="dialog" class="contents">
      <div class="border-b border-line px-5 py-3">
        <h2 class="text-sm font-semibold">Position your picture</h2>
      </div>
      <div class="p-5">
        <div data-frame
          class="relative mx-auto aspect-square w-full max-w-[18rem] cursor-grab touch-none overflow-hidden rounded-md bg-canvas active:cursor-grabbing">
          <canvas data-canvas class="size-full"></canvas>
        </div>
        <label class="mt-4 flex items-center gap-3">
          <span class="text-xs font-medium">Zoom</span>
          <input data-zoom type="range" min="100" max="${MAX_ZOOM * 100}" value="100" class="flex-1 accent-accent" />
        </label>
        <p class="prose-body mt-2 text-xs">Drag the picture to choose what shows.</p>
      </div>
      <div class="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button value="cancel" class="rounded-md px-3 py-1.5 text-sm font-medium text-ink-muted transition hover:text-ink">Cancel</button>
        <button value="save" class="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90">Use this</button>
      </div>
    </form>`;
  document.body.appendChild(dialog);

  const frame = dialog.querySelector<HTMLElement>('[data-frame]')!;
  const canvas = dialog.querySelector<HTMLCanvasElement>('[data-canvas]')!;
  const zoomInput = dialog.querySelector<HTMLInputElement>('[data-zoom]')!;

  const session: Session = {
    bitmap,
    zoom: 1,
    centreX: bitmap.width / 2,
    centreY: bitmap.height / 2,
  };

  /** Image pixels per frame pixel at the current zoom, before clamping. */
  const sourceEdge = () => Math.min(bitmap.width, bitmap.height) / session.zoom;

  /** Keeps the visible square inside the image, so no edge of blank ever shows. */
  function clamp() {
    const half = sourceEdge() / 2;
    session.centreX = Math.min(bitmap.width - half, Math.max(half, session.centreX));
    session.centreY = Math.min(bitmap.height - half, Math.max(half, session.centreY));
  }

  function draw() {
    clamp();
    const edge = sourceEdge();
    const size = frame.clientWidth || 288;
    // Device pixel ratio, so the preview is not soft on a phone.
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = size * ratio;
    canvas.height = size * ratio;

    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      bitmap,
      session.centreX - edge / 2,
      session.centreY - edge / 2,
      edge,
      edge,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }

  zoomInput.addEventListener('input', () => {
    session.zoom = Number(zoomInput.value) / 100;
    draw();
  });

  // Pointer events rather than mouse and touch separately: one path covers a
  // trackpad, a finger and a stylus, and pointer capture means a drag that
  // leaves the frame keeps working instead of sticking halfway.
  let dragging: number | null = null;
  let lastX = 0;
  let lastY = 0;

  frame.addEventListener('pointerdown', (event) => {
    dragging = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    frame.setPointerCapture(event.pointerId);
  });

  frame.addEventListener('pointermove', (event) => {
    if (dragging !== event.pointerId) return;
    // A frame pixel is worth this many image pixels, so dragging tracks the
    // cursor exactly rather than drifting at high zoom.
    const perPixel = sourceEdge() / (frame.clientWidth || 288);
    session.centreX -= (event.clientX - lastX) * perPixel;
    session.centreY -= (event.clientY - lastY) * perPixel;
    lastX = event.clientX;
    lastY = event.clientY;
    draw();
  });

  const endDrag = (event: PointerEvent) => {
    if (dragging === event.pointerId) dragging = null;
  };
  frame.addEventListener('pointerup', endDrag);
  frame.addEventListener('pointercancel', endDrag);

  frame.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const next = session.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1);
      session.zoom = Math.min(MAX_ZOOM, Math.max(1, next));
      zoomInput.value = String(Math.round(session.zoom * 100));
      draw();
    },
    { passive: false },
  );

  dialog.showModal();
  draw();
  // Once more after layout settles, since clientWidth is 0 until it does.
  requestAnimationFrame(draw);

  const choice = await new Promise<string>((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true });
  });

  let out: File | null = null;
  if (choice === 'save') out = await render(session);

  bitmap.close();
  dialog.remove();
  return out;
}

/** Draws the chosen square at the output size and encodes it as JPEG. */
async function render(session: Session): Promise<File | null> {
  const edge = Math.min(session.bitmap.width, session.bitmap.height) / session.zoom;

  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_EDGE;
  canvas.height = OUTPUT_EDGE;
  const context = canvas.getContext('2d');
  if (!context) return null;

  context.drawImage(
    session.bitmap,
    session.centreX - edge / 2,
    session.centreY - edge / 2,
    edge,
    edge,
    0,
    0,
    OUTPUT_EDGE,
    OUTPUT_EDGE,
  );

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.88),
  );
  return blob ? new File([blob], 'profile.jpg', { type: 'image/jpeg' }) : null;
}
