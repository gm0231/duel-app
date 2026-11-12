#!/usr/bin/env python3
"""Generate the duel-app icon set (attributes, star, races) as pixel-art PNGs.

Design rules (user, 2026-11-12):
- Icons may be SMALL. Readability comes from placement (a solid chip ground,
  fixed order, consistent position), never from size.
- One consistent touch: chunky pixel glyphs on transparent background.
  Attributes keep their canonical colours; races are carved-ivory glyphs so
  the three systems read as one family without colour noise.
Output: ../assets/icons/<name>.png  (48x48, 12x12 grid x4, NEAREST)
"""
from PIL import Image
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'icons')
os.makedirs(OUT, exist_ok=True)

IVORY = {'M': (234, 223, 194, 255), 'D': (146, 130, 96, 255), 'L': (255, 246, 224, 255), 'W': (24, 20, 14, 255)}
GOLD = {'M': (242, 197, 58, 255), 'D': (178, 134, 32, 255), 'L': (255, 230, 140, 255), 'W': (24, 20, 14, 255)}

ICONS = {}

def icon(name, palette, rows):
    assert len(rows) == 12 and all(len(r) == 12 for r in rows), name
    ICONS[name] = (palette, rows)

# ---------------- attributes (canonical colours) ----------------
icon('attr-earth', {'M': (181, 126, 66, 255), 'D': (122, 83, 38, 255), 'L': (240, 224, 190, 255)}, [
"............",
".....LL.....",
"....LMM.....",
"....MMMM....",
"...MMMMMM...",
"...MMDDMMM..",
"..MMMMMMMM..",
"..MMDDMMMMM.",
".MMMMMMMMMMM",
".MDDMMMMDDMM",
"MMMMMMMMMMMM",
"............"])
icon('attr-water', {'M': (63, 143, 224, 255), 'D': (31, 95, 168, 255), 'L': (190, 224, 255, 255)}, [
"............",
".....MM.....",
"....MMMM....",
"....MMMM....",
"...MMMMMM...",
"...MLMMMM...",
"..MMMMMMMM..",
"..MLMMMMMM..",
"..MMMMMMMM..",
"...MMMMMM...",
"....MDDM....",
"............"])
icon('attr-fire', {'M': (232, 84, 47, 255), 'D': (168, 47, 20, 255), 'L': (255, 176, 58, 255)}, [
".....M......",
"....MMM.....",
"....MMM.....",
"....MMMM.M..",
"...MMMMMMM..",
"...MMMMMMM..",
"...MLLMMMM..",
"..MLLLLMMM..",
"..MLLLLMM...",
"...LLLLM....",
"....LL......",
"............"])
icon('attr-wind', {'M': (63, 174, 90, 255), 'D': (34, 122, 58, 255), 'L': (170, 235, 190, 255)}, [
"....MMMM....",
"..MMMMMMMM..",
"..MM....MM..",
"..MM........",
"..MM..MMMM..",
"..MM.MM.MM..",
"...MMMM.MM..",
"......MM....",
".....MM.....",
"............",
"............",
"............"])
icon('attr-light', {'M': (242, 197, 58, 255), 'D': (178, 134, 32, 255), 'L': (255, 240, 170, 255)}, [
"..M..MM..M..",
"..M..MM..M..",
"...M.MM.M...",
"....MMMM....",
"..MMMMMMMM..",
".MMMMLLMMMM.",
".MMMMLLMMMM.",
"..MMMMMMMM..",
"....MMMM....",
"...M.MM.M...",
"..M..MM..M..",
"..M..MM..M.."])
icon('attr-dark', {'M': (150, 104, 208, 255), 'D': (98, 62, 150, 255), 'L': (216, 190, 245, 255)}, [
"....MMMM....",
"..MMMMMMM...",
"..MMMM......",
".MMMM.......",
".MMM........",
".MMM.....L..",
".MMM........",
".MMMM.......",
"..MMMM......",
"..MMMMMMM...",
"....MMMM....",
"............"])
icon('attr-divine', {'M': (240, 208, 96, 255), 'D': (186, 148, 44, 255), 'L': (255, 240, 170, 255)}, [
"............",
".MM..MM..MM.",
"MMMMMMMMMMMM",
".MMMMMMMMMM.",
"..MMMMMMMM..",
"...M.MM.M...",
"....MMMM....",
".....MM.....",
"....MMMM....",
"...M....M...",
"............",
"............"])

# ---------------- star (level / rank) ----------------
icon('star', GOLD, [
".....MM.....",
".....MM.....",
"....MMMM....",
"....MMMM....",
".MMMMMMMMMM.",
"..MMMMMMMM..",
"...MMMMMM...",
"...MMMMMM...",
"..MMMMMMMM..",
"..MMM..MMM..",
"..MM....MM..",
"............"])

