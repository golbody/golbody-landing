#!/usr/bin/env python3
"""
Script de remplacement en masse : charte teal GolBody → jaune Fitness Park.
Remplace les couleurs d'accent, les fonds sombres teintés, et change le texte
 des boutons primaires en #111111.
"""

import re
import os
import glob

# --- Mappings des couleurs ---

# Couleurs d'accent teal → jaune
ACCENT_MAP = {
    '#2dd4bf': '#FFD600',
    '#14b8a6': '#e6c000',
    '#0d9488': '#ccaa00',
    '#10918d': '#FFD600',
    '#0e7f7b': '#e6c000',
    '#0d7a76': '#ccaa00',
    '#0f734e': '#ccaa00',
    '#107a6e': '#ccaa00',
    '#0f5e4a': '#b8a000',
    '#5eead4': '#FFD600',
}

# Fonds sombres teintés → gris foncé pur
DARK_BG_MAP = {
    '#0f1923': '#111111',
    '#040a10': '#0a0a0a',
    '#1a2332': '#1a1a1a',
    '#0e1621': '#0d0d0d',
    '#0D1F2D': '#111111',
    '#122433': '#1a1a2e',
    '#1a3040': '#222233',
    '#1a2535': '#222233',
    '#2a3a4a': '#333344',
    '#0d2a2a': '#111111',
}

# Textes teintés teal → gris/blanc neutre
TEXT_MAP = {
    '#8ab0a8': '#a0a0a0',
    '#b8d4cf': '#c0c0c0',
    '#5a7a72': '#6a6a6a',
    '#f0f6f4': '#eeeeee',
}

# rgba avec espaces
RGBA_MAP = {
    'rgba(16, 145, 141,': 'rgba(255, 214, 0,',
    'rgba(13, 31, 45,':   'rgba(17, 17, 17,',
    'rgba(13, 148, 136,': 'rgba(204, 170, 0,',
    'rgba(45, 212, 191,': 'rgba(255, 214, 0,',
    'rgba(42, 58, 74,':   'rgba(40, 40, 50,',
}

# rgba sans espaces
RGBA_NO_SPACE_MAP = {
    'rgba(45,212,191,': 'rgba(255,214,0,',
    'rgba(13,148,136,': 'rgba(204,170,0,',
}

# hsl teal → hsl jaune (pour les shadows)
HSL_MAP = {
    'hsl(202.8169 89.1213% 53.1373% / 0.00)': 'hsl(50 100% 50% / 0.00)',
}


def replace_all_colors(content):
    """Remplace toutes les couleurs par leurs équivalents jaunes."""
    # Couleurs d'accent
    for old, new in ACCENT_MAP.items():
        content = content.replace(old, new)
        content = content.replace(old.upper(), new)
        content = content.replace(old.lower(), new)

    # Fonds sombres
    for old, new in DARK_BG_MAP.items():
        content = content.replace(old, new)
        content = content.replace(old.upper(), new)
        content = content.replace(old.lower(), new)

    # Textes
    for old, new in TEXT_MAP.items():
        content = content.replace(old, new)
        content = content.replace(old.upper(), new)
        content = content.replace(old.lower(), new)

    # rgba avec espaces
    for old, new in RGBA_MAP.items():
        content = content.replace(old, new)

    # rgba sans espaces
    for old, new in RGBA_NO_SPACE_MAP.items():
        content = content.replace(old, new)

    # hsl
    for old, new in HSL_MAP.items():
        content = content.replace(old, new)

    return content


def fix_button_text_colors(content, filepath):
    """
    Change le texte des boutons primaires en #111111.
    Cible:
      - .gol-btn { ... color: #ffffff; ... }
      - button[type="submit"] { ... color: #fff; ... }
      - .generate-btn et .transform-btn.active dans dashboard.html
    """

    # 1) .gol-btn : remplacer color: #ffffff ou color: #fff par color: #111111
    # On cible spécifiquement la règle .gol-btn
    pattern_golbtn = re.compile(
        r'(\.gol-btn\s*\{[^}]*?)color\s*:\s*(#[0-9a-fA-F]{3,8})([^}]*?\})',
        re.DOTALL | re.IGNORECASE
    )

    def repl_golbtn(m):
        before = m.group(1)
        old_color = m.group(2)
        after = m.group(3)
        # Garder le texte blanc si ce n'est pas un bouton primaire (rare, mais sécurité)
        if old_color.lower() in ('#ffffff', '#fff', '#ffffff;', '#fff;'):
            return before + 'color: #111111' + after
        return m.group(0)

    content = pattern_golbtn.sub(repl_golbtn, content)

    # 2) button[type="submit"] : remplacer color: #fff par color: #111111
    pattern_submit = re.compile(
        r'(button\[type\s*=\s*"submit"\]\s*\{[^}]*?)color\s*:\s*(#[0-9a-fA-F]{3,8})([^}]*?\})',
        re.DOTALL | re.IGNORECASE
    )

    def repl_submit(m):
        before = m.group(1)
        old_color = m.group(2)
        after = m.group(3)
        if old_color.lower() in ('#ffffff', '#fff', '#ffffff;', '#fff;'):
            return before + 'color: #111111' + after
        return m.group(0)

    content = pattern_submit.sub(repl_submit, content)

    # 3) dashboard.html — boutons spécifiques avec texte blanc à passer en noir
    if 'dashboard.html' in filepath:
        # .generate-btn et .transform-btn.active
        for selector in ['.generate-btn', '.transform-btn.active']:
            pat = re.compile(
                rf'({re.escape(selector)}\s*\{{[^}}]*?)color\s*:\s*(#[0-9a-fA-F]{{3,8}})([^}}]*?\}})',
                re.DOTALL | re.IGNORECASE
            )

            def repl_dashboard_btn(m):
                before = m.group(1)
                old_color = m.group(2)
                after = m.group(3)
                if old_color.lower() in ('#ffffff', '#fff', '#ffffff;', '#fff;'):
                    return before + 'color: #111111' + after
                return m.group(0)

            content = pat.sub(repl_dashboard_btn, content)

    return content


def main():
    base_dir = 'artifacts/golbody'
    files = []
    for ext in ('*.html', '*.css'):
        files.extend(glob.glob(os.path.join(base_dir, '**', ext), recursive=True))

    for filepath in sorted(files):
        print(f"Processing: {filepath}")
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        # Étape 1 — remplacement des couleurs
        content = replace_all_colors(content)

        # Étape 2 — texte des boutons
        content = fix_button_text_colors(content, filepath)

        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)

    print("Done! All teal colors replaced with Fitness Park yellow.")


if __name__ == '__main__':
    main()
