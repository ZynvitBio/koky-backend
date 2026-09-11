const fs = require('fs');
const path = require('path');

const STRAPI_URL = process.env.STRAPI_URL || 'https://koky-backend-production.up.railway.app';
const STRAPI_TOKEN = process.env.STRAPI_TOKEN || process.argv[2];

const HTML_SOURCE = 'c:/Users/a-sap/OneDrive/Escritorio/Koky_full/recetas_koky_view.html';
const VIDEOS_DIR = 'c:/Users/a-sap/OneDrive/Escritorio/Koky_full/Koky_Videos_Finales';
const THUMBNAILS_DIR = 'c:/Users/a-sap/OneDrive/Escritorio/Koky_full/koky/src/recetas/thumbnails';

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseIngredient(str) {
  str = str.trim();
  const m = str.match(/^([\d\/\.½¼¾]+)\s*(?:de\s+)?(láminas|lámina|tazas|taza|cucharaditas|cucharadita|cucharadas|cucharada|cdtas|cdta|cdas|cda|dientes|diente|tallos|tallo|rodajas|rodaja|pizcas|pizca|litros|litro|gr|g|kg|ml)?\s*(?:de\s+)?(.*)$/i);
  if (m) {
    return {
      quantity: (m[1] || '').trim(),
      unit: (m[2] || '').trim(),
      name: (m[3] || '').trim(),
      note: ''
    };
  }
  return { quantity: '', unit: '', name: str, note: '' };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function uploadFile(filePath, mimeType, maxRetries = 3) {
  if (!fs.existsSync(filePath)) {
    console.warn(`Archivo no encontrado: ${filePath}`);
    return null;
  }

  const fileName = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer], { type: mimeType });

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const formData = new FormData();
      formData.append('files', blob, fileName);

      const res = await fetch(`${STRAPI_URL}/api/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${STRAPI_TOKEN}`
        },
        body: formData
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Status ${res.status}: ${errText}`);
      }

      const json = await res.json();
      return Array.isArray(json) ? json[0] : json;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      console.warn(` (Reintentando subida de ${fileName}, intento ${attempt + 1}/${maxRetries})...`);
      await sleep(2000 * attempt);
    }
  }
}

async function checkRecipeExists(slug) {
  const url = `${STRAPI_URL}/api/recipes?filters[slug][$eq]=${encodeURIComponent(slug)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${STRAPI_TOKEN}`
    }
  });

  if (!res.ok) return false;
  const json = await res.json();
  return json.data && json.data.length > 0;
}

async function createRecipe(recipeData, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${STRAPI_URL}/api/recipes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${STRAPI_TOKEN}`
        },
        body: JSON.stringify({ data: recipeData })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Status ${res.status}: ${errText}`);
      }

      return await res.json();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      console.warn(` (Reintentando guardar receta, intento ${attempt + 1}/${maxRetries})...`);
      await sleep(2000 * attempt);
    }
  }
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('====================================================');
  console.log('MIGRACION MASIVA DE 100 RECETAS A STRAPI + CLOUDINARY');
  console.log(`Destino Strapi: ${STRAPI_URL}`);
  console.log(`Modo: ${isDryRun ? 'DRY-RUN (Simulacion sin escribir)' : 'PRODUCCION EN VIVO'}`);
  console.log('====================================================\n');

  if (!STRAPI_TOKEN && !isDryRun) {
    console.error('ERROR: No se proporciono el STRAPI_TOKEN.');
    console.error('Uso: node scripts/migrate_recipes_to_strapi.js <TU_API_TOKEN>');
    console.error('O ejecuta con --dry-run para simular: node scripts/migrate_recipes_to_strapi.js --dry-run');
    process.exit(1);
  }

  const htmlContent = fs.readFileSync(HTML_SOURCE, 'utf8');
  const start = htmlContent.indexOf('const recipesData = [');
  const end = htmlContent.indexOf('];', start);
  const prefix = 'const recipesData = ';
  const recipes = JSON.parse(htmlContent.substring(start + prefix.length, end + 1));

  console.log(`Se cargaron ${recipes.length} recetas desde el catalogo.\n`);

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (let i = 0; i < recipes.length; i++) {
    const r = recipes[i];
    const indexStr = `[${i + 1}/${recipes.length}]`;
    const slug = slugify(r.title);
    const cleanProduct = r.product ? r.product.split('(')[0].trim() : 'Tofu Artesanal Koky';
    const prepMinutes = parseInt(r.time) || 20;

    console.log(`${indexStr} Procesando: "${r.title}" (Slug: ${slug})`);

    if (isDryRun) {
      console.log(`   Ingredientes: ${r.ingredients.length} items`);
      console.log(`   Pasos: ${r.instructions.length} pasos`);
      console.log(`   Video: ${r.video}`);
      console.log(`   Miniatura: recipe_${r.id}.jpg`);
      console.log('   -> Simulacion exitosa.\n');
      successCount++;
      continue;
    }

    try {
      const exists = await checkRecipeExists(slug);
      if (exists) {
        console.log(`   -> Ya existe en Strapi. Saltando para evitar duplicados.\n`);
        skipCount++;
        continue;
      }

      // 1. Subir miniatura HD a Cloudinary via Strapi
      const thumbPath = path.join(THUMBNAILS_DIR, `recipe_${r.id}.jpg`);
      let thumbMedia = null;
      if (fs.existsSync(thumbPath)) {
        process.stdout.write('   Subiendo miniatura HD...');
        thumbMedia = await uploadFile(thumbPath, 'image/jpeg');
        process.stdout.write(' OK\n');
      }

      // 2. Subir video MP4 a Cloudinary via Strapi
      const videoFileName = path.basename(r.video);
      const videoPath = path.join(VIDEOS_DIR, videoFileName);
      let videoMedia = null;
      let videoCloudinaryUrl = '';
      if (fs.existsSync(videoPath)) {
        process.stdout.write('   Subiendo video MP4...');
        videoMedia = await uploadFile(videoPath, 'video/mp4');
        videoCloudinaryUrl = videoMedia.url || '';
        process.stdout.write(' OK\n');
      }

      // 3. Formatear payload segun esquema de Strapi
      const payload = {
        titulo: r.title,
        slug: slug,
        shortDescription: r.description,
        preparationTimeMinutes: prepMinutes,
        servings: 2,
        cookingTip: `Ideal para preparar con ${cleanProduct} fresco artesanal Koky.`,
        videoUrl: videoCloudinaryUrl,
        published: true,
        ingredients: r.ingredients.map(parseIngredient),
        instructions: r.instructions.map(inst => ({ description: inst.trim() }))
      };

      if (thumbMedia && thumbMedia.id) {
        payload.videoThumbnail = thumbMedia.id;
        payload.mainImage = [thumbMedia.id];
      }

      process.stdout.write('   Guardando receta en Strapi...');
      const created = await createRecipe(payload);
      process.stdout.write(` OK (ID Strapi: ${created.data?.id || created.id})\n\n`);

      successCount++;
      // Pausa de 800ms entre recetas
      await sleep(800);

    } catch (err) {
      console.error(`   ERROR en "${r.title}": ${err.message}\n`);
      errorCount++;
    }
  }

  console.log('====================================================');
  console.log('RESUMEN DE MIGRACION:');
  console.log(`Exitosas: ${successCount}`);
  console.log(`Ya existentes (omitidas): ${skipCount}`);
  console.log(`Errores: ${errorCount}`);
  console.log('====================================================');
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
