'use strict';
const axios = require('axios');

module.exports = ({ strapi }) => ({
  // 1. ENVÍO WHATSAPP (Intacto y Seguro)
  async sendText(to, message) {
    const accessToken = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = "1037050959491352"; 
    const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;

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
      return response.data;
    } catch (error) {
      console.error("❌ [Servicio WA] Error:", error.response ? error.response.data : error.message);
      throw error;
    }
  },

  // 2. ENVÍO INSTAGRAM/FACEBOOK (Configurado para el Token de Redes)
  async sendDirectMessage(recipientId, message) {
    const accessToken = process.env.MESSENGER_PAGE_TOKEN;
    const url = `https://graph.facebook.com/v21.0/me/messages`;

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
      return response.data;
    } catch (error) {
      console.error("❌ [Servicio Social] Error:", error.response ? error.response.data : error.message);
      throw error;
    }
  },

  // 3. CAPTURA DE PERFIL (La clave para el video y la BD)
  async getUserProfile(externalId, platform) {
    try {
      // Si es WhatsApp, retorno inmediato (Principio de Privacidad/Velocidad)
      if (platform === 'whatsapp') return null;

      const igToken = process.env.MESSENGER_PAGE_TOKEN; 
      
      // Usamos los campos que confirmamos en el log: 'name' y 'profile_pic'
      // Bajamos a v21.0 para total compatibilidad
      let urlSocial = `https://graph.facebook.com/v21.0/${externalId}?fields=name,profile_pic&access_token=${igToken}`;
      
      const responseSocial = await axios.get(urlSocial);
      
      // Retornamos el objeto mapeado exactamente a lo que espera tu BD
      return {
        name: responseSocial.data.name || null,
        avatar_url: responseSocial.data.profile_pic || null
      };

    } catch (error) {
      // Fallo silencioso: Si Meta falla, Kira sigue viva (Principio de Estabilidad)
      console.log(`⚠️ [SERVICIO SOCIAL] No se pudo obtener perfil para ${externalId}: ${error.message}`);
      return null;
    }
  }
});