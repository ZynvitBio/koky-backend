'use strict';
const axios = require('axios');

module.exports = ({ strapi }) => ({
  async sendText(to, message) {
    const accessToken = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = "1037050959491352"; 
    const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;

    console.log(`📡 [Servicio WA] Enviando mensaje a: ${to}`);

    try {
      const response = await axios({
        method: "POST",
        url: url,
        data: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: to,
          type: "text",
          text: { preview_url: false, body: message }
        },
        headers: { 
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
      });
      console.log('✅ [Servicio WA] Mensaje entregado a Meta correctamente');
      return response.data;
    } catch (error) {
      console.error("❌ [Servicio WA] Error en API de Meta:", error.response ? error.response.data : error.message);
      throw error;
    }
  },

  async sendDirectMessage(recipientId, message) {
    const accessToken = process.env.MESSENGER_PAGE_TOKEN;
    const url = `https://graph.facebook.com/v21.0/me/messages`;

    console.log(`📡 [Servicio Social] Enviando DM a: ${recipientId}`);

    try {
      const response = await axios.post(
        url,
        {
          recipient: { id: recipientId },
          message: { text: message }
        },
        {
          headers: { 
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log('✅ [Servicio Social] DM enviado correctamente');
      return response.data;
    } catch (error) {
      console.error("❌ [Servicio Social] Error en API de Meta:", error.response ? error.response.data : error.message);
      throw error;
    }
  },

  async getUserProfile(externalId, platform) {
    try {
      const token = process.env.WHATSAPP_TOKEN; 
      
      // LOGICA SOLO PARA WHATSAPP
      if (platform === 'whatsapp') {
        // En WhatsApp Business, la URL de la foto de perfil se puede construir así:
        // https://pps.whatsapp.net/v/t61.2488-24/... (pero requiere un token dinámico)
        // La forma más estable sin descomponer nada es usar el motor de búsqueda de contactos de Meta
        
        console.log(`🔍 [SERVICIO WA] Intentando obtener avatar de WhatsApp para: ${externalId}`);
        
        // Intentamos el endpoint de contacto que es el permitido para WA Business
        const urlWA = `https://graph.facebook.com/v22.0/${externalId}?fields=about,profile_picture_url&access_token=${token}`;
        
        const response = await axios.get(urlWA);
        return {
          profile_picture_url: response.data.profile_picture_url || null
        };
      }

      // LOGICA PARA OTRAS PLATAFORMAS (Se mantiene igual)
      let urlSocial = `https://graph.facebook.com/v19.0/${externalId}?fields=profile_picture_url&access_token=${token}`;
      const responseSocial = await axios.get(urlSocial);
      return {
        profile_picture_url: responseSocial.data.profile_picture_url || null
      };

    } catch (error) {
      // Log más limpio para no llenar Railway de errores si el usuario no tiene foto pública
      console.log(`--- [SERVICIO WA] No se pudo obtener avatar para ${externalId}: ${error.message}`);
      return null;
    }
  }
});