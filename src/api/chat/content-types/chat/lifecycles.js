'use strict';

// Bloqueo de memoria para evitar la doble ejecución del Hook por el mismo ID
const idsEnProceso = new Set();

module.exports = {
  async afterCreate(event) {
    const { result } = event;

    if (result.sender === 'Agent') {
      // 1. Si el ID ya se está procesando en este ciclo, abortamos el duplicado
      if (idsEnProceso.has(result.id)) {
        return;
      }

      // Marcamos el ID como ocupado
      idsEnProceso.add(result.id);

      // Limpiamos el ID después de 10 segundos
      setTimeout(() => idsEnProceso.delete(result.id), 10000);

      const chatConUsuario = await strapi.entityService.findOne('api::chat.chat', result.id, {
        populate: ['users_permissions_user'],
      });

      // 2. Extracción de usuario exactamente como me indicaste para evitar errores
      const usuario = chatConUsuario ? chatConUsuario['users_permissions_user'] : null;
      
      if (!usuario) {
        return;
      }

      const mensajeTexto = result.message;
      // Saneamos el ID: solo números para la API de Meta
      const rawId = usuario.whatsapp_id || usuario.username; 
      const idExterno = rawId.replace(/\D/g, ''); 
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
    }
  },
};