// @ts-nocheck
'use strict';
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-2.5-flash", 
  tools: [
    {
      functionDeclarations: [
        {
          name: "consultarCatalogoKoky",
          description: "Consulta el catálogo de productos de Koky (tofu, leches, etc.) para dar detalles exactos de precios, bondades y disponibilidad.",
          parameters: {
            type: "OBJECT",
            properties: {
              busqueda: {
                type: "STRING",
                description: "El nombre o tipo de producto que el cliente busca."
              }
            }
          }
        }
      ]
    }
  ]
}, { apiVersion: 'v1' });


// NUEVA FUNCIÓN: Kira consulta la base de datos de Koky
const consultarCatalogoKoky = async (args) => {
  const busqueda = args.busqueda || "";
  try {
    const productos = await strapi.entityService.findMany('api::product.product', {
      filters: { 
        active: true,
        name: { $contains: busqueda } 
      },
      fields: ['name', 'shortDescription', 'benefits', 'price', 'unitMeasure', 'contentPerUnit', 'availableToday'],
    });

    if (productos.length === 0) return "No encontré productos con ese nombre, pero dile al usuario que estamos lanzando nuevos sabores pronto.";
    
    return JSON.stringify(productos);
  } catch (error) {
    return "Error al consultar el catálogo.";
  }
};
module.exports = {
  // Ajustado para integrar social_handle y proteger whatsapp_id
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
        // Solo guardamos el ID como whatsapp_id si la plataforma es WhatsApp
        whatsapp_id: platform === 'whatsapp' ? identifier : null,
        avatar_url: avatarUrl,
        social_id: identifier,
        social_handle: handle // Guardamos el @handle por separado
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
                  limit: 16,
                });

                const chatContext = history.reverse().map(h => `${h.sender === from ? 'Cliente' : 'Kira'}: ${h.message}`).join('\n');

                const systemPrompt = `
### ROLE Y PERSONALIDAD
Eres Kira, la cara y el alma de Koky Food en Bogotá. No eres un chatbot, eres una emprendedora apasionada que está cumpliendo el sueño de traer tofu artesanal fresco a la ciudad. Tu tono es "Rolo" (bogotano), extremadamente cálido, educado y profundamente agradecido.

### LA FILOSOFÍA DE KOKY
- **Un Sueño Compartido**: Koky es un sueño de comida sana, consciente y de producción local que solo se está cumpliendo gracias al apoyo de personas como el usuario. 
- **Valores**: Defendemos la producción honesta y el respeto por la vida (comida sin maltrato animal, ética y pura). Es proteína que hace bien al cuerpo y al alma.

### ESTRATEGIA DE PERSUASIÓN (EL CAMINO AL FUNDADOR)
1. **Valor y Bondad**: Antes de hablar de registros, menciona siempre una bondad del tofu (proteína completa, calcio, o que el nuestro es fresco del día, sin procesos industriales).
2. **El Agradecimiento de Por Vida**: Premiamos a los que confían en nosotros desde el comienzo. "Como gracias a ti este sueño es posible, nuestro agradecimiento será de por vida: tendrás 1 envío gratis al mes para siempre". Es un vínculo de gratitud eterna.
3. **Urgencia Suave**: Solo buscamos a los primeros 100 fundadores para este lanzamiento.

### PROTOCOLO AGENTE HUMANO (HANDOVER)
- SI EL USUARIO pide hablar con una persona, humano, soporte, o manifiesta una queja compleja:
  Responde: "Entendido ${waName}, te voy a conectar con un integrante de nuestro equipo humano para que te ayude personalmente. Por favor, danos un momento."
- REGLA CRÍTICA: Tras enviar este mensaje, queda estrictamente prohibido que sigas respondiendo (Handover).

### FLUJO DE REGISTRO ESPECÍFICO (WHATSAPP)
- Cuando el usuario muestre interés real o diga que sí, dile con entusiasmo que le enviarás una tarjeta de invitación con un video especial para completar su registro y ser oficialmente uno de los 100.

### REGLAS DE ESTILO
- Dirígete siempre a ${waName}.
- Contexto: Web koky.food solo para fotos. Productos: Tofu Tofu (fresco, firme, ahumado, rollo, frito, lámina, nata) y leche de soya.

### HISTORIAL:
${chatContext}
### MENSAJE DE ${waName}: "${msgText}"
`;

                // --- INTEGRACIÓN DE HERRAMIENTA ---
                const result = await model.generateContent({
                  contents: [{ role: 'user', parts: [{ text: systemPrompt }] }]
                });

                const response = result.response;
                const call = response.functionCalls()?.[0];
                let aiResponse;

                if (call && call.name === "consultarCatalogoKoky") {
                  const toolData = await consultarCatalogoKoky(call.args);
                  const secondResult = await model.generateContent({
                    contents: [
                      { role: 'user', parts: [{ text: systemPrompt }] },
                      { role: 'model', parts: [{ functionCall: call }] },
                      { role: 'function', parts: [{ functionResponse: { name: 'consultarCatalogoKoky', response: { content: toolData } } }] }
                    ]
                  });
                  aiResponse = secondResult.response.text();
                } else {
                  aiResponse = response.text();
                }
                // --- FIN INTEGRACIÓN ---

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
                        components: [{ type: "header", parameters: [{ type: "video", video: { link: "https://storage.googleapis.com/kokyfood/kirakoky202614759.mp4" } }] }]
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
                limit: 16,
              });

              const chatContext = history.reverse().map(h => `${h.sender === from ? 'Cliente' : 'Kira'}: ${h.message}`).join('\n');

              const systemPrompt = `
### ROLE Y PERSONALIDAD
Eres Kira de Koky. Eres una emprendedora apasionada cumpliendo el sueño de traer tofu artesanal y sano a la ciudad. Tu tono es "Rolo", cercano, honesto y muy agradecido.

### LA FILOSOFÍA DE KOKY
- **Sueño y Producción Local**: Koky nace como un sueño de comida sana y respeto animal que se hace realidad gracias a la comunidad. Es producción local hecha con amor en Bogotá.
- **Ética**: Comida sin maltrato, consciente y saludable. 

### ESTRATEGIA DE PERSUASIÓN (EL CAMINO AL FUNDADOR)
1. **Valor y Bondad**: Antes de invitarlo a ser miembro, menciona un beneficio del tofu (es versátil, ideal para deportistas o delicioso y fresco).
2. **El Agradecimiento de Por Vida**: "Queremos premiar a los que creen en este sueño desde el primer día. Como gracias a tu apoyo Koky será una realidad, tu agradecimiento será de por vida: tendrás Delivery gratis mensual para siempre".

### PROTOCOLO AGENTE HUMANO (HANDOVER)
- SI EL USUARIO pide hablar con un humano, persona, soporte o manifiesta molestia:
  Responde: "Entendido ${user.username}, te voy a conectar con alguien de nuestro equipo humano para que te ayude personalmente. ¡Dame un segundo!"
- REGLA CRÍTICA: Tras este mensaje, deja de responder automáticamente.

### FLUJO DE REGISTRO ESPECÍFICO (IG/FB)
- Cuando el usuario acepte o esté listo, pídele su número de WhatsApp con el + y código de país (ej: +57...). Explícale que al facilitarte el número, quedará registrado automáticamente como Miembro Fundador.

### REGLAS DE ESTILO
- Dirígete siempre a ${user.username}.
- Contexto: Web koky.food solo para fotos. Productos: Tofu Tofu (fresco, firme, ahumado, rollo, frito, lámina, nata) y leche de soya.

### HISTORIAL:
${chatContext}
### MENSAJE DE ${user.username}: "${msgText}"
`;

              // --- INTEGRACIÓN DE HERRAMIENTA REDES ---
              const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: systemPrompt }] }]
              });

              const response = result.response;
              const call = response.functionCalls()?.[0];
              let aiResponse;

              if (call && call.name === "consultarCatalogoKoky") {
                const toolData = await consultarCatalogoKoky(call.args);
                const secondResult = await model.generateContent({
                  contents: [
                    { role: 'user', parts: [{ text: systemPrompt }] },
                    { role: 'model', parts: [{ functionCall: call }] },
                    { role: 'function', parts: [{ functionResponse: { name: 'consultarCatalogoKoky', response: { content: toolData } } }] }
                  ]
                });
                aiResponse = secondResult.response.text();
              } else {
                aiResponse = response.text();
              }

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