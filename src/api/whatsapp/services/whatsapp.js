'use strict';
const axios = require('axios');

module.exports = ({ strapi }) => ({
  /**
   * Envía un mensaje de texto plano a través de WhatsApp Business API
   */
  async sendText(to, message) {
    const accessToken = process.env.WHATSAPP_TOKEN;
    // El ID de tu captura de pantalla de Meta
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
          text: {
            preview_url: false,
            body: message
          }
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

  /**
   * Envía un mensaje directo a través de Instagram o Facebook Messenger
   */
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
  }
});