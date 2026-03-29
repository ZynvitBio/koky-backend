'use strict';

module.exports = {
  async afterCreate(event) {
    const { result } = event;
    const time = new Date().toISOString();

    if (result.sender === 'Agent') {
      // ESTE LOG ES VITAL: Nos dirá si Strapi entra aquí una o dos veces por el mismo ID
      console.log(`[AUDITORIA ${time}] Ejecutando afterCreate para ID: ${result.id}`);

      const chatConUsuario = await strapi.entityService.findOne('api::chat.chat', result.id, {
        populate: ['users_permissions_user'],
      });

      const usuario = chatConUsuario?chatConUsuario['users_permissions_user'] : null;
      if (!usuario) return;

      const idExterno = (usuario.whatsapp_id || usuario.username).replace(/\D/g, ''); 
      const emailUser = usuario.email || '';

      try {
        if (emailUser.includes('wa.koky')) {
          console.log(`[AUDITORIA ${time}] Llamando a sendText para ID: ${result.id}`);
          await strapi.service('api::whatsapp.whatsapp').sendText(idExterno, result.message);
          console.log(`[AUDITORIA ${time}] API Meta respondió OK para ID: ${result.id}`);
        } else if (emailUser.includes('instagram.koky') || emailUser.includes('facebook.koky')) {
          console.log(`[AUDITORIA ${time}] Llamando a sendDirectMessage para ID: ${result.id}`);
          await strapi.service('api::whatsapp.whatsapp').sendDirectMessage(idExterno, result.message);
        }
      } catch (error) {
        console.error(`[AUDITORIA ${time}] ERROR en ID ${result.id}:`, error.message);
      }
    }
  },
};