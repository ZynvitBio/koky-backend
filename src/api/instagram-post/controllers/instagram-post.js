'use strict';

/**
 * instagram-post controller
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const axios = require('axios');

async function getInstagramBusinessId(token) {
  try {
    const res = await axios.get(`https://graph.facebook.com/v21.0/me/accounts?fields=id,name,instagram_business_account&access_token=${token}`);
    if (res.data?.data?.[0]?.instagram_business_account?.id) {
      return res.data.data[0].instagram_business_account.id;
    }
  } catch (e) {
    try {
      const pageRes = await axios.get(`https://graph.facebook.com/v21.0/me?fields=id,name,instagram_business_account&access_token=${token}`);
      if (pageRes.data?.instagram_business_account?.id) {
        return pageRes.data.instagram_business_account.id;
      }
    } catch (e2) {
      // ignore
    }
  }
  return '17841476077618408'; // ID oficial de la cuenta de Instagram de Koky Food
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getFfmpegExecutable() {
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      return ffmpegStatic;
    }
  } catch (e) {
    // ignore
  }
  return 'ffmpeg';
}

async function runReelRenderer({ recipeId, videoFileName, videoUrl }) {
  const publicReelsDir = path.join(process.cwd(), 'public', 'uploads', 'reels');
  const rawCacheDir = path.join(publicReelsDir, 'raw_cache');
  const assetsDir = path.join(process.cwd(), 'public', 'reel-assets');

  fs.mkdirSync(publicReelsDir, { recursive: true });
  fs.mkdirSync(rawCacheDir, { recursive: true });

  const outroPath = path.join(assetsDir, 'videoRecetas.mp4');
  const outroAudioPath = path.join(assetsDir, 'audio1.2.mp3');
  const logoPath = path.join(assetsDir, 'logoBlue20.png');
  const ctaOverlayPath = path.join(assetsDir, 'cta_gradient_overlay.png');

  if (!fs.existsSync(outroPath) || !fs.existsSync(logoPath) || !fs.existsSync(ctaOverlayPath) || !fs.existsSync(outroAudioPath)) {
    throw new Error('Faltan archivos plantilla de Reel en public/reel-assets/');
  }

  // Buscar la receta en el catálogo para obtener su URL de Cloudinary
  const catalogPath = path.join(__dirname, '../../../data/recipes_catalog.json');
  let recipeEntry = null;
  if (fs.existsSync(catalogPath) && recipeId) {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    recipeEntry = catalog.find(r => Number(r.id) === Number(recipeId));
  }

  const paddedId = recipeId ? String(recipeId).padStart(2, '0') : 'custom';
  const outFileName = `recipe_${paddedId}_Reel.mp4`;
  const outPath = path.join(publicReelsDir, outFileName);

  // Si ya fue renderizado previamente en este servidor y pesa > 1MB, reutilizarlo o regenerarlo
  let inputVideoPath = null;

  // 1. Intentar buscar en carpeta local Koky_Videos_Finales (si existe en entorno local Windows)
  const localRawDir = path.resolve(process.cwd(), '..', 'Koky_Videos_Finales');
  if (fs.existsSync(localRawDir) && recipeId) {
    const files = fs.readdirSync(localRawDir);
    const matchFile = files.find(f => f.startsWith(`${paddedId}_`) && f.endsWith('.mp4'));
    if (matchFile) {
      inputVideoPath = path.join(localRawDir, matchFile);
    }
  }

  // 2. Si estamos en Railway (producción) o no está en disco local, descargar el clip base desde Cloudinary
  if (!inputVideoPath) {
    const remoteSourceUrl = (recipeEntry && recipeEntry.video) || videoUrl;
    if (!remoteSourceUrl || !remoteSourceUrl.startsWith('http')) {
      throw new Error(`No se encontró URL de video origen para la receta #${recipeId || videoFileName}`);
    }

    const cachedRawPath = path.join(rawCacheDir, `raw_${paddedId}.mp4`);
    if (!fs.existsSync(cachedRawPath) || fs.statSync(cachedRawPath).size < 10000) {
      const response = await axios.get(remoteSourceUrl, {
        responseType: 'arraybuffer',
        timeout: 60000
      });
      fs.writeFileSync(cachedRawPath, Buffer.from(response.data));
    }
    inputVideoPath = cachedRawPath;
  }

  const ffmpegExe = getFfmpegExecutable();
  const filterComplex = [
    '[0:v]fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,setdar=9/16[v0base];',
    '[2:v]scale=220:-1[logoscale];',
    '[v0base][logoscale]overlay=W-w-50:60[v0];',
    '[0:a]aformat=sample_rates=48000:channel_layouts=stereo[a0];',
    '[1:v]fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,setdar=9/16[v1base];',
    '[v1base][3:v]overlay=0:0[v1];',
    '[4:a]aformat=sample_rates=48000:channel_layouts=stereo[a1];',
    '[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]'
  ].join('');

  const ffmpegArgs = [
    '-y',
    '-i', inputVideoPath,
    '-i', outroPath,
    '-i', logoPath,
    '-i', ctaOverlayPath,
    '-i', outroAudioPath,
    '-filter_complex', filterComplex,
    '-map', '[outv]',
    '-map', '[outa]',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '21',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    outPath
  ];

  await new Promise((resolve, reject) => {
    execFile(ffmpegExe, ffmpegArgs, { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(stderr ? stderr.slice(-500) : error.message));
      }
      resolve();
    });
  });

  const stats = fs.statSync(outPath);
  const sizeMb = Number((stats.size / (1024 * 1024)).toFixed(2));

  return {
    success: true,
    fileName: outFileName,
    sizeMb,
    duration: 18.75
  };
}

let lastSyncTime = 0;
const SYNC_CACHE_MS = 2 * 60 * 1000; // 2 minutos de caché para evitar sobrecargar la Graph API

function normalizeText(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

async function syncInstagramPostsFromMeta(strapi, force = false) {
  const now = Date.now();
  if (!force && (now - lastSyncTime < SYNC_CACHE_MS)) {
    return;
  }

  const token = process.env.MESSENGER_PAGE_TOKEN;
  if (!token) {
    return;
  }

  try {
    const catalogPath = path.join(__dirname, '../../../data/recipes_catalog.json');
    if (!fs.existsSync(catalogPath)) {
      strapi.log.warn('[Instagram Sync] No se encontró recipes_catalog.json en:', catalogPath);
      return;
    }
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

    const igUserId = await getInstagramBusinessId(token);
    const res = await axios.get(
      `https://graph.facebook.com/v21.0/${igUserId}/media?fields=id,caption,media_type,timestamp,permalink&limit=100&access_token=${token}`,
      { timeout: 12000 }
    );
    const mediaList = res.data?.data || [];

    // Obtener posts existentes en Strapi
    let existingPosts = [];
    try {
      existingPosts = await strapi.db.query('api::instagram-post.instagram-post').findMany({
        select: ['id', 'recipe_id', 'instagram_media_id']
      });
    } catch (e) {
      existingPosts = [];
    }

    const existingRecipeIds = new Set(
      existingPosts.filter(p => p.recipe_id).map(p => Number(p.recipe_id))
    );
    const existingMediaIds = new Set(
      existingPosts.filter(p => p.instagram_media_id).map(p => String(p.instagram_media_id))
    );

    for (const m of mediaList) {
      if (!m.caption) continue;
      const normCaption = normalizeText(m.caption);

      for (const r of catalog) {
        const normTitle = normalizeText(r.title);
        const prefix = normTitle.slice(0, Math.min(20, normTitle.length));

        if (normCaption.includes(normTitle) || (prefix.length >= 10 && normCaption.includes(prefix))) {
          const recId = Number(r.id);
          const mediaId = String(m.id);

          if (!existingRecipeIds.has(recId) && !existingMediaIds.has(mediaId)) {
            try {
              await strapi.db.query('api::instagram-post.instagram-post').create({
                data: {
                  caption: m.caption,
                  hashtags: '',
                  post_status: 'published',
                  published_date: new Date(m.timestamp),
                  recipe_id: recId,
                  instagram_media_id: mediaId,
                  publishedAt: new Date(m.timestamp),
                  createdAt: new Date(m.timestamp),
                  updatedAt: new Date()
                }
              });
              existingRecipeIds.add(recId);
              existingMediaIds.add(mediaId);
              strapi.log.info(`[Instagram Sync] Receta #${recId} (${r.title}) sincronizada con IG Media ID ${mediaId}`);
            } catch (errCreate) {
              strapi.log.warn(`[Instagram Sync] Error guardando receta #${recId}:`, errCreate.message);
            }
          }
          break;
        }
      }
    }

    lastSyncTime = Date.now();
  } catch (syncErr) {
    strapi.log.warn('[Instagram Sync] Error al sincronizar con Meta:', syncErr.message);
  }
}

module.exports = createCoreController('api::instagram-post.instagram-post', ({ strapi }) => ({
  async renderReel(ctx) {
    try {
      const { recipeId, videoFileName, videoUrl } = ctx.request.body || {};

      if (!recipeId && !videoFileName) {
        return ctx.badRequest('Se requiere recipeId o videoFileName');
      }

      const result = await runReelRenderer({ recipeId, videoFileName, videoUrl });

      const host = ctx.request.header.host || 'localhost:1337';
      const protocol = ctx.request.header['x-forwarded-proto'] || (ctx.request.secure ? 'https' : 'http');
      const serverUrl = process.env.PUBLIC_URL || `${protocol}://${host}`;
      const reelRelativePath = `/uploads/reels/${result.fileName}`;
      const reelUrl = `${serverUrl}${reelRelativePath}`;

      return ctx.send({
        success: true,
        fileName: result.fileName,
        reelUrl: reelUrl,
        duration: result.duration || 18.75,
        sizeMb: result.sizeMb,
        message: 'Reel 9:16 generado con éxito con cierre y audio continuo.'
      });
    } catch (err) {
      strapi.log.error('renderReel Error:', err);
      return ctx.internalServerError(err.message || 'Error procesando el video del Reel.');
    }
  },

  async publishToInstagram(ctx) {
    try {
      const { caption, hashtags, videoUrl, scheduledDate, recipeId, videoMode } = ctx.request.body || {};

      if (!videoUrl && !recipeId) {
        return ctx.badRequest('Se requiere la URL del video (videoUrl) o recipeId para publicar el Reel.');
      }

      const fullCaption = `${caption || ''}\n\n${hashtags || ''}`.trim();
      const token = process.env.MESSENGER_PAGE_TOKEN;

      if (!token) {
        return ctx.badRequest('No se encontró el token de acceso de Instagram (MESSENGER_PAGE_TOKEN).');
      }

      const igUserId = await getInstagramBusinessId(token);
      strapi.log.info(`[Instagram Publisher] Iniciando publicación de Reel hacia IG Business ID: ${igUserId} (Modo: ${videoMode || 'auto'})`);

      const relativePath = (videoUrl || '').replace(/^https?:\/\/[^\/]+/, '');
      const wantsOutroReel = videoMode === 'outro' || (!videoMode && relativePath.includes('/uploads/reels/'));

      let localFilePath = path.join(process.cwd(), 'public', relativePath.startsWith('/') ? relativePath.slice(1) : relativePath);
      let isLocalFile = wantsOutroReel && relativePath.includes('/uploads/reels/') && fs.existsSync(localFilePath) && fs.statSync(localFilePath).isFile();

      // Si el usuario eligió el modo con cierre del recetario y voz ('outro') y aún no está ensamblado en disco, ensamblarlo ahora:
      if (wantsOutroReel && !isLocalFile && recipeId) {
        strapi.log.info(`[Instagram Publisher] Modo Cierre 9:16 seleccionado. Ensamblando Reel 9:16 (Receta #${recipeId} + Logo + Cierre Recetario + Audio)...`);
        const rendered = await runReelRenderer({ recipeId, videoUrl });
        localFilePath = path.join(process.cwd(), 'public', 'uploads', 'reels', rendered.fileName);
        isLocalFile = fs.existsSync(localFilePath) && fs.statSync(localFilePath).isFile();
      }

      // Si el usuario eligió el modo Video Original ('original'), asegurar que usemos la URL original limpia de Cloudinary:
      let targetOriginalUrl = videoUrl;
      if (!wantsOutroReel && recipeId && (!targetOriginalUrl || targetOriginalUrl.includes('/uploads/reels/'))) {
        const catalogPath = path.join(__dirname, '../../../data/recipes_catalog.json');
        if (fs.existsSync(catalogPath)) {
          const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
          const found = catalog.find(r => Number(r.id) === Number(recipeId));
          if (found && found.video) {
            targetOriginalUrl = found.video;
          }
        }
      }

      let creationId = null;

      if (isLocalFile) {
        // --- MÉTODO 1: Subida binaria directa a Meta (Resumable Upload) ---
        // Permite subir el video directamente a Meta sin depender de URLs públicas externas
        const stats = fs.statSync(localFilePath);
        const fileSize = stats.size;
        strapi.log.info(`[Instagram Publisher] Archivo local detectado (${localFilePath}, ${fileSize} bytes). Iniciando subida directa a Meta.`);

        const startRes = await axios.post(
          `https://graph.facebook.com/v21.0/${igUserId}/media`,
          {
            upload_type: 'resumable',
            media_type: 'REELS',
            caption: fullCaption,
            share_to_feed: true,
            access_token: token
          }
        );

        creationId = startRes.data?.id;
        const uploadUri = startRes.data?.uri;

        if (!creationId || !uploadUri) {
          throw new Error('Meta no devolvió los parámetros de subida directa (id / uri).');
        }

        strapi.log.info(`[Instagram Publisher] Subiendo binario del video a Meta (${uploadUri})...`);
        const videoBuffer = fs.readFileSync(localFilePath);

        await axios.post(uploadUri, videoBuffer, {
          headers: {
            'Authorization': `OAuth ${token}`,
            'offset': '0',
            'file_size': String(fileSize),
            'Content-Type': 'application/octet-stream'
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity
        });

        strapi.log.info(`[Instagram Publisher] Binario transferido exitosamente a Meta. ID de Contenedor: ${creationId}`);

      } else {
        // --- MÉTODO 2: Descarga por URL pública de Meta ---
        let publicVideoUrl = targetOriginalUrl || videoUrl;
        if (publicVideoUrl.includes('localhost') || publicVideoUrl.includes('127.0.0.1')) {
          const publicBase = process.env.PUBLIC_URL || 'https://koky-backend-production.up.railway.app';
          publicVideoUrl = publicVideoUrl.replace(/http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, publicBase);
        }

        strapi.log.info(`[Instagram Publisher] Solicitando a Meta descargar video desde URL: ${publicVideoUrl}`);

        const containerPayload = {
          media_type: 'REELS',
          video_url: publicVideoUrl,
          caption: fullCaption,
          share_to_feed: true,
          access_token: token
        };

        const containerRes = await axios.post(
          `https://graph.facebook.com/v21.0/${igUserId}/media`,
          containerPayload
        );

        creationId = containerRes.data?.id;
      }

      if (!creationId) {
        throw new Error('Meta no devolvió un ID de contenedor válido para el Reel.');
      }

      strapi.log.info(`[Instagram Publisher] Contenedor creado en Meta (ID: ${creationId}). Esperando procesamiento...`);

      // 2. Esperar a que Meta procese el video
      let status = 'IN_PROGRESS';
      let attempts = 0;
      const maxAttempts = 15;

      while (status === 'IN_PROGRESS' && attempts < maxAttempts) {
        await sleep(3000);
        attempts++;

        try {
          const statusRes = await axios.get(
            `https://graph.facebook.com/v21.0/${creationId}?fields=status_code,status&access_token=${token}`
          );
          status = statusRes.data?.status_code || statusRes.data?.status;
          strapi.log.info(`[Instagram Publisher] Estado del contenedor (${attempts}/${maxAttempts}): ${status}`);
        } catch (statusErr) {
          strapi.log.warn('[Instagram Publisher] Advertencia consultando estado de contenedor:', statusErr.message);
        }
      }

      if (status !== 'FINISHED' && status !== 'READY') {
        if (status === 'ERROR') {
          throw new Error('Meta reportó un error al procesar el archivo de video. Verifica que la URL del video sea accesible públicamente por HTTPS.');
        } else if (status === 'EXPIRED') {
          throw new Error('El contenedor del video expiró en Meta.');
        } else {
          strapi.log.warn(`[Instagram Publisher] El video sigue procesándose en Meta después de ${attempts * 3}s.`);
        }
      }

      // 3. Publicar el contenedor en Instagram
      strapi.log.info(`[Instagram Publisher] Publicando contenedor ${creationId}...`);
      const publishRes = await axios.post(
        `https://graph.facebook.com/v21.0/${igUserId}/media_publish`,
        {
          creation_id: creationId,
          access_token: token
        }
      );

      const igMediaId = publishRes.data?.id;
      strapi.log.info(`[Instagram Publisher] ¡Reel publicado con éxito en Instagram! Media ID: ${igMediaId}`);

      // 4. Guardar registro en Strapi
      let postEntry = null;
      try {
        postEntry = await strapi.db.query('api::instagram-post.instagram-post').create({
          data: {
            caption: fullCaption,
            hashtags: hashtags || '',
            post_status: 'published',
            published_date: new Date(),
            recipe_id: recipeId ? Number(recipeId) : null,
            instagram_media_id: igMediaId || creationId,
            publishedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        });
      } catch (dbErr) {
        strapi.log.warn('[Instagram Publisher] No se pudo guardar el registro en la base de datos:', dbErr.message);
      }

      return ctx.send({
        success: true,
        message: '¡Reel publicado exitosamente en tu perfil de Instagram @koky.food!',
        igMediaId: igMediaId,
        postId: postEntry?.id || null,
        recipeId: recipeId ? Number(recipeId) : null
      });

    } catch (err) {
      const metaError = err.response?.data?.error;
      strapi.log.error('[Instagram Publisher Error]:', metaError || err.message);
      return ctx.badRequest(
        metaError?.message || err.message || 'Error al conectar y publicar en Instagram.'
      );
    }
  },

  async getPublishedRecipes(ctx) {
    try {
      // Auto-sincronizar con Instagram Meta Graph API en segundo plano o si no se ha sincronizado
      await syncInstagramPostsFromMeta(strapi);

      let posts = [];
      try {
        posts = await strapi.db.query('api::instagram-post.instagram-post').findMany({
          where: {
            post_status: 'published'
          },
          orderBy: { published_date: 'desc' },
          limit: 500
        });
      } catch (err1) {
        posts = await strapi.documents('api::instagram-post.instagram-post').findMany({
          filters: {
            post_status: 'published'
          },
          limit: 500
        });
      }

      return ctx.send({
        success: true,
        data: posts || []
      });
    } catch (err) {
      strapi.log.error('getPublishedRecipes Error:', err);
      return ctx.send({
        success: true,
        data: []
      });
    }
  },

  async syncInstagram(ctx) {
    try {
      await syncInstagramPostsFromMeta(strapi, true);
      let posts = [];
      try {
        posts = await strapi.db.query('api::instagram-post.instagram-post').findMany({
          where: {
            post_status: 'published'
          },
          orderBy: { published_date: 'desc' },
          limit: 500
        });
      } catch (e) {
        posts = [];
      }

      return ctx.send({
        success: true,
        message: 'Sincronización con Instagram completada exitosamente.',
        data: posts || []
      });
    } catch (err) {
      strapi.log.error('syncInstagram Error:', err);
      return ctx.internalServerError(err.message || 'Error sincronizando con Instagram.');
    }
  }
}));
