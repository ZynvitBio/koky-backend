'use strict';

// 1. Definimos una memoria temporal fuera de la función para rastrear mensajes ya procesados
const mensajesProcesados = new Set();

module.exports = {
  async afterCreate(event) {
    const { result } = event;

    // 2. FILTRO ANTI-DUPLICADOS: Si el ID del mensaje ya se procesó hace poco, ignoramos el reintento de Strapi
    if (mensajesProcesados.has(result.id)) return;

    if (result.sender === 'Agent') {
      // Marcamos este mensaje como "en proceso"
      mensajesProcesados.add(result.id);
      
      // Limpiamos la memoria del ID después de 10 segundos para mantener el Set ligero
      setTimeout(() => mensajesProcesados.delete(result.id), 10000);

      const chatConUsuario = await strapi.entityService.findOne('api::chat.chat', result.id, {
        populate: ['users_permissions_user'],
      });

      const usuario = chatConUsuario ? chatConUsuario['users_permissions_user'] : null;
      
      if (!usuario) {
        console.error('❌ [LIFECYCLE] Error: Usuario no asociado al mensaje ID:', result.id);
        return;
      }

      const mensajeTexto = result.message;
      // Saneamos el ID: solo números para evitar errores de Meta (131009)
      const rawId = usuario.whatsapp_id || usuario.username; 
      const idExterno = rawId.replace(/\D/g, ''); 
      const emailUser = usuario.email || '';

      try {
        if (emailUser.includes('wa.koky')) {
          // Envío a WhatsApp
          await strapi.service('api::whatsapp.whatsapp').sendText(idExterno, mensajeTexto);
        } else if (emailUser.includes('instagram.koky') || emailUser.includes('facebook.koky')) {
          // Envío a Instagram o Messenger
          await strapi.service('api::whatsapp.whatsapp').sendDirectMessage(idExterno, mensajeTexto);
        }
      } catch (error) {
        // Solo dejamos el log de error crítico por si la API de Meta falla
        console.error('❌ [LIFECYCLE] Error en envío a Meta:', error.message);
      }
    }
  },
};