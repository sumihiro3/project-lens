import os
from PIL import Image
import shutil
import subprocess

def generate_icons(source_path, tauri_icons_dir, public_dir):
    if not os.path.exists(source_path):
        print(f"Error: Source file not found at {source_path}")
        return

    img = Image.open(source_path).convert("RGBA")

    # Ensure directories exist
    os.makedirs(tauri_icons_dir, exist_ok=True)
    os.makedirs(public_dir, exist_ok=True)

    # 1. Standard PNGs for Tauri
    sizes = {
        '32x32.png': (32, 32),
        '128x128.png': (128, 128),
        '128x128@2x.png': (256, 256),
        'icon.png': (512, 512),
    }

    for filename, size in sizes.items():
        resized_img = img.resize(size, Image.Resampling.LANCZOS)
        resized_img.save(os.path.join(tauri_icons_dir, filename))
        print(f"Generated {filename}")

    # 2. icon.ico for Windows (Tauri)
    img.save(os.path.join(tauri_icons_dir, 'icon.ico'), format='ICO', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    print("Generated icon.ico")

    # 3. favicon.ico for Web (Public)
    img.save(os.path.join(public_dir, 'favicon.ico'), format='ICO', sizes=[(48, 48), (32, 32), (16, 16)])
    print("Generated favicon.ico")

    # 4. icon.icns for macOS
    # Create iconset directory
    iconset_dir = 'ProjectLens.iconset'
    os.makedirs(iconset_dir, exist_ok=True)

    iconset_sizes = {
        'icon_16x16.png': (16, 16),
        'icon_16x16@2x.png': (32, 32),
        'icon_32x32.png': (32, 32),
        'icon_32x32@2x.png': (64, 64),
        'icon_128x128.png': (128, 128),
        'icon_128x128@2x.png': (256, 256),
        'icon_256x256.png': (256, 256),
        'icon_256x256@2x.png': (512, 512),
        'icon_512x512.png': (512, 512),
        'icon_512x512@2x.png': (1024, 1024),
    }

    for filename, size in iconset_sizes.items():
        resized_img = img.resize(size, Image.Resampling.LANCZOS)
        resized_img.save(os.path.join(iconset_dir, filename))
    
    # Run iconutil
    try:
        subprocess.run(['iconutil', '-c', 'icns', iconset_dir, '-o', os.path.join(tauri_icons_dir, 'icon.icns')], check=True)
        print("Generated icon.icns")
    except subprocess.CalledProcessError as e:
        print(f"Error generating icns: {e}")
    except FileNotFoundError:
        print("iconutil not found, skipping icns generation (are you on macOS?)")
    
    # Cleanup
    shutil.rmtree(iconset_dir)
    print("Cleaned up iconset directory")

if __name__ == "__main__":
    source = '/Users/sumihiro/projects/ProjectLens/src/public/logo.png'
    tauri_icons = '/Users/sumihiro/projects/ProjectLens/src-tauri/icons'
    public = '/Users/sumihiro/projects/ProjectLens/src/public'
    
    generate_icons(source, tauri_icons, public)
