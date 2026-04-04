// @ts-nocheck
'use strict';

module.exports = {
  async afterCreate(event) {
    const { result } = event;

    // 1. SEGURIDAD: Solo procesamos mensajes escritos por el 'Agent' (tú o Kira)
    // y evitamos envíos duplicados.
    if (result.sender !== 'Agent') return;
    if (result.sent_to_meta === true) return;

    // 2. BUSCAMOS AL USUARIO: Necesitamos saber a qué número o ID enviar el mensaje.
    const chatConUsuario = await strapi.entityService.findOne('api::chat.chat', result.id, {
      populate: ['users_permissions_user'],
    });

    const usuario = chatConUsuario ? chatConUsuario['users_permissions_user'] : null;
    if (!usuario) return;

    // --- LIMPIEZA: Se eliminó el bloque de obtención de avatar para WhatsApp ---
    // Esto evita errores 400 innecesarios y hace el envío más rápido.

    // 3. MARCACIÓN: Marcamos como enviado para que Strapi no lo procese dos veces.
    await strapi.entityService.update('api::chat.chat', result.id, {
      // @ts-ignore
      data: { sent_to_meta: true },
    });

    const mensajeTexto = result.message;
    let idExterno;
    const emailUser = usuario.email || '';

    try {
      if (emailUser.includes('wa.koky')) {
        // Para WhatsApp: Solo números
        idExterno = (usuario.whatsapp_id || usuario.username).replace(/\D/g, ''); 
        await strapi.service('api::whatsapp.whatsapp').sendText(idExterno, mensajeTexto);
        
      } else if (emailUser.includes('instagram.koky') || emailUser.includes('facebook.koky')) {
        // Para Redes Sociales: El ID de Meta (social_id) SIN limpiar números
        // Usamos el username o social_id que guardamos originalmente
        idExterno = usuario.social_id || usuario.username; 
        
        await strapi.service('api::whatsapp.whatsapp').sendDirectMessage(idExterno, mensajeTexto);
      }
    } catch (error) {
      console.error('❌ Error en el envío a Meta:', error.message);
      // Si falla, el registro en Strapi ya existe, pero verás el error en los logs de Railway.
    }
  },
};