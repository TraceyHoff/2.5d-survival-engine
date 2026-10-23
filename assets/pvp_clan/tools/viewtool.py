import sys
from PIL import Image, ImageDraw
def view(path, out, scale=2, bg=(120, 170, 96), grid=None, crop=None):
    im = Image.open(path).convert("RGBA")
    if crop: im = im.crop(crop)
    b = Image.new("RGBA", im.size, bg + (255,))
    if grid:
        d = ImageDraw.Draw(b)
        for x in range(0, im.width, grid[0]):
            for y in range(0, im.height, grid[1]):
                if (x // grid[0] + y // grid[1]) % 2: d.rectangle([x, y, x + grid[0] - 1, y + grid[1] - 1], fill=tuple(int(c * 0.9) for c in bg) + (255,))
    b = Image.alpha_composite(b, im)
    b.resize((im.width * scale, im.height * scale), Image.NEAREST).save(out)
if __name__ == "__main__":
    a = sys.argv; view(a[1], a[2], int(a[3]) if len(a) > 3 else 2, grid=(int(a[4]), int(a[5])) if len(a) > 5 else None,
                       crop=tuple(map(int, a[6].split(","))) if len(a) > 6 else None)
