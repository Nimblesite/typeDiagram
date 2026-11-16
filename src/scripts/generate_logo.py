"""Generate the typeDiagram logo / VS Code marketplace icons.

Embodies the "Architectural Blueprint" design system:
  - Deep void background (#0b1326)
  - Split-pane bilateral logic (left = code, right = diagram)
  - Tonal layering instead of borders
  - Three semantic accent bars: primary / secondary / tertiary
  - Sharp, "engineered" geometry

Outputs:
  src/vscode/icons/icon.png   (normal, 512x512, full background)
  src/vscode/icons/icon-flat.png (flat, 512x512, transparent background)
"""

from __future__ import annotations

from pathlib import Path
from typing import Sequence

from PIL import Image, ImageDraw, ImageFilter  # type: ignore[import-untyped]

RGBA = tuple[int, int, int, int]
Box = tuple[int, int, int, int]
LineSpec = tuple[float, RGBA]

# ---- Palette (from DESIGN_SYSTEM.md) ----
BG_VOID = (11, 19, 38, 255)            # surface_dim   #0b1326
SURFACE_LOW = (19, 27, 46, 255)        # surface_container_low #131b2e
SURFACE_HIGH = (34, 42, 61, 255)       # surface_container_high #222a3d
SURFACE_BRIGHT = (49, 57, 77, 255)     # surface_bright #31394d
GUTTER = (6, 11, 22, 255)              # surface_container_lowest (deeper than void)

PRIMARY = (142, 213, 255, 255)         # type     #8ed5ff
SECONDARY = (221, 183, 255, 255)       # union    #ddb7ff
TERTIARY = (69, 227, 206, 255)         # alias    #45e3ce

ON_SURFACE = (210, 220, 240, 255)
DIM_TEXT = (110, 125, 155, 255)

SIZE = 512


def rounded_rect(
    draw: ImageDraw.ImageDraw,
    xy: Box,
    radius: int,
    fill: RGBA,
) -> None:
    draw.rounded_rectangle(xy, radius=radius, fill=fill)


