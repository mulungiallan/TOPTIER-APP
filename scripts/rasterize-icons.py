#!/usr/bin/env python3
"""Convert TopTier SVG assets to PNG using cairosvg."""
import cairosvg
from pathlib import Path

ASSETS_DIR = Path('/home/z/my-project/download/toptier-playstore/mobile-app/assets')
STORE_DIR = Path('/home/z/my-project/download/toptier-playstore/store-listing')

conversions = [
    (ASSETS_DIR / 'icon.svg', ASSETS_DIR / 'icon.png', 1024, 1024),
    (ASSETS_DIR / 'icon.svg', ASSETS_DIR / 'icon-512.png', 512, 512),
    (ASSETS_DIR / 'icon.svg', ASSETS_DIR / 'icon-192.png', 192, 192),
    (ASSETS_DIR / 'icon.svg', STORE_DIR / 'play-store-icon.png', 512, 512),
    (ASSETS_DIR / 'adaptive-icon.svg', ASSETS_DIR / 'adaptive-icon.png', 1024, 1024),
    (ASSETS_DIR / 'splash.svg', ASSETS_DIR / 'splash.png', 1284, 2778),
    (ASSETS_DIR / 'splash.svg', ASSETS_DIR / 'splash-1242.png', 1242, 2688),
    (ASSETS_DIR / 'icon.svg', ASSETS_DIR / 'favicon.png', 48, 48),
    (STORE_DIR / 'feature-graphic.svg', STORE_DIR / 'feature-graphic.png', 1024, 500),
]

# Notification icon (white-on-transparent, required by Android)
notif_svg = ASSETS_DIR / '_notif.svg'
notif_svg.write_text('''<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <path d="M16 64 L36 36 L52 48 L80 12" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <rect x="14" y="60" width="8" height="20" rx="2" fill="#FFFFFF"/>
  <rect x="50" y="44" width="8" height="20" rx="2" fill="#FFFFFF"/>
  <rect x="78" y="8" width="8" height="20" rx="2" fill="#FFFFFF"/>
</svg>''')
conversions.append((notif_svg, ASSETS_DIR / 'notification-icon.png', 96, 96))

print('Converting SVG -> PNG for TopTier assets...')
succeeded = 0
for svg, png, w, h in conversions:
    try:
        cairosvg.svg2png(url=str(svg), write_to=str(png), output_width=w, output_height=h)
        print(f'  ✓ {png.name}  ({w}x{h})')
        succeeded += 1
    except Exception as e:
        print(f'  ✗ {png.name}: {e}')

if notif_svg.exists():
    notif_svg.unlink()

print(f'\n✓ {succeeded}/{len(conversions)} icons generated')
print(f'  Assets dir: {ASSETS_DIR}')
print(f'  Store dir:  {STORE_DIR}')
