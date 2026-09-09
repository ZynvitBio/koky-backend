// @ts-nocheck
'use strict';
const axios = require('axios');

let cachedPageToken = null;

async function getPageAccessToken() {
  if (cachedPageToken) return cachedPageToken;
  const sysToken = process.env.MESSENGER_PAGE_TOKEN;
  try {
    const res = await axios.get(`https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token&access_token=${sysToken}`);
    if (res.data && res.data.data && res.data.data.length > 0) {
      cachedPageToken = res.data.data[0].access_token;
      return cachedPageToken;
    }
  } catch (e) {
    console.error("[Servicio Social] Error obteniendo Page Token:", e.response ? e.response.data : e.message);
  }
  return sysToken;
}

module.exports = ({ strapi }) => ({
  // 1. ENVIO WHATSAPP (Intacto y Seguro)
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
      console.error("[Servicio WA] Error:", error.response ? error.response.data : error.message);
      throw error;
    }
  },

  async sendMedia(to, mediaUrl, mimeType, filename) {
    const accessToken = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = "1037050959491352"; 
    const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;

    // Clasificar tipo de archivo
    const isImage = mimeType && mimeType.startsWith('image/');
    const type = isImage ? 'image' : 'document';
    
    const mediaPayload = isImage 
      ? { link: mediaUrl }
      : { link: mediaUrl, filename: filename || 'documento' };

    try {
      const response = await axios({
        method: "POST",
        url: url,
        data: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: to,
          type: type,
          [type]: mediaPayload
        },
        headers: { 
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
      });
      return response.data;
    } catch (error) {
      console.error(`[Servicio WA] Error enviando media (${type}):`, error.response ? error.response.data : error.message);
      throw error;
    }
  },

  // 2. ENVIO INSTAGRAM/FACEBOOK DIRECT MESSAGE
  async sendDirectMessage(recipientId, message) {
    const accessToken = await getPageAccessToken();
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
      console.error("[Servicio Social] Error:", error.response ? error.response.data : error.message);
      throw error;
    }
  },

  // 3. CAPTURA DE PERFIL
  async getUserProfile(externalId, platform) {
    try {
      if (platform === 'whatsapp') return null;

      const igToken = await getPageAccessToken();
      const urlSocial = `https://graph.facebook.com/v21.0/${externalId}?fields=name,profile_pic&access_token=${igToken}`;
      const responseSocial = await axios.get(urlSocial);
      
      return {
        name: responseSocial.data.name || null,
        avatar_url: responseSocial.data.profile_pic || null
      };

    } catch (error) {
      console.log(`[Servicio Social] No se pudo obtener perfil para ${externalId}: ${error.message}`);
      return null;
    }
  },

  // 4. RESPUESTA PRIVADA A UN COMENTARIO DE INSTAGRAM (COMMENT-TO-DM)
  async replyCommentPrivate(commentId, message) {
    const accessToken = await getPageAccessToken();
    const url = `https://graph.facebook.com/v21.0/me/messages`;

    try {
      const response = await axios.post(
        url,
        {
          recipient: { comment_id: commentId },
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
      console.error("[Servicio Social - Reply Private] Error:", error.response ? error.response.data : error.message);
      throw error;
    }
  },

  // 5. RESPUESTA PUBLICA EN EL HILO DEL COMENTARIO DE INSTAGRAM
  async replyCommentPublic(commentId, message) {
    const accessToken = await getPageAccessToken();
    const url = `https://graph.facebook.com/v21.0/${commentId}/replies`;

    try {
      const response = await axios.post(
        url,
        { message },
        {
          headers: { 
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      return response.data;
    } catch (error) {
      console.error("[Servicio Social - Reply Public] Error:", error.response ? error.response.data : error.message);
      throw error;
    }
  }
});