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
      // Mantenemos los tokens para que IG/FB sigan funcionando
      const waToken = process.env.WHATSAPP_TOKEN; 
      const igToken = process.env.MESSENGER_PAGE_TOKEN; 

      // LIMPIEZA: Si es WhatsApp, ya sabemos que Meta no da la foto.
      // Retornamos null de inmediato para evitar el Error 400 y ahorrar recursos.
      if (platform === 'whatsapp') {
        return null; 
      }

      // INTACTO: Instagram y Facebook siguen intentando traer la foto
      // porque sus APIs sí lo permiten.
      let urlSocial = `https://graph.facebook.com/v19.0/${externalId}?fields=profile_picture_url&access_token=${igToken || waToken}`;
      const responseSocial = await axios.get(urlSocial);
      
      return {
        profile_picture_url: responseSocial.data.profile_picture_url || null
      };

    } catch (error) {
      // Si falla en IG/FB, simplemente no ponemos foto, pero no rompemos el flujo
      console.log(`--- [SERVICIO SOCIAL] No se pudo obtener avatar para ${externalId}`);
      return null;
    }
  }
});