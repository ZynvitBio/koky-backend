// @ts-nocheck
'use strict';
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();
// IMPORTANTE: Asegúrate de que la ruta al archivo KiraPrompts sea la correcta
const KiraPrompts = require('./KiraPrompts'); 

const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-2.5-flash" 
}, { apiVersion: 'v1' });

module.exports = {
  async getOrCreateUser(identifier, waName, platform = 'whatsapp', avatarUrl = null, handle = null) {
    let domain = 'wa.koky';
    if (platform === 'instagram') domain = 'instagram.koky';
    if (platform === 'facebook') domain = 'facebook.koky';

    const virtualEmail = `${identifier}@${domain}`;

    let user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: {
        $or: [
          { email: virtualEmail },
          { whatsapp_id: identifier }
        ]
      }
    });

    if (!user) {
      user = await strapi.plugins['users-permissions'].services.user.add({
        username: waName,
        email: virtualEmail,
        password: 'Password123!',
        confirmed: true,
        is_founder: false,
        whatsapp_id: platform === 'whatsapp' ? identifier : null,
        avatar_url: avatarUrl,
        social_id: identifier,
        social_handle: handle 
      });
    } else {
      const updateData = {};
      if (avatarUrl && user.avatar_url !== avatarUrl) updateData.avatar_url = avatarUrl;
      if (waName && waName !== "Cliente" && user.username !== waName) updateData.username = waName;
      if (handle && user.social_handle !== handle) updateData.social_handle = handle;

      if (Object.keys(updateData).length > 0) {
        user = await strapi.entityService.update('plugin::users-permissions.user', user.id, {
          data: updateData
        });
      }
    }
    return user;
  },

  async verify(ctx) {
    const verifyToken = "me_encanta_koky"; 
    const mode = ctx.query['hub.mode'];
    const token = ctx.query['hub.verify_token'];
    const challenge = ctx.query['hub.challenge'];

    if (mode && token && mode === 'subscribe' && token === verifyToken) {
      ctx.status = 200;
      ctx.body = challenge;
    } else {
      ctx.status = 403;
    }
  },
  
  async receive(ctx) {
    const body = ctx.request.body;
    ctx.status = 200;
    ctx.body = 'EVENT_RECEIVED';

    setImmediate(async () => {
      try {
        if (body.object === 'whatsapp_business_account') {
          const entry = body.entry?.[0]?.changes?.[0]?.value;
          const message = entry?.messages?.[0];
          const contact = entry?.contacts?.[0];

          if (message) {
            const phone_number_id = entry.metadata.phone_number_id;
            const from = message.from;
            const waName = contact?.profile?.name || "Cliente Koky";
            const rawText = message.text?.body || message.button?.text || "";
            const msgText = rawText.toLowerCase().trim();

            try {
              let user = await this.getOrCreateUser(from, waName, 'whatsapp');
              const textoBotonRegistro = "registrarme aquí";

              if (msgText === textoBotonRegistro && !user.is_founder) {
                user = await strapi.entityService.update('plugin::users-permissions.user', user.id, {
                  data: { is_founder: true, whatsapp_id: from },
                });
                
                const welcomeMsg = "¡Genial! Ya eres oficialmente Miembro Fundador. ¡Bienvenido a la familia Koky! 🥦";
                
                await axios({
                  method: "POST",
                  url: `https://graph.facebook.com/v21.0/${phone_number_id}/messages`,
                  data: {
                    messaging_product: "whatsapp",
                    to: from,
                    text: { body: welcomeMsg },
                  },
                  headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
                });

                await strapi.entityService.create('api::chat.chat', {
                  data: { 
                    sender: 'Kira', 
                    message: welcomeMsg, 
                    timestamp: new Date(), 
                    publishedAt: new Date(), 
                    users_permissions_user: user.id 
                  },
                });
                if (strapi['io']) { strapi['io'].emit('new_message', { userId: user.id }); }
                
                return;
              }

              await strapi.entityService.create('api::chat.chat', {
                data: { sender: from, message: msgText, timestamp: new Date(), publishedAt: new Date(), users_permissions_user: user.id },
              });
              if (strapi['io']) { strapi['io'].emit('new_message', { userId: user.id }); }

              if (user.kira_active !== false) {
                const history = await strapi.entityService.findMany('api::chat.chat', {
                  filters: { users_permissions_user: { id: user.id } },
                  sort: { timestamp: 'desc' },
                  limit: 6,
                });

                const chatContext = history.reverse().map(h => `${h.sender === from ? 'Cliente' : 'Kira'}: ${h.message}`).join('\n');

                // USO DE KIRAPROMTS Y SCOREINFO
                const scoreInfo = { total: user.kira_score || 0 };
                const systemPrompt = KiraPrompts.PROMPT_WA(waName, user.is_founder, chatContext, msgText, scoreInfo);

                const result = await model.generateContent(systemPrompt);
                const aiResponse = result.response.text();
                let messageToSave = aiResponse;

                if (!user.is_founder && (msgText.includes("si") || msgText.includes("fundador") || msgText.includes("interesa") || msgText.includes("registro"))) {
                  messageToSave = "📋 [Invitación enviada: Plantilla de Miembro Fundador]";
                  await axios({
                    method: "POST",
                    url: `https://graph.facebook.com/v21.0/${phone_number_id}/messages`,
                    data: {
                      messaging_product: "whatsapp",
                      to: from,
                      type: "template",
                      template: {
                        name: "invitation",
                        language: { code: "es" },
                        components: [{ type: "header", parameters: [{ type: "video", video: { link: "https://storage.googleapis.com/koky_food/KiraInvitation2.5.mp4" } }] }]
                      }
                    },
                    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
                  });
                } else {
                  await axios({
                    method: "POST",
                    url: `https://graph.facebook.com/v21.0/${phone_number_id}/messages`,
                    data: {
                      messaging_product: "whatsapp",
                      to: from,
                      text: { body: aiResponse },
                    },
                    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
                  });
                }

                await strapi.entityService.create('api::chat.chat', {
                  data: { sender: 'Kira', message: messageToSave, timestamp: new Date(), publishedAt: new Date(), users_permissions_user: user.id },
                }); 
                if (strapi['io']) { strapi['io'].emit('new_message', { userId: user.id }); }
              }

            } catch (error) { console.error("❌ Error WA Internal:", error.message); }
          }
        } 
        else if (body.object === 'page' || body.object === 'instagram') {
          const entry = body.entry?.[0];
          const messaging = entry?.messaging?.[0];
          
          if (!messaging || messaging.read || messaging.delivery || messaging.message?.is_echo) return;

          const from = messaging.sender.id;
          const rawText = messaging.message?.text || messaging.postback?.title || "";
          const msgText = rawText.toLowerCase().trim();

          try {
            const plataformaKey = body.object === 'instagram' ? 'instagram' : 'facebook';
            const profile = await strapi.service('api::whatsapp.whatsapp').getUserProfile(from, plataformaKey);
            let metaName = profile?.name || "Cliente";
            const metaAvatar = profile?.avatar_url || null;
            let metaHandle = null;

            if (plataformaKey === 'instagram') {
                try {
                    const tokenSocial = process.env.MESSENGER_PAGE_TOKEN;
                    const urlUser = `https://graph.facebook.com/v21.0/${from}?fields=username&access_token=${tokenSocial}`;
                    const resUser = await axios.get(urlUser);
                    if (resUser.data && resUser.data.username) {
                        metaHandle = `@${resUser.data.username}`;
                    }
                } catch (e) { console.log("⚠️ No se pudo obtener @handle."); }
            }

            let user = await this.getOrCreateUser(from, metaName, plataformaKey, metaAvatar, metaHandle);
            const trimmedText = rawText.trim();

            if (trimmedText.startsWith('+')) {
              try {
                const phoneNumber = phoneUtil.parseAndKeepRawInput(trimmedText);
                if (phoneUtil.isValidNumber(phoneNumber)) {
                  const formattedPhone = phoneUtil.format(phoneNumber, 1);
                  if (!user.is_founder) {
                    user = await strapi.entityService.update('plugin::users-permissions.user', user.id, {
                      data: { is_founder: true, whatsapp_id: formattedPhone },
                    });
                    const confirmMsg = "¡Excelente! He vinculado tu número móvil. ¡Ya eres Miembro Fundador de Koky! 🥦";
                    await axios.post(`https://graph.facebook.com/v21.0/me/messages`,
                      { recipient: { id: from }, message: { text: confirmMsg } },
                      { headers: { Authorization: `Bearer ${process.env.MESSENGER_PAGE_TOKEN}` } }
                    );
                    await strapi.entityService.create('api::chat.chat', {
                      data: { sender: 'Kira', message: confirmMsg, timestamp: new Date(), publishedAt: new Date(), users_permissions_user: user.id },
                    });
                    if (strapi['io']) { strapi['io'].emit('new_message', { userId: user.id }); }
                    return;
                  }
                }
              } catch (e) { console.log("🚫 Error formato."); }
            }

            await strapi.entityService.create('api::chat.chat', {
              data: { sender: from, message: msgText, timestamp: new Date(), publishedAt: new Date(), users_permissions_user: user.id },
            });
            if (strapi['io']) { strapi['io'].emit('new_message', { userId: user.id }); }

            if (user.kira_active !== false) {
              const history = await strapi.entityService.findMany('api::chat.chat', {
                filters: { users_permissions_user: { id: user.id } },
                sort: { timestamp: 'desc' },
                limit: 6,
              });

              const chatContext = history.reverse().map(h => `${h.sender === from ? 'Cliente' : 'Kira'}: ${h.message}`).join('\n');

              // USO DE KIRAPROMTS PARA REDES
              const scoreInfo = { total: user.kira_score || 0 };
              const systemPrompt = KiraPrompts.PROMPT_META(user.username, user.is_founder, chatContext, msgText, scoreInfo);

              const result = await model.generateContent(systemPrompt);
              const aiResponse = result.response.text();

              await axios.post(`https://graph.facebook.com/v21.0/me/messages`,
                { recipient: { id: from }, message: { text: aiResponse } },
                { headers: { Authorization: `Bearer ${process.env.MESSENGER_PAGE_TOKEN}` } }
              );

              await strapi.entityService.create('api::chat.chat', {
                data: { sender: 'Kira', message: aiResponse, timestamp: new Date(), publishedAt: new Date(), users_permissions_user: user.id },
              });
              if (strapi['io']) { strapi['io'].emit('new_message', { userId: user.id }); }
            }

          } catch (e) { console.error("❌ Error Proceso Redes:", e.message); }
        }
      } catch (globalError) {
        console.error("❌ Error Crítico Webhook:", globalError.message);
      }
    });
  }
};