'use strict';

module.exports = {
  async afterCreate(event) {
    const { result } = event;

    if (result.sender !== 'Agent') return;
    if (result.sent_to_meta === true) return;

    const chatConUsuario = await strapi.entityService.findOne('api::chat.chat', result.id, {
      populate: ['users_permissions_user'],
    });

    const usuario = chatConUsuario ? chatConUsuario['users_permissions_user'] : null;
    if (!usuario) return;

    // --- INTENTO DE OBTENER AVATAR (Segundo Plano) ---
    if (!usuario.avatar_url) {
      setImmediate(async () => {
        try {
          const externalId = (usuario.whatsapp_id || usuario.username).replace(/\D/g, '');
          const platform = usuario.email.includes('wa.koky') ? 'whatsapp' : 'messenger';
          
          // Llamamos al servicio (asegúrate que exista o comenta esta línea si quieres probar solo el flujo)
          const profile = await strapi.service('api::whatsapp.whatsapp').getUserProfile(externalId, platform);
          
          if (profile && profile.profile_picture_url) {
            await strapi.entityService.update('plugin::users-permissions.user', usuario.id, {
              data: { avatar_url: profile.profile_picture_url }
            });
            console.log(`✅ Avatar actualizado para el usuario ${usuario.id}`);
          }
        } catch (e) {
          // Fallo silencioso: no queremos que un error de avatar detenga el sistema
        }
      });
    }

    // --- BLOQUEO DE ENVÍO DUPLICADO ---
    await strapi.entityService.update('api::chat.chat', result.id, {
      // @ts-ignore
      data: { sent_to_meta: true },
    });

    const mensajeTexto = result.message;
    const idExterno = (usuario.whatsapp_id || usuario.username).replace(/\D/g, ''); 
    const emailUser = usuario.email || '';

    try {
      if (emailUser.includes('wa.koky')) {
        await strapi.service('api::whatsapp.whatsapp').sendText(idExterno, mensajeTexto);
      } else if (emailUser.includes('instagram.koky') || emailUser.includes('facebook.koky')) {
        await strapi.service('api::whatsapp.whatsapp').sendDirectMessage(idExterno, mensajeTexto);
      }
    } catch (error) {
      console.error('❌ Error en el envío a Meta:', error.message);
    }
  },
};