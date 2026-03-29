'use strict';

module.exports = {
  async afterCreate(event) {
    const { result } = event;

    // 1. LOG DE ENTRADA AL CICLO
    console.log(`--- [LIFECYCLE] Nuevo mensaje detectado: ID ${result.id}, Sender: ${result.sender} ---`);

    if (result.sender === 'Agent') {
      console.log(`[LIFECYCLE] Procesando mensaje de AGENT para el usuario...`);

      const chatConUsuario = await strapi.entityService.findOne('api::chat.chat', result.id, {
        populate: ['users_permissions_user'],
      });

      const usuario = chatConUsuario ? chatConUsuario['users_permissions_user'] : null;
      
      if (!usuario) {
        console.error('❌ [LIFECYCLE] ERROR: No se encontró usuario asociado al chat.');
        return;
      }

      const mensajeTexto = result.message;
      const idExterno = usuario.whatsapp_id || usuario.username; 
      const emailUser = usuario.email || '';

      console.log(`[LIFECYCLE] Datos destino: ID ${idExterno}, Email: ${emailUser}`);

      try {
        if (emailUser.includes('wa.koky')) {
          console.log(`[LIFECYCLE] Intentando enviar a WHATSAPP vía Service...`);
          await strapi.service('api::whatsapp.whatsapp').sendText(idExterno, mensajeTexto);
          console.log(`✅ [LIFECYCLE] Service sendText ejecutado.`);
        } else if (emailUser.includes('instagram.koky') || emailUser.includes('facebook.koky')) {
          console.log(`[LIFECYCLE] Intentando enviar a REDES vía Service...`);
          await strapi.service('api::whatsapp.whatsapp').sendDirectMessage(idExterno, mensajeTexto);
          console.log(`✅ [LIFECYCLE] Service sendDirectMessage ejecutado.`);
        } else {
          console.log(`⚠️ [LIFECYCLE] El email no coincide con dominios Koky. No se envía nada.`);
        }
      } catch (error) {
        console.error('❌ [LIFECYCLE] Error Crítico en el puente de salida:', error.message);
      }
    } else {
      console.log(`[LIFECYCLE] Mensaje ignorado (no es Agent).`);
    }
  },
};