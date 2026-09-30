import os
import sys
import glob
import time
import subprocess
import argparse
import imageio_ffmpeg

from PIL import Image, ImageDraw, ImageFont

def ensure_cta_overlay(output_path):
    if os.path.exists(output_path):
        return output_path

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    img = Image.new('RGBA', (1080, 1920), (0, 0, 0, 0))

    font_path = r"C:\Windows\Fonts\impact.ttf"
    font_top = ImageFont.truetype(font_path, 52)
    font_bot = ImageFont.truetype(font_path, 54)

    # 1. Line 1: ¿QUIERES EL RECETARIO COMPLETO? (03262C -> 097484)
    text1 = '¿QUIERES EL RECETARIO COMPLETO?'
    color1_top = (3, 38, 44)       # #03262C
    color1_bot = (9, 116, 132)     # #097484

    # 2. Line 2: Comenta RECETA y te enviamos el link (117604 -> 5BB817)
    text2 = 'Comenta RECETA y te enviamos el link'
    color2_top = (17, 118, 4)      # #117604
    color2_bot = (91, 184, 23)     # #5BB817

    def render_gradient_text(text, font, c_top, c_bot, stroke_w=3, stroke_c=(255, 255, 255, 245)):
        dummy = Image.new('RGBA', (1200, 300), (0, 0, 0, 0))
        d = ImageDraw.Draw(dummy)
        bbox = d.textbbox((0, 0), text, font=font, stroke_width=stroke_w)
        w = bbox[2] - bbox[0] + 30
        h = bbox[3] - bbox[1] + 30

        mask = Image.new('L', (w, h), 0)
        d_mask = ImageDraw.Draw(mask)
        d_mask.text((15 - bbox[0], 15 - bbox[1]), text, font=font, fill=255)

        grad = Image.new('RGBA', (w, h))
        for y in range(h):
            fac = y / max(h - 1, 1)
            r = int(c_top[0] + (c_bot[0] - c_top[0]) * fac)
            g = int(c_top[1] + (c_bot[1] - c_top[1]) * fac)
            b = int(c_top[2] + (c_bot[2] - c_top[2]) * fac)
            for x in range(w):
                grad.putpixel((x, y), (r, g, b, 255))

        res = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        d_res = ImageDraw.Draw(res)
        d_res.text((15 - bbox[0], 15 - bbox[1]), text, font=font, stroke_width=stroke_w, stroke_fill=stroke_c)

        glyph = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        glyph.paste(grad, (0, 0), mask)
        res.alpha_composite(glyph)
        return res

    t1_img = render_gradient_text(text1, font_top, color1_top, color1_bot, stroke_w=3, stroke_c=(255, 255, 255, 245))
    t2_img = render_gradient_text(text2, font_bot, color2_top, color2_bot, stroke_w=3, stroke_c=(255, 255, 255, 245))

    x1 = (1080 - t1_img.width) // 2
    y1 = 1920 - 520

    x2 = (1080 - t2_img.width) // 2
    y2 = 1920 - 435

    img.alpha_composite(t1_img, (x1, y1))
    img.alpha_composite(t2_img, (x2, y2))
    img.save(output_path, 'PNG')
    return output_path

def process_reel(recipe_path, outro_path, outro_audio_path, logo_path, cta_overlay_path, output_path, ffmpeg_exe):
    has_logo = logo_path and os.path.exists(logo_path)
    has_audio = outro_audio_path and os.path.exists(outro_audio_path)

    # Input 0: recipe video
    # Input 1: outro video
    input_files = [recipe_path, outro_path]
    filter_parts = []

    # Process recipe video [0:v] (with logo if present)
    if has_logo:
        logo_idx = len(input_files)
        input_files.append(logo_path)
        filter_parts.append(
            f"[0:v]fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,setdar=9/16[v0base];"
            f"[{logo_idx}:v]scale=220:-1[logoscale];"
            f"[v0base][logoscale]overlay=W-w-50:60[v0];"
        )
    else:
        filter_parts.append("[0:v]fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,setdar=9/16[v0];")

    filter_parts.append("[0:a]aformat=sample_rates=48000:channel_layouts=stereo[a0];")

    # Process outro video [1:v] (with CTA gradient overlay)
    cta_idx = len(input_files)
    input_files.append(cta_overlay_path)
    filter_parts.append(
        f"[1:v]fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,setdar=9/16[v1base];"
        f"[v1base][{cta_idx}:v]overlay=0:0[v1];"
    )

    # Process audio
    if has_audio:
        audio_idx = len(input_files)
        input_files.append(outro_audio_path)
        filter_parts.append(f"[{audio_idx}:a]aformat=sample_rates=48000:channel_layouts=stereo[a1];")
    else:
        filter_parts.append("[1:a]aformat=sample_rates=48000:channel_layouts=stereo[a1];")

    filter_parts.append("[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]")
    filter_complex = "".join(filter_parts)

    cmd_inputs = []
    for f in input_files:
        cmd_inputs.extend(['-i', f])

    cmd = [
        ffmpeg_exe, '-y',
        *cmd_inputs,
        '-filter_complex', filter_complex,
        '-map', '[outv]',
        '-map', '[outa]',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '20',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        output_path
    ]

    res = subprocess.run(cmd, capture_output=True, text=True)
    return res.returncode == 0, res.stderr