def draw_node_card(
    img: Image.Image,
    x: int,
    y: int,
    w: int,
    h: int,
    accent: RGBA,
    lines: Sequence[LineSpec],
) -> None:
    """Draw a Node Card: surface_container_high + 4px left accent + monospace lines."""
    card = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    cd = ImageDraw.Draw(card)
    # Card surface (sm radius ~ 4px at 512)
    cd.rounded_rectangle((0, 0, w, h), radius=4, fill=SURFACE_HIGH)
    # 4px-equivalent accent bar (scaled)
    bar_w = max(6, int(w * 0.035))
    cd.rectangle((0, 0, bar_w, h), fill=accent)

    # Monospace-style "lines" — drawn as small bars to read at icon size
    pad_x = bar_w + int(w * 0.10)
    pad_y = int(h * 0.18)
    line_h = max(4, int(h * 0.07))
    gap = max(6, int(h * 0.10))
    for i, (length_pct, color) in enumerate(lines):
        ly = pad_y + i * (line_h + gap)
        if ly + line_h > h - pad_y:
            break
        lx2 = pad_x + int((w - pad_x - int(w * 0.10)) * length_pct)
        cd.rounded_rectangle(
            (pad_x, ly, lx2, ly + line_h),
            radius=line_h // 2,
            fill=color,
        )

    # Ambient lift: ultra-diffused shadow under the card
    shadow = Image.new("RGBA", (w + 80, h + 80), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((40, 40, w + 40, h + 40), radius=4, fill=(0, 0, 0, 110))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    img.alpha_composite(shadow, (x - 40, y - 20))
    img.alpha_composite(card, (x, y))


def draw_connector(
    draw: ImageDraw.ImageDraw,
    x1: int,
    y1: int,
    x2: int,
    y2: int,
    color: RGBA,
    width: int,
) -> None:
    """Orthogonal connector — right, then down, then right. Pure 'blueprint' lines."""
    mx = (x1 + x2) // 2
    draw.line([(x1, y1), (mx, y1)], fill=color, width=width)
    draw.line([(mx, y1), (mx, y2)], fill=color, width=width)
    draw.line([(mx, y2), (x2, y2)], fill=color, width=width)
    # Endpoint dots — keep it engineered
    r = max(3, width)
    draw.ellipse((x1 - r, y1 - r, x1 + r, y1 + r), fill=color)
    draw.ellipse((x2 - r, y2 - r, x2 + r, y2 + r), fill=color)


def compose(transparent: bool) -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0) if transparent else BG_VOID)
    draw = ImageDraw.Draw(img)

    if not transparent:
        # Workspace plate (subtle tonal lift over the void)
        rounded_rect(draw, (0, 0, SIZE, SIZE), radius=0, fill=BG_VOID)

        # Split Pane gutter — the bilateral division. Left = code, right = diagram.
        split_x = int(SIZE * 0.42)
        gutter_w = max(4, int(SIZE * 0.012))
        # Left pane: surface_container_low
        draw.rectangle((0, 0, split_x, SIZE), fill=SURFACE_LOW)
        # Gutter
        draw.rectangle((split_x, 0, split_x + gutter_w, SIZE), fill=GUTTER)
        # Right pane stays on void (surface)

        # Left pane: code stripes — the "raw logic" side
        code_lines = [
            (0.30, PRIMARY),       # `type`
            (0.78, ON_SURFACE),
            (0.62, ON_SURFACE),
            (0.45, DIM_TEXT),
            (0.25, SECONDARY),     # `union`
            (0.70, ON_SURFACE),
            (0.55, ON_SURFACE),
            (0.40, ON_SURFACE),
            (0.22, TERTIARY),      # `alias`
            (0.60, DIM_TEXT),
        ]
        line_h = max(6, int(SIZE * 0.022))
        gap = max(8, int(SIZE * 0.028))
        x0 = int(SIZE * 0.08)
        y = int(SIZE * 0.12)
        for length_pct, color in code_lines:
            x1 = x0 + int((split_x - x0 - int(SIZE * 0.06)) * length_pct)
            draw.rounded_rectangle(
                (x0, y, x1, y + line_h),
                radius=line_h // 2,
                fill=color,
            )
            y += line_h + gap

    # Right pane: three Node Cards — the "visual manifestation" side.
    # If transparent, we recenter the diagram over the full canvas instead of right pane.
    if transparent:
        right_x0 = int(SIZE * 0.10)
        right_w = SIZE - 2 * right_x0
    else:
        right_x0 = int(SIZE * 0.46)
        right_w = SIZE - right_x0 - int(SIZE * 0.06)

    # Three cards stacked with drift; sized to fit vertically with breathing room.
    top_y = int(SIZE * 0.10)
    bottom_y = int(SIZE * 0.92)
    v_gap = int(SIZE * 0.04)
    card_h = (bottom_y - top_y - 2 * v_gap) // 3
    card_w = int(right_w * 0.78)
    base_x = right_x0 + (right_w - card_w) // 2

    # Drift / asymmetry — the "DO use asymmetry" rule.
    x_offsets = [-int(SIZE * 0.025), int(SIZE * 0.035), -int(SIZE * 0.015)]
    accents = [PRIMARY, SECONDARY, TERTIARY]
    line_specs = [
        [(0.55, ON_SURFACE), (0.40, ON_SURFACE)],
        [(0.65, ON_SURFACE), (0.30, TERTIARY)],
        [(0.45, ON_SURFACE)],
    ]
    card_xs = []
    card_ys = []
    for i in range(3):
        cx = base_x + x_offsets[i]
        cy = top_y + i * (card_h + v_gap)
        card_xs.append(cx)
        card_ys.append(cy)

    for i in range(3):
        draw_node_card(
            img,
            card_xs[i],
            card_ys[i],
            card_w,
            card_h,
            accents[i],
            line_specs[i],
        )

    # Connectors — orthogonal lines that hug the right edge, in-canvas.
    conn_w = max(3, int(SIZE * 0.007))
    rail_x = min(SIZE - int(SIZE * 0.04), max(card_xs[i] + card_w for i in range(3)) + int(SIZE * 0.025))
    for i in range(2):
        y1 = card_ys[i] + card_h // 2
        y2 = card_ys[i + 1] + card_h // 2
        x_start = card_xs[i] + card_w
        x_end = card_xs[i + 1] + card_w
        color = accents[i + 1]
        # right out of card i -> down the rail -> back into card i+1
        draw.line([(x_start, y1), (rail_x, y1)], fill=color, width=conn_w)
        draw.line([(rail_x, y1), (rail_x, y2)], fill=color, width=conn_w)
        draw.line([(rail_x, y2), (x_end, y2)], fill=color, width=conn_w)
        r = max(4, conn_w)
        draw.ellipse((x_start - r, y1 - r, x_start + r, y1 + r), fill=color)
        draw.ellipse((x_end - r, y2 - r, x_end + r, y2 + r), fill=color)

    return img


def main() -> None:
    out_dir = Path(__file__).resolve().parent.parent / "packages" / "vscode" / "icons"
    out_dir.mkdir(parents=True, exist_ok=True)

    normal = compose(transparent=False)
    flat = compose(transparent=True)

    normal_path = out_dir / "icon.png"
    flat_path = out_dir / "icon-flat.png"
    normal.save(normal_path, "PNG")
    flat.save(flat_path, "PNG")
    print(f"wrote {normal_path}")
    print(f"wrote {flat_path}")


if __name__ == "__main__":
    main()
