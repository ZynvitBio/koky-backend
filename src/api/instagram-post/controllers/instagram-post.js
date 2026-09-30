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

module.exports = createCoreController('api::instagram-post.instagram-post', ({ strapi }) => ({
  async renderReel(ctx) {
    try {
      const { recipeId, videoFileName } = ctx.request.body || {};

      if (!recipeId && !videoFileName) {
        return ctx.badRequest('Se requiere recipeId o videoFileName');
      }

      const args = ['scripts/generate_all_instagram_reels.py', '--force'];

      if (recipeId) {
        args.push('--recipe-id', String(recipeId));
      } else if (videoFileName) {
        args.push('--file', videoFileName);
      }

      const result = await new Promise((resolve, reject) => {
        execFile('python', args, { cwd: process.cwd() }, (error, stdout, stderr) => {
          if (error) {
            strapi.log.error('Error renderizando Reel:', stderr || error.message);
            return reject(new Error(stderr || error.message));
          }

          // Parse JSON_OUTPUT from stdout
          const match = stdout.match(/JSON_OUTPUT:\s*(\{.*\})/);
          if (match) {
            try {
              const data = JSON.parse(match[1]);
              return resolve(data);
            } catch (e) {
              // fallback
            }
          }

          resolve({ success: true, stdout });
        });
      });

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
      const { caption, hashtags, videoUrl, scheduledDate, recipeId } = ctx.request.body || {};

      if (!videoUrl) {
        return ctx.badRequest('Se requiere la URL del video (videoUrl) para publicar el Reel.');
      }

      const fullCaption = `${caption || ''}\n\n${hashtags || ''}`.trim();
      const token = process.env.MESSENGER_PAGE_TOKEN;

      if (!token) {
        return ctx.badRequest('No se encontró el token de acceso de Instagram (MESSENGER_PAGE_TOKEN).');
      }

      const igUserId = await getInstagramBusinessId(token);
      strapi.log.info(`[Instagram Publisher] Iniciando publicación de Reel hacia IG Business ID: ${igUserId}`);

      // 1. Crear contenedor de Reel en Meta Graph API
      const containerPayload = {
        media_type: 'REELS',
        video_url: videoUrl,
        caption: fullCaption,
        share_to_feed: true,
        access_token: token
      };

      const containerRes = await axios.post(
        `https://graph.facebook.com/v21.0/${igUserId}/media`,
        containerPayload
      );

      const creationId = containerRes.data?.id;
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
        postEntry = await strapi.entityService.create('api::instagram-post.instagram-post', {
          data: {
            caption: fullCaption,
            hashtags: hashtags || '',
            post_status: 'published',
            published_date: new Date(),
            instagram_id: igMediaId || creationId,
            publishedAt: new Date()
          }
        });
      } catch (dbErr) {
        strapi.log.warn('[Instagram Publisher] No se pudo guardar el registro en la base de datos:', dbErr.message);
      }

      return ctx.send({
        success: true,
        message: '¡Reel publicado exitosamente en tu perfil de Instagram @koky.food!',
        igMediaId: igMediaId,
        postId: postEntry?.id || null
      });

    } catch (err) {
      const metaError = err.response?.data?.error;
      strapi.log.error('[Instagram Publisher Error]:', metaError || err.message);
      return ctx.badRequest(
        metaError?.message || err.message || 'Error al conectar y publicar en Instagram.'
      );
    }
  }
}));
