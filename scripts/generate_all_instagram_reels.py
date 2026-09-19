import os
import sys
import glob
import time
import subprocess
import argparse
import imageio_ffmpeg

def process_reel(recipe_path, outro_path, outro_audio_path, output_path, ffmpeg_exe):
    # Overlay CTA text over the outro video without any background box
    font_path = r"C\:/Windows/Fonts/impact.ttf"
    cta_filter = (
        f"drawtext=fontfile='{font_path}':text='¿QUIERES EL RECETARIO COMPLETO?':fontcolor=white:fontsize=52:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-500,"
        f"drawtext=fontfile='{font_path}':text='Comenta RECETA y te enviamos el link':fontcolor=0x4ADE80:fontsize=54:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-420"
    )

    if outro_audio_path and os.path.exists(outro_audio_path):
        filter_complex = (
            "[0:v]fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,setdar=9/16[v0];"
            "[0:a]aformat=sample_rates=48000:channel_layouts=stereo[a0];"
            f"[1:v]fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,setdar=9/16,{cta_filter}[v1];"
            "[2:a]aformat=sample_rates=48000:channel_layouts=stereo[a1];"
            "[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]"
        )
        inputs = ['-i', recipe_path, '-i', outro_path, '-i', outro_audio_path]
    else:
        filter_complex = (
            "[0:v]fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,setdar=9/16[v0];"
            "[0:a]aformat=sample_rates=48000:channel_layouts=stereo[a0];"
            f"[1:v]fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,setdar=9/16,{cta_filter}[v1];"
            "[1:a]aformat=sample_rates=48000:channel_layouts=stereo[a1];"
            "[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]"
        )
        inputs = ['-i', recipe_path, '-i', outro_path]

    cmd = [
        ffmpeg_exe, '-y',
        *inputs,
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

    if not os.path.exists(outro_path):
        print(f"Error: No se encontro el video de cierre en {outro_path}")
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(public_reels_dir, exist_ok=True)
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
        ok, err = process_reel(r_path, outro_path, outro_audio_path, out_path, ffmpeg_exe)
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
