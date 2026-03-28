'use strict';

module.exports = {
  async afterCreate(event) {
    const { result } = event;

    // Solo actuamos si el mensaje lo escribió un 'Agent' desde tu panel Angular
    if (result.sender === 'Agent') {
      const chatConUsuario = await strapi.entityService.findOne('api::chat.chat', result.id, {
        populate: ['users_permissions_user'],
      });

      const usuario = chatConUsuario ? chatConUsuario['users_permissions_user'] : null;
      if (!usuario) return;

      const mensajeTexto = result.message;
      const idExterno = usuario.whatsapp_id || usuario.username; 
      const emailUser = usuario.email || '';

      try {
        // IMPORTANTE: Como ambas funciones están en services/whatsapp.js
        // llamamos siempre a strapi.service('api::whatsapp.whatsapp')
        
        if (emailUser.includes('wa.koky')) {
          // Llama a sendText en services/whatsapp.js
          await strapi.service('api::whatsapp.whatsapp').sendText(idExterno, mensajeTexto);
        } else if (emailUser.includes('instagram.koky') || emailUser.includes('facebook.koky')) {
          // Llama a sendDirectMessage en services/whatsapp.js
          await strapi.service('api::whatsapp.whatsapp').sendDirectMessage(idExterno, mensajeTexto);
        }
      } catch (error) {
        console.error('❌ Error en el puente de salida:', error.message);
      }
    }
  },
};