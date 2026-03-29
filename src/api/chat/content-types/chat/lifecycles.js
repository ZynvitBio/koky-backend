'use strict';

module.exports = {
  async afterCreate(event) {
    const { result } = event;

    // Solo procesamos si el remitente es Agent
    if (result.sender !== 'Agent') return;

    // 1. BLOQUEO DE SEGURIDAD: Si ya se marcó como enviado, no hacemos nada
    if (result.sent_to_meta === true) return;

    // 2. Buscamos el usuario y cargamos los datos necesarios
    const chatConUsuario = await strapi.entityService.findOne('api::chat.chat', result.id, {
      populate: ['users_permissions_user'],
    });

    // Tu línea exacta para evitar errores de undefined
    const usuario = chatConUsuario ? chatConUsuario['users_permissions_user'] : null;
    
    if (!usuario) return;

    // 3. MARCADO DE IDEMPOTENCIA: 
    // Actualizamos el campo ANTES del envío para que el segundo proceso rebote
    await strapi.entityService.update('api::chat.chat', result.id, {
      // @ts-ignore
      data: { sent_to_meta: true },
    });

    const mensajeTexto = result.message;
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
  },
};