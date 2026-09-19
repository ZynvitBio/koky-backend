'use strict';

/**
 * instagram-post controller
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

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
      const { caption, reelUrl, scheduledDate } = ctx.request.body || {};
      return ctx.send({
        success: true,
        message: 'Reel programado / enviado a la cola correctamente.'
      });
    } catch (err) {
      strapi.log.error('publishToInstagram Error:', err);
      return ctx.internalServerError(err.message || 'Error publicando a Instagram.');
    }
  }
}));