# ---------------- races (carved ivory) ----------------
icon('race-warrior', IVORY, [
".......MMMM.",
"......MMMMM.",
".....MMMM...",
"....MMMM....",
"...MMMM.....",
"..MMMM......",
"..MMM.......",
".MMMM.......",
"..MMM.......",
".MMMMM......",
".MM.MM......",
"MM...MM....."])
icon('race-spellcaster', IVORY, [
"............",
".....MM.....",
"....MMMM....",
"....MMMM....",
"...MMMMMM...",
"...MMMMMM...",
"..MMMMMMMM..",
".MMMMMMMMMM.",
"MMMMMMMMMMMM",
"............",
"............",
"............"])
icon('race-fairy', IVORY, [
"....MMMM....",
"...MMMMMM...",
"..MMMMMMMM..",
"..MMMMMMMM..",
".MMDMMMMMM..",
".MMDDMMMMM..",
".MDDDMMMM...",
"MMDDDMM.....",
"MDDDMM......",
"DDMM........",
"............",
"............"])
icon('race-fiend', IVORY, [
".MM......MM.",
".MMM....MMM.",
"..MMMMMMMM..",
"..MMMMMMMM..",
"..MMMMMMMM..",
"..MWWMMWWM..",
"..MMMMMMMM..",
"..MMMMMMMM..",
"...MMMMMM...",
"....MMMM....",
"............",
"............"])
icon('race-zombie', IVORY, [
"............",
"...MMMMMM...",
"..MMMMMMMM..",
"..MWMMMMWM..",
"..MMMMMMMM..",
"..MMMMMMMM..",
"...MMMMMM...",
"...MMMMMM...",
"....M..M....",
"....MMMM....",
"............",
"............"])
icon('race-machine', IVORY, [
"..M..MM..M..",
"..M..MM..M..",
"...MMMMMM...",
"..MMMMMMMM..",
"..MMMDDMMM..",
".MMMD..DMMM.",
".MMMD..DMMM.",
"..MMMDDMMM..",
"..MMMMMMMM..",
"...MMMMMM...",
"..M..MM..M..",
"..M..MM..M.."])
icon('race-aqua', IVORY, [
"............",
"..MM..MM..M.",
".MMMM.MMM.MM",
"MMMM...MMMM.",
"............",
"..MM..MM..M.",
".MMMM.MMM.MM",
"MMMM...MMMM.",
"............",
"............",
"............",
"............"])
icon('race-pyro', IVORY, [
".....M......",
"....MMM.....",
"....MMM.....",
"....MMMM.M..",
"...MMMMMMM..",
"...MMMMMMM..",
"...MDDMMMM..",
"..MDDDDMMM..",
"..MDDDDMM...",
"...DDDDM....",
"....DD......",
"............"])
icon('race-rock', IVORY, [
"............",
"....MMMM....",
"..MMMMMMMM..",
".MMMMMMMMMM.",
".MMDMMMMDMM.",
".MMMMMMMMMM.",
"MMMMDMMDMMMM",
"MMMMMMMMMMMM",
"MMMMMMMMMMMM",
".MMMMMMMMMM.",
"............",
"............"])
icon('race-wingedbeast', IVORY, [
"............",
"...MMMMM....",
"..MMMMMMM...",
"..MMMMWMM...",
"..MMMMMMMMM.",
"..MMMMMMMM..",
"...MMMMMM...",
"....MMMM....",
"...MMMMM....",
"..MM.MM.....",
".MM.........",
"............"])
icon('race-plant', IVORY, [
".......MMMM.",
".....MMMMMM.",
"....MMMLMMM.",
"....MMMMMM..",
"...MMMMM....",
"...DMMM.....",
"..DMMM......",
"..MM........",
".MM.........",
"MM..........",
"............",
"............"])
icon('race-insect', IVORY, [
".M........M.",
"..M..MM..M..",
"....MMMM....",
"..MMMMMMMM..",
".MMMDMMDMMM.",
"MMMMMMMMMMMM",
".MMMDMMDMMM.",
"..MMMMMMMM..",
".M.MMMMMM.M.",
"M...MMMM...M",
"............",
"............"])
icon('race-thunder', IVORY, [
"......MMMM..",
".....MMMM...",
"....MMMM....",
"...MMMMMMM..",
"..MMMMMMMM..",
".....MMMM...",
"....MMMM....",
"...MMMM.....",
"..MMMM......",
"..MM........",
".MM.........",
"............"])
icon('race-dragon', IVORY, [
"..MM........",
"..MMMM......",
"...MMMMM....",
"....MMMMMMM.",
"....MMMMMMMM",
"....MMMMM.MM",
".....MMMMMM.",
".....MMMM...",
"....MMMM....",
"...MMMM.....",
"..MMMM......",
"............"])
icon('race-beast', IVORY, [
".MM.MMMM.MM.",
".MM.MMMM.MM.",
"............",
"...MMMMMM...",
"..MMMMMMMM..",
".MMMMMMMMMM.",
".MMMMMMMMMM.",
"..MMMMMMMM..",
"...MMMMMM...",
"............",
"............",
"............"])
icon('race-beastwarrior', IVORY, [
".MM..MM..MM.",
".MM..MM..MM.",
".MM..MM..MM.",
"..MM.MM.MM..",
"..MM.MM.MM..",
"...MMMMMM...",
"....MMMM....",
"............",
"............",
"............",
"............",
"............"])
icon('race-dinosaur', IVORY, [
"............",
"....M..M....",
"...MMMMMMMM.",
".MMMMMMMMMMM",
".MMMMMMMMMM.",
"..MMMMMMMM..",
"..M..M..M...",
"..M..M..M...",
"............",
"............",
"............",
"............"])
icon('race-fish', IVORY, [
"............",
".....MMMM...",
"..MMMMMMMMM.",
".MMMMMMMWMMM",
"MMMMMMMMMMMM",
".MMMMMMMMMMM",
"..MMMMMMMMM.",
".....MMMM...",
"....MM..MM..",
"............",
"............",
"............"])
icon('race-seaserpent', IVORY, [
"....MMMM....",
"...MMMMMM...",
"...MM..MM...",
"....MMMM....",
".....MM.....",
"....MMMM....",
"...MMMM.....",
"..MMMM......",
"..MMMMMMMM..",
"...MMMMMM...",
"............",
"............"])
icon('race-reptile', IVORY, [
"............",
"....MMMM....",
"..MMMMMMMM..",
"..MM....MM..",
"..M.MMMM.M..",
"..M.M..M.M..",
"..M.MMMM.M..",
"..MM....MM..",
"...MMMMMM...",
".....MM.MM..",
"............",
"............"])
icon('race-psychic', IVORY, [
"............",
"............",
"....MMMM....",
"..MMMMMMMM..",
".MM..MM..MM.",
".MM.MMMM.MM.",
".MM.MMMM.MM.",
".MM..MM..MM.",
"..MMMMMMMM..",
"....MMMM....",
"............",
"............"])
icon('race-divinebeast', IVORY, [
"MM........MM",
"MMM......MMM",
".MMMMMMMMMM.",
"..MMMMMMMM..",
"...MDMMDM...",
"....MMMM....",
"....MMMM....",
"............",
"............",
"............",
"............",
"............"])
icon('race-creatorgod', IVORY, [
"....MMMM....",
"...MMMMMM...",
"...MM..MM...",
"...MM..MM...",
"...MMMMMM...",
".....MM.....",
"..MMMMMMMM..",
".....MM.....",
".....MM.....",
".....MM.....",
"............",
"............"])
icon('race-wyrm', IVORY, [
".MM......MM.",
".MMM....MMM.",
"..MMMMMMMM..",
"..MMMMMMMM..",
".MMMMMMMMMM.",
".MMMMLLMMMM.",
".MMMMLLMMMM.",
".MMMMMMMMMM.",
"..MMMMMMMM..",
"...MMMMMM...",
"............",
"............"])
icon('race-cyberse', IVORY, [
"....MM......",
"....MM..MM..",
"....MM..MM..",
"..MMMMMMMM..",
"..MM.MM.MM..",
"..MM.MM.MM..",
"..MMMMMMMM..",
"....MM......",
"....MM......",
"..MMM.......",
"............",
"............"])
icon('race-illusion', IVORY, [
"............",
"...MMMMMM...",
"..MMMMMMMM..",
".MMMMMMMMMM.",
".MMDDMMDDMM.",
".MMMMMMMMMM.",
".MMMMMMMMMM.",
"..MMDDDDMM..",
"...MMMMMM...",
"............",
"............",
"............"])

def main():
    for name, (pal, rows) in ICONS.items():
        img = Image.new('RGBA', (12, 12), (0, 0, 0, 0))
        px = img.load()
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                if ch in pal:
                    px[x, y] = pal[ch]
        img = img.resize((48, 48), Image.NEAREST)
        img.save(os.path.join(OUT, name + '.png'))
    print('wrote', len(ICONS), 'icons to', OUT)

if __name__ == '__main__':
    main()
