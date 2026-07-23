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
    let idExterno = '';
    const emailUser = usuario.email || '';

    // 1. Si el correo es virtual de Koky, el prefijo contiene el ID/Teléfono exacto (método más confiable)
    if (emailUser.includes('@wa.koky') || emailUser.includes('@instagram.koky') || emailUser.includes('@facebook.koky')) {
      idExterno = emailUser.split('@')[0];
    }

    // 2. Si no es correo virtual o no se resolvió, usamos los campos explícitos de la base de datos
    if (!idExterno) {
      idExterno = usuario.whatsapp_id || usuario.social_id || usuario.username || '';
    }

    try {
      // 3. Determinamos el canal de destino (WhatsApp o Redes Sociales)
      if (emailUser.includes('wa.koky') || usuario.whatsapp_id) {
        // Para WhatsApp: Limpiamos a solo números
        const idLimpio = idExterno.replace(/\D/g, '');
        if (idLimpio) {
          await strapi.service('api::whatsapp.whatsapp').sendText(idLimpio, mensajeTexto);
        } else {
          console.warn('⚠️ Intentando enviar WhatsApp pero el ID de destino quedó vacío.');
        }
        
      } else if (emailUser.includes('instagram.koky') || emailUser.includes('facebook.koky') || usuario.social_id) {
        // Para Redes Sociales: Enviamos directo con el ID social
        await strapi.service('api::whatsapp.whatsapp').sendDirectMessage(idExterno, mensajeTexto);
      }
    } catch (error) {
      console.error('❌ Error en el envío a Meta:', error.message);
      // Si falla, el registro en Strapi ya existe, pero verás el error en los logs de Railway.
    }
  },
};