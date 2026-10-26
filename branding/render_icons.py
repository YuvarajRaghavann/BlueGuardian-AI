"""
Render every BlueGuardian app icon from branding/logo-source.png.

    python3 branding/render_icons.py

Outputs
  native/android/res/mipmap-*/ic_launcher.png            legacy launcher icon (squircle)
  native/android/res/mipmap-*/ic_launcher_round.png      round launcher icon
  native/android/res/mipmap-*/ic_launcher_foreground.png adaptive icon foreground (white glyph)
  native/android/res/mipmap-*/ic_launcher_background.png adaptive icon background (blue gradient)
  native/android/res/drawable-*/splash_logo.png          launch splash logo
  branding/playstore-icon.png                            512 px Play Store icon (full bleed)
  src/assets/logo-mark.png                               in-app logo
  public/favicon.png                                     browser tab icon

The source is the full logo on a white background. The icon shape is cut out by
flood-filling the white surround, so the logo's own corner curve is preserved.
Needs Pillow and numpy.
"""
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'branding' / 'logo-source.png'
RES = ROOT / 'native' / 'android' / 'res'
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}


def load_square() -> np.ndarray:
    """Return the logo tile as RGBA float array (0..1), transparent outside its shape."""
    rgb = np.asarray(Image.open(SRC).convert('RGB')).astype(np.float32)
    h, w, _ = rgb.shape
    near_white = rgb.min(axis=2) > 200
    outside = np.zeros((h, w), bool)
    queue = deque((y, x) for y in (0, h - 1) for x in range(w))
    queue.extend((y, x) for x in (0, w - 1) for y in range(h))
    while queue:
        y, x = queue.popleft()
        if outside[y, x] or not near_white[y, x]:
            continue
        outside[y, x] = True
        if y > 0: queue.append((y - 1, x))
        if y < h - 1: queue.append((y + 1, x))
        if x > 0: queue.append((y, x - 1))
        if x < w - 1: queue.append((y, x + 1))

    # Soft edge: near the boundary, alpha follows how far the red channel is from white.
    alpha = np.where(outside, 0.0, 1.0)
    edge = np.zeros_like(outside)
    for dy in (-2, -1, 0, 1, 2):
        for dx in (-2, -1, 0, 1, 2):
            edge |= np.roll(np.roll(outside, dy, 0), dx, 1)
    band = edge & ~outside
    alpha[band] = np.clip((255.0 - rgb[..., 0][band]) / 250.0, 0, 1)
    # Un-blend the white background from edge pixels so the edge stays pure blue.
    a = np.maximum(alpha, 1e-3)[..., None]
    rgb_un = np.clip((rgb - (1 - a) * 255.0) / a, 0, 255)
    rgb = np.where(band[..., None], rgb_un, rgb)

    ys, xs = np.where(alpha > 0.02)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    side = max(y1 - y0, x1 - x0)
    tile = np.zeros((side, side, 4), np.float32)
    oy, ox = (side - (y1 - y0)) // 2, (side - (x1 - x0)) // 2
    tile[oy:oy + y1 - y0, ox:ox + x1 - x0, :3] = rgb[y0:y1, x0:x1] / 255.0
    tile[oy:oy + y1 - y0, ox:ox + x1 - x0, 3] = alpha[y0:y1, x0:x1]
    return tile


def to_image(arr: np.ndarray) -> Image.Image:
    return Image.fromarray((np.clip(arr, 0, 1) * 255).round().astype(np.uint8), 'RGBA')


def glyph_layer(tile: np.ndarray) -> np.ndarray:
    """White Bluetooth + shield artwork only (blue removed), for the adaptive foreground."""
    red = tile[..., 0] * 255
    a = np.clip((red - 60.0) / 175.0, 0, 1) * tile[..., 3]
    out = np.ones_like(tile)
    out[..., :3] = np.array([0.97, 0.98, 1.0])
    out[..., 3] = a
    return out


