"""Build complete DeepSeek reaction sprites for the web pet."""

from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public" / "assets"
OUTPUT = ROOT / "src" / "client" / "assets"

REACTIONS = (
    "skeptical",
    "cheerful",
    "apologetic",
    "shocked",
    "sleepy",
    "proud",
    "crying",
    "angry",
    "thinking",
    "relaxed",
    "desk-confused",
    "desk-coding",
    "desk-done",
    "desk-facepalm",
    "deepseek-rice",
    "deepseek-pressure",
)

REACTION_FRAMES = {
    "idle-blink": "black",
    "desk-coding-hands-up": "white",
    "thinking-keypress": "white",
}


def connected_background(image: Image.Image, predicate, *, despill_magenta: bool = False) -> Image.Image:
    image = image.convert("RGBA")
    width, height = image.size
    pixels = image.load()
    seen = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def add(x: int, y: int) -> None:
        index = y * width + x
        if seen[index] or not predicate(pixels[x, y]):
            return
        seen[index] = 1
        queue.append((x, y))

    for x in range(width):
        add(x, 0)
        add(x, height - 1)
    for y in range(height):
        add(0, y)
        add(width - 1, y)

    while queue:
        x, y = queue.popleft()
        if x:
            add(x - 1, y)
        if x + 1 < width:
            add(x + 1, y)
        if y:
            add(x, y - 1)
        if y + 1 < height:
            add(x, y + 1)

    matte = Image.new("L", image.size, 0)
    matte.putdata([255 if value else 0 for value in seen])
    matte = matte.filter(ImageFilter.GaussianBlur(0.65))
    alpha = Image.eval(matte, lambda value: 255 - value)
    alpha = Image.composite(image.getchannel("A"), Image.new("L", image.size, 0), alpha)
    image.putalpha(alpha)
    if despill_magenta:
        cleaned = []
        for red, green, blue, pixel_alpha in image.getdata():
            if red > green * 1.45 and blue > green * 1.35:
                red = min(red, max(green + 12, int(blue * 0.42)))
                if pixel_alpha < 246:
                    pixel_alpha = max(0, pixel_alpha - 28)
            cleaned.append((red, green, blue, pixel_alpha))
        image.putdata(cleaned)
    return image


def is_magenta(pixel: tuple[int, int, int, int]) -> bool:
    red, green, blue, alpha = pixel
    return alpha == 0 or (
        red > 135
        and blue > 115
        and green < 175
        and (red + blue) / 2 > green * 1.32
    )


def is_white(pixel: tuple[int, int, int, int]) -> bool:
    red, green, blue, alpha = pixel
    # Generated sources use a nearly-white studio backdrop. Keep the flood fill
    # connected to the canvas edge so outlined white costume details stay intact.
    return alpha == 0 or (min(red, green, blue) >= 180 and max(red, green, blue) - min(red, green, blue) <= 44)


def is_black(pixel: tuple[int, int, int, int]) -> bool:
    red, green, blue, alpha = pixel
    return alpha == 0 or max(red, green, blue) <= 10


def save_square(image: Image.Image, target: Path, size: int = 512, *, trim: bool = False) -> None:
    image = image.convert("RGBA")
    if trim:
        bounds = image.getchannel("A").getbbox()
        if bounds:
            image = image.crop(bounds)
        image.thumbnail((size - 24, size - 24), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (size, size))
        canvas.alpha_composite(image, ((size - image.width) // 2, (size - image.height) // 2))
        image = canvas
    else:
        image = image.resize((size, size), Image.Resampling.LANCZOS)
    image.save(target, "WEBP", quality=84, method=6)
    print(f"wrote {target}")


def crop_grid(image: Image.Image, columns: int, rows: int, column: int, row: int) -> Image.Image:
    width, height = image.size
    left = round(column * width / columns) + 5
    top = round(row * height / rows) + 5
    right = round((column + 1) * width / columns) - 5
    bottom = round((row + 1) * height / rows) - 5
    return image.crop((left, top, right, bottom))


def detected_spans(image: Image.Image, *, vertical: bool, expected: int) -> list[tuple[int, int]]:
    """Return cells between the model-drawn black grid lines (rows are not equal-height)."""
    rgb = image.convert("RGB")
    primary = image.width if vertical else image.height
    secondary = image.height if vertical else image.width
    lines = []
    for position in range(primary):
        dark = 0
        for cross in range(secondary):
            pixel = rgb.getpixel((position, cross) if vertical else (cross, position))
            if max(pixel) < 48:
                dark += 1
        if dark > secondary * .72:
            lines.append(position)

    clusters: list[list[int]] = []
    for position in lines:
        if not clusters or position > clusters[-1][-1] + 1:
            clusters.append([position])
        else:
            clusters[-1].append(position)
    if len(clusters) != expected + 1:
        return [(round(index * primary / expected) + 6, round((index + 1) * primary / expected) - 6) for index in range(expected)]
    return [(clusters[index][-1] + 3, clusters[index + 1][0] - 3) for index in range(expected)]


def crop_detected_grid(image: Image.Image, columns: int, rows: int, column: int, row: int) -> Image.Image:
    xs = detected_spans(image, vertical=True, expected=columns)
    ys = detected_spans(image, vertical=False, expected=rows)
    return image.crop((xs[column][0], ys[row][0], xs[column][1], ys[row][1]))


def build_reactions() -> None:
    save_square(Image.open(PUBLIC / "deepseek-idle.png"), OUTPUT / "deepseek-idle.webp", size=420, trim=True)
    source_root = PUBLIC / "reactions-source"
    for name in REACTIONS:
        image = connected_background(Image.open(source_root / f"{name}.png"), is_white)
        save_square(image, OUTPUT / f"reaction-{name}.webp", size=420, trim=True)

    semantic = Image.open(PUBLIC / "deepseek-semantic-reactions-source.png").convert("RGBA")
    for column, name in enumerate(("blindfold", "satiated")):
        image = crop_grid(semantic, 2, 1, column, 0)
        save_square(image, OUTPUT / f"reaction-{name}.webp", size=420, trim=True)

    idle_sheet = Image.open(PUBLIC / "deepseek-idle-reactions-source.png").convert("RGBA")
    for column, name in enumerate(("hungry", "pillow", "sleeping", "seal")):
        image = crop_detected_grid(idle_sheet, 4, 1, column, 0)
        image = connected_background(image, is_magenta, despill_magenta=True)
        prefix = "decoration" if name == "seal" else "reaction"
        save_square(image, OUTPUT / f"{prefix}-{name}.webp", size=420, trim=True)

    frame_root = PUBLIC / "reaction-frames-source"
    predicates = {"white": is_white, "black": is_black}
    for name, background in REACTION_FRAMES.items():
        image = connected_background(Image.open(frame_root / f"{name}.png"), predicates[background])
        save_square(image, OUTPUT / f"frame-{name}.webp", size=420, trim=True)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    build_reactions()


if __name__ == "__main__":
    main()
