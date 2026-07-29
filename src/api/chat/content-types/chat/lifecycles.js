// @ts-nocheck
'use strict';

module.exports = {
  async afterCreate(event) {
    const { result } = event;

    // 1. NOTIFICACIÓN EN TIEMPO REAL: Emitimos por socket para actualizar el dashboard de inmediato
    try {
      const chatConUsuario = await strapi.entityService.findOne('api::chat.chat', result.id, {
        populate: ['users_permissions_user'],
      });
      const usuario = chatConUsuario ? chatConUsuario['users_permissions_user'] : null;
      if (usuario && strapi.io) {
        strapi.io.emit('new_message', { 
          userId: usuario.id,
          message: result.message,
          sender: result.sender,
          createdAt: result.createdAt
        });
      }
    } catch (socketErr) {
      console.error('❌ Error emitiendo socket en lifecycles:', socketErr.message);
    }

    // 2. SEGURIDAD: Solo procesamos mensajes escritos por el 'Agent' (tú o Kira)
    // y evitamos envíos duplicados.
    if (result.sender !== 'Agent') return;
    if (result.sent_to_meta === true) return;

    // 2. BUSCAMOS AL USUARIO Y ADJUNTOS: Necesitamos saber a qué número o ID enviar el mensaje.
    const chatCompleto = await strapi.entityService.findOne('api::chat.chat', result.id, {
      populate: ['users_permissions_user', 'attachments'],
    });

    const usuario = chatCompleto ? chatCompleto['users_permissions_user'] : null;
    const adjuntos = chatCompleto ? chatCompleto['attachments'] : [];
    if (!usuario) return;

    // Apagar el bot Kira automáticamente ya que el agente humano está interactuando
    if (usuario.kira_active !== false && usuario.kira_active !== 0) {
      await strapi.entityService.update('plugin::users-permissions.user', usuario.id, {
        data: { kira_active: false },
      });
    }

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
          // Enviar mensaje de texto si existe
          if (mensajeTexto) {
            await strapi.service('api::whatsapp.whatsapp').sendText(idLimpio, mensajeTexto);
          }
          // Enviar adjuntos si existen
          if (adjuntos && adjuntos.length > 0) {
            for (const file of adjuntos) {
              const fileUrl = file.url.startsWith('http') 
                ? file.url 
                : `https://koky-backend-production.up.railway.app${file.url}`;
              await strapi.service('api::whatsapp.whatsapp').sendMedia(idLimpio, fileUrl, file.mime, file.name);
            }
          }
        } else {
          console.warn('⚠️ Intentando enviar WhatsApp pero el ID de destino quedó vacío.');
        }
        
      } else if (emailUser.includes('instagram.koky') || emailUser.includes('facebook.koky') || usuario.social_id) {
        // Para Redes Sociales: Enviamos directo con el ID social
        if (mensajeTexto) {
          await strapi.service('api::whatsapp.whatsapp').sendDirectMessage(idExterno, mensajeTexto);
        }
      }
    } catch (error) {
      console.error('❌ Error en el envío a Meta:', error.message);
      // Si falla, el registro en Strapi ya existe, pero verás el error en los logs de Railway.
    }
  },
};