def corner_colors(tile: np.ndarray):
    """Gradient colours sampled just inside the four corners of the tile."""
    s = tile.shape[0]
    pts = {'tl': (0.18, 0.18), 'tr': (0.18, 0.82), 'bl': (0.82, 0.18), 'br': (0.82, 0.82)}
    out = {}
    for k, (fy, fx) in pts.items():
        y, x = int(fy * s), int(fx * s)
        patch = tile[y - 6:y + 6, x - 6:x + 6, :3].reshape(-1, 3)
        out[k] = patch[patch[:, 0] < 0.3].mean(axis=0) if (patch[:, 0] < 0.3).any() else patch.mean(axis=0)
    return out


def gradient(size: int, colors) -> np.ndarray:
    v = np.linspace(0, 1, size)[:, None, None]
    u = np.linspace(0, 1, size)[None, :, None]
    top = colors['tl'] * (1 - u) + colors['tr'] * u
    bottom = colors['bl'] * (1 - u) + colors['br'] * u
    rgb = top * (1 - v) + bottom * v
    return np.concatenate([rgb, np.ones((size, size, 1))], axis=2)


def resize(img: Image.Image, size: int) -> Image.Image:
    return img.resize((size, size), Image.LANCZOS)


def place(canvas: int, img: Image.Image, frac: float) -> Image.Image:
    out = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    s = round(canvas * frac)
    out.alpha_composite(resize(img, s), ((canvas - s) // 2, (canvas - s) // 2))
    return out


def circle_mask(img: Image.Image) -> Image.Image:
    s = img.size[0]
    big = Image.new('L', (s * 4, s * 4), 0)
    ImageDraw.Draw(big).ellipse((0, 0, s * 4 - 1, s * 4 - 1), fill=255)
    mask = big.resize((s, s), Image.LANCZOS)
    out = img.copy()
    out.putalpha(Image.fromarray(np.minimum(np.asarray(img.split()[3]), np.asarray(mask))))
    return out


def main():
    tile = load_square()
    tile_img = to_image(tile)
    glyph_img = to_image(glyph_layer(tile))
    colors = corner_colors(tile)
    hi = 1024
    full_bleed = to_image(gradient(hi, colors))
    full_bleed.alpha_composite(resize(glyph_img, hi))

    for d, f in DENSITIES.items():
        s = round(48 * f)
        (RES / f'mipmap-{d}').mkdir(parents=True, exist_ok=True)
        (RES / f'drawable-{d}').mkdir(parents=True, exist_ok=True)
        place(s, tile_img, 0.94).save(RES / f'mipmap-{d}' / 'ic_launcher.png', optimize=True)
        circle_mask(place(s, full_bleed, 1.0)).save(RES / f'mipmap-{d}' / 'ic_launcher_round.png', optimize=True)
        fg = round(108 * f)
        # Adaptive icons show the centre 72 of 108 dp; keep the artwork inside the 66 dp safe zone.
        place(fg, glyph_img, 66 / 108).save(RES / f'mipmap-{d}' / 'ic_launcher_foreground.png', optimize=True)
        resize(to_image(gradient(hi, colors)), fg).save(RES / f'mipmap-{d}' / 'ic_launcher_background.png', optimize=True)
        sp = round(112 * f)
        place(sp, tile_img, 1.0).save(RES / f'drawable-{d}' / 'splash_logo.png', optimize=True)

    resize(full_bleed, 512).convert('RGB').save(ROOT / 'branding' / 'playstore-icon.png', optimize=True)
    (ROOT / 'src' / 'assets').mkdir(parents=True, exist_ok=True)
    resize(tile_img, 256).save(ROOT / 'src' / 'assets' / 'logo-mark.png', optimize=True)
    resize(tile_img, 64).save(ROOT / 'public' / 'favicon.png', optimize=True)
    print('Icons rendered. Gradient corners:', {k: (v * 255).round().astype(int).tolist() for k, v in colors.items()})


if __name__ == '__main__':
    main()
