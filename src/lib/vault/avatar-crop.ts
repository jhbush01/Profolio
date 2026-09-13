/**
 * Choosing which part of an image is kept.
 *
 * THE FRAME IS THE SHAPE IT WILL BE USED AT. That is the whole contract, and
 * breaking it is how a school crest turned into an enormous close-up of two
 * letters: the cropper offered a square, the project card is 16:6, and
 * `object-cover` threw away the top and bottom thirds of what had just been
 * carefully positioned. Callers pass the aspect ratio of the slot the image is
 * going into, and what you line up is exactly what gets saved.
 *
 * ZOOM GOES BELOW 1. A logo, a crest, a diagram — anything that is not a
 * photograph — needs to sit whole inside the frame with space around it, not
 * be cropped into. At zoom 1 the image exactly covers the frame; below that it
 * shrinks inside it and the remainder is filled with the app's own paper
 * colour, so a crest on a wide band looks deliberate rather than abandoned.
 *
 * Drag to move, scroll or drag the slider to zoom. The output is capped and
 * re-encoded here rather than trusted from the file: an image that could be any
 * size is one that can be a 40-megapixel panorama behind a 24px badge.
 */

/** Longest edge of the saved image. Enough for a retina card band, and no more. */
const OUTPUT_LONG_EDGE = 1024;

/** How far in you may zoom. Past this a phone photo turns to porridge. */
const MAX_ZOOM = 5;

/**
 * How far out. Enough to fit a tall logo whole into a wide band with room to
 * spare, and not so far that the image becomes a speck in a field of beige.
 */
const MIN_ZOOM = 0.25;

/** The paper colour, matched to --color-paper so the fill is not a grey box. */
const FILL = '#fbf9f5';

export interface CropOptions {
  /** Width ÷ height of the slot this image is going into. 1 for a square. */
  aspect?: number;
  /** Shown as the dialog's heading. */
  title?: string;
}

interface Session {
  bitmap: ImageBitmap;
  aspect: number;
  /** Multiplier on the scale at which the image exactly covers the frame. */
  zoom: number;
  /** Centre of the visible region, in image pixels. */
  centreX: number;
  centreY: number;
}

/**
 * The source rectangle for a zoom level: at 1 it is the largest rect of the
 * frame's shape that fits inside the image, so the image exactly covers the
 * frame. Bigger than the image means letterboxing, which is the point.
 */
function sourceSize(session: Session): { width: number; height: number } {
  const { bitmap, aspect, zoom } = session;
  const width = Math.min(bitmap.width, bitmap.height * aspect) / zoom;
  return { width, height: width / aspect };
}

/**
 * Opens the cropper on one image and resolves with the square the user chose,
 * or null if they cancelled.
 *
 * Built as a plain <dialog> appended to <body>, like the artefact viewer, so it
 * escapes whatever transformed or clipped ancestor it was opened from.
 */
export async function cropImage(file: File, options: CropOptions = {}): Promise<File | null> {
  const aspect = options.aspect && options.aspect > 0 ? options.aspect : 1;
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
        <h2 class="text-sm font-semibold">${options.title ?? 'Position your picture'}</h2>
      </div>
      <div class="p-5">
        <div data-frame
          style="aspect-ratio:${aspect}"
          class="relative mx-auto w-full max-w-[22rem] cursor-grab touch-none overflow-hidden rounded-md border border-line bg-canvas active:cursor-grabbing">
          <canvas data-canvas class="size-full"></canvas>
        </div>
        <label class="mt-4 flex items-center gap-3">
          <span class="text-xs font-medium">Zoom</span>
          <input data-zoom type="range" min="${MIN_ZOOM * 100}" max="${MAX_ZOOM * 100}" value="100" class="flex-1 accent-accent" />
        </label>
        <p class="prose-body mt-2 text-xs">
          Drag to move it. Zoom out to fit a whole logo or crest inside the frame — what you see
          here is exactly what gets saved.
        </p>
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
    aspect,
    zoom: 1,
    centreX: bitmap.width / 2,
    centreY: bitmap.height / 2,
  };

  /**
   * Keeps the visible rectangle over the image — but only on an axis where the
   * image is actually bigger. Zoomed out past 1 the rectangle is larger than
   * the image on that axis, and the right answer is to centre it rather than
   * shove it against an edge.
   */
  function clamp() {
    const { width, height } = sourceSize(session);
    session.centreX =
      width >= bitmap.width
        ? bitmap.width / 2
        : Math.min(bitmap.width - width / 2, Math.max(width / 2, session.centreX));
    session.centreY =
      height >= bitmap.height
        ? bitmap.height / 2
        : Math.min(bitmap.height - height / 2, Math.max(height / 2, session.centreY));
  }

  function draw() {
    clamp();
    const { width, height } = sourceSize(session);
    const cssWidth = frame.clientWidth || 288;
    // Device pixel ratio, so the preview is not soft on a phone.
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = cssWidth * ratio;
    canvas.height = (cssWidth / aspect) * ratio;

    const context = canvas.getContext('2d');
    if (!context) return;
    // Painted, not cleared: below zoom 1 the image does not fill the frame, and
    // the remainder has to be the colour it will be on the card.
    context.fillStyle = FILL;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      bitmap,
      session.centreX - width / 2,
      session.centreY - height / 2,
      width,
      height,
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
    const perPixel = sourceSize(session).width / (frame.clientWidth || 288);
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
      session.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
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

/** Draws exactly the framed region at the output size and encodes it as JPEG. */
async function render(session: Session): Promise<File | null> {
  const { width, height } = sourceSize(session);

  const canvas = document.createElement('canvas');
  canvas.width = session.aspect >= 1 ? OUTPUT_LONG_EDGE : Math.round(OUTPUT_LONG_EDGE * session.aspect);
  canvas.height = session.aspect >= 1 ? Math.round(OUTPUT_LONG_EDGE / session.aspect) : OUTPUT_LONG_EDGE;
  const context = canvas.getContext('2d');
  if (!context) return null;

  // Same fill as the preview, so what was on screen is what is stored.
  context.fillStyle = FILL;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    session.bitmap,
    session.centreX - width / 2,
    session.centreY - height / 2,
    width,
    height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.88),
  );
  return blob ? new File([blob], 'profile.jpg', { type: 'image/jpeg' }) : null;
}
