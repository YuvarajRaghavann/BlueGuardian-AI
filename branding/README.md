# Branding

| File | Purpose |
| --- | --- |
| `logo-source.png` | The master BlueGuardian logo (Bluetooth rune with a locked shield) |
| `render_icons.py` | Generates every icon from the master logo |
| `playstore-icon.png` | 512 × 512 Play Store icon (generated) |

Regenerate all icons after changing the logo (needs Python with Pillow and NumPy):

```bash
python3 branding/render_icons.py
```

It writes the Android launcher icons (legacy, round, adaptive foreground and gradient background), splash images, the Play Store icon, the in-app logo (`src/assets/logo-mark.png`) and the favicon (`public/favicon.png`).