def main():
    parser = argparse.ArgumentParser(description="Concatenar videos de recetas con el cierre del recetario para Instagram Reels.")
    parser.add_argument('--limit', type=int, default=0, help="Limite de videos a procesar (0 = todos)")
    parser.add_argument('--force', action='store_true', help="Sobrescribir videos existentes")
    parser.add_argument('--file', type=str, default="", help="Nombre de archivo o patron especifico a procesar")
    parser.add_argument('--recipe-id', type=int, default=0, help="ID especifico de la receta a procesar (1..100)")
    args = parser.parse_args()

    base_dir = r"C:\Users\a-sap\OneDrive\Escritorio\Koky_full"
    input_dir = os.path.join(base_dir, "Koky_Videos_Finales")
    output_dir = os.path.join(base_dir, "Koky_Videos_Instagram")
    public_reels_dir = os.path.join(base_dir, "koky-backend", "public", "uploads", "reels")
    outro_path = os.path.join(input_dir, "videoRecetas.mp4")
    outro_audio_path = os.path.join(output_dir, "audio1.2.mp3")
    logo_path = os.path.join(base_dir, "koky", "src", "assets", "img", "logoBlue20.png")
    cta_overlay_path = os.path.join(public_reels_dir, "cta_gradient_overlay.png")

    if not os.path.exists(outro_path):
        print(f"Error: No se encontro el video de cierre en {outro_path}")
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(public_reels_dir, exist_ok=True)
    ensure_cta_overlay(cta_overlay_path)
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()

    # List all mp4 files excluding outro
    all_files = sorted(glob.glob(os.path.join(input_dir, "*.mp4")))
    recipe_files = [f for f in all_files if os.path.basename(f).lower() != "videorecetas.mp4"]

    if args.recipe_id > 0:
        prefix = f"{args.recipe_id:02d}_"
        recipe_files = [f for f in recipe_files if os.path.basename(f).startswith(prefix) or f"recipe_{args.recipe_id}" in f]
    elif args.file:
        recipe_files = [f for f in recipe_files if args.file.lower() in os.path.basename(f).lower()]
    elif args.limit > 0:
        recipe_files = recipe_files[:args.limit]

    total = len(recipe_files)

    print(f"=== INICIANDO PROCESAMIENTO DE {total} VIDEOS PARA INSTAGRAM ===")
    print(f"Directorio de Entrada: {input_dir}")
    print(f"Directorio de Salida:  {output_dir}")
    print(f"Video de Cierre:       {outro_path}")
    print(f"Audio de Cierre:       {outro_audio_path}")
    print(f"Logo Superior:         {logo_path} (Existe: {os.path.exists(logo_path)})")
    print(f"Overlay CTA:           {cta_overlay_path}")
    print("=" * 60)

    success_count = 0
    start_total_time = time.time()

    for idx, r_path in enumerate(recipe_files, 1):
        filename = os.path.basename(r_path)
        name_no_ext = os.path.splitext(filename)[0]
        out_filename = f"{name_no_ext}_Reel.mp4"
        out_path = os.path.join(output_dir, out_filename)

        if os.path.exists(out_path) and not args.force:
            print(f"[{idx}/{total}] Omitiendo (ya existe): {out_filename}")
            success_count += 1
            continue

        print(f"[{idx}/{total}] Procesando: {filename} ...", end="", flush=True)
        t0 = time.time()
        ok, err = process_reel(r_path, outro_path, outro_audio_path, logo_path, cta_overlay_path, out_path, ffmpeg_exe)
        elapsed = time.time() - t0

        if ok:
            import shutil
            shutil.copy2(out_path, os.path.join(public_reels_dir, out_filename))
            size_mb = os.path.getsize(out_path) / (1024 * 1024)
            print(f" OK ({elapsed:.1f}s, {size_mb:.1f} MB)")
            print(f"JSON_OUTPUT: {{\"success\": true, \"fileName\": \"{out_filename}\", \"sizeMb\": {size_mb:.2f}, \"duration\": 18.75}}")
            success_count += 1
        else:
            print(f" ERROR ({elapsed:.1f}s)")
            print(err[-500:])

    total_elapsed = time.time() - start_total_time
    print("=" * 60)
    print(f"PROCESAMIENTO COMPLETADO: {success_count}/{total} videos generados exitosamente.")
    print(f"Tiempo total transcurrido: {total_elapsed / 60:.1f} minutos.")

if __name__ == "__main__":
    main()
