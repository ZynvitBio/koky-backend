'use strict';
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-2.5-flash" 
}, { apiVersion: 'v1' });

module.exports = {
  async getOrCreateUser(identifier, waName, platform = 'whatsapp') {
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
        whatsapp_id: identifier
      });
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

    // 1. RESPUESTA INMEDIATA A META (EVITA DUPLICADOS)
    ctx.status = 200;
    ctx.body = 'EVENT_RECEIVED';

    // 2. PROCESAMIENTO EN SEGUNDO PLANO USANDO SETIMMEDIATE
    setImmediate(async () => {
      try {
        // --- BLOQUE WHATSAPP ---
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
              // SI EL ID ESTÁ EN BLANCO EN LA BD, LO REPARAMOS AQUÍ MISMO
          if (!user.whatsapp_id) {
            user = await strapi.entityService.update('plugin::users-permissions.user', user.id, {
              data: { whatsapp_id: from }
            });
          }
              const textoBotonRegistro = "registrarme aquí";

              // 1. LÓGICA DE REGISTRO EXITOSO
              if (msgText === textoBotonRegistro && !user.is_founder) {
                user = await strapi.entityService.update('plugin::users-permissions.user', user.id, {
                  data: { is_founder: true, whatsapp_id: from },
                });
                await axios({
                  method: "POST",
                  url: `https://graph.facebook.com/v21.0/${phone_number_id}/messages`,
                  data: {
                    messaging_product: "whatsapp",
                    to: from,
                    text: { body: "¡Genial! Ya eres oficialmente Miembro Fundador. ¡Bienvenido a la familia Koky! 🥦" },
                  },
                  headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
                });
                return; // Finaliza este proceso asíncrono
              }

              // 2. GUARDAR MENSAJE Y CARGAR HISTORIAL
              await strapi.entityService.create('api::chat.chat', {
                data: { sender: from, message: msgText, timestamp: new Date(), publishedAt: new Date(), users_permissions_user: user.id },
              });

              const history = await strapi.entityService.findMany('api::chat.chat', {
                filters: { users_permissions_user: { id: user.id } },
                sort: { timestamp: 'desc' },
                limit: 6,
              });

              const chatContext = history.reverse().map(h => `${h.sender === from ? 'Cliente' : 'Kira'}: ${h.message}`).join('\n');

              // 3. GENERAR RESPUESTA CON GEMINI (PROMPT ORIGINAL)
              const systemPrompt = `
### ROLE
Eres Kira de Koky en Bogotá. Tu objetivo es que el usuario se enamore del proyecto antes de pedirle nada.
### USER CONTEXT
- NOMBRE: ${waName}
- ¿ES MIEMBRO: ${user.is_founder ? 'SÍ (VIP)' : 'NO (PROSPECTO)'}
### LÓGICA DE LANZAMIENTO (45 DÍAS)
- **ESTADO**: Fase de lanzamiento (45 días).
- **WEB (koky.food)**: Solo para ver fotos. Compras desactivadas.
### LOGICA DE VENTA (FUNDAMENTAL)
1. SI EL USUARIO NO ES MIEMBRO:
   - **PROHIBIDO** dar la URL de entrada. Explica la preventa VIP.
   - Beneficio: "1 envío gratis al mes de por vida".
   - **CIERRE CRÍTICO**: Debes preguntar "¿Te interesa ser Miembro Fundador?" o "¿Quieres asegurar tus envíos gratis?".
2. SI DICE QUE SÍ:
   - Dile que le enviarás una tarjeta de invitación con un video para completar su registro.
### CONTEXTO KOKY
- Productos: Tofu (fresco, firme, ahumado, rollo, frito, lámina, nata) y leche de soya. Solo en Bogotá.
### REGLAS DE ESTILO
- Máximo 30 palabras. Tono bogotano amable. Usa el nombre "${waName}".

### PROTOCOLO AGENTE HUMANO (META COMPLIANCE)
- SI EL USUARIO pide hablar con una persona, humano, soporte, o manifiesta una queja que no puedes resolver: 
  Responde: "Entendido ${waName}, te voy a conectar con un agente humano de Koky para que te ayude personalmente. Por favor, espera un momento."
- TRAS ESTE MENSAJE, QUEDA PROHIBIDO QUE SIGAS RESPONDIENDO (Handover).

### HISTORIAL
${chatContext}
### MENSAJE: "${msgText}"`;

              const result = await model.generateContent(systemPrompt);
              const aiResponse = result.response.text();

              // Guardamos la respuesta de Kira en la BD
              await strapi.entityService.create('api::chat.chat', {
                data: { sender: 'Kira', message: aiResponse, timestamp: new Date(), publishedAt: new Date(), users_permissions_user: user.id },
              });

              // 4. DECIDIR SI ENVIAMOS PLANTILLA DE VIDEO O SOLO TEXTO
              if (!user.is_founder && (msgText.includes("si") || msgText.includes("fundador") || msgText.includes("interesa") || msgText.includes("registro"))) {
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

            } catch (error) { console.error("❌ Error WA Internal:", error.message); }
          }
        } 
        // --- BLOQUE INSTAGRAM / MESSENGER ---
        else if (body.object === 'page' || body.object === 'instagram') {
          const entry = body.entry?.[0];
          const messaging = entry?.messaging?.[0];
          
          if (!messaging || messaging.read || messaging.delivery || messaging.message?.is_echo) return;

          const from = messaging.sender.id;
          const rawText = messaging.message?.text || messaging.postback?.title || "";
          const msgText = rawText.toLowerCase().trim();

          try {
            const plataformaKey = body.object === 'instagram' ? 'instagram' : 'facebook';
            let user = await this.getOrCreateUser(from, "Cliente", plataformaKey);

            const trimmedText = rawText.trim();

            if (trimmedText.startsWith('+')) {
              try {
                const phoneNumber = phoneUtil.parseAndKeepRawInput(trimmedText);
                const isMobile = phoneUtil.getNumberType(phoneNumber) === 1;
                const isValid = phoneUtil.isValidNumber(phoneNumber);

                if (isMobile && isValid) {
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
                    return;
                  }
                }
              } catch (e) { console.log("🚫 Error formato."); }
            }

            await strapi.entityService.create('api::chat.chat', {
              data: { sender: from, message: msgText, timestamp: new Date(), publishedAt: new Date(), users_permissions_user: user.id },
            });

            const history = await strapi.entityService.findMany('api::chat.chat', {
              filters: { users_permissions_user: { id: user.id } },
              sort: { timestamp: 'desc' },
              limit: 6,
            });

            const chatContext = history.reverse().map(h => `${h.sender === from ? 'Cliente' : 'Kira'}: ${h.message}`).join('\n');

            const systemPrompt = `
### ROLE: Kira de Koky en Bogotá (Lanzamiento 45 días).
### USER: ${user.username}, MIEMBRO: ${user.is_founder ? 'SÍ' : 'NO'}.
### CONTEXTO: Preventa VIP. Web koky.food solo para ver fotos, compras desactivadas.
### LÓGICA DE REGISTRO (FUNDAMENTAL): 
1. SI NO ES MIEMBRO: Ofrece "1 envío gratis al mes de por vida". 
2. SI DICE QUE SÍ: Pide su WhatsApp con + y código país (ej: +57...).
3. ERROR: Si mandó un número pero NO se registró (is_founder: NO), dile que debe ser CELULAR real y empezar con +.
### PRODUCTOS: Tofu (fresco, firme, ahumado, rollo, frito, lámina, nata) y leche de soya.
### REGLAS: Máximo 30 palabras. Tono bogotano amable.

### PROTOCOLO AGENTE HUMANO (META COMPLIANCE)
- SI EL USUARIO solicita hablar con una persona, humano, soporte o manifiesta una queja compleja: 
  Responde: "Entendido ${user.username}, te voy a conectar con un agente humano de Koky para que te ayude personalmente. Por favor, espera un momento."
- TRAS ESTE MENSAJE, QUEDA PROHIBIDO QUE SIGAS RESPONDIENDO (Handover).

### HISTORIAL:
${chatContext}
### MENSAJE: "${msgText}"`;

            const result = await model.generateContent(systemPrompt);
            const aiResponse = result.response.text();

            await axios.post(`https://graph.facebook.com/v21.0/me/messages`,
              { recipient: { id: from }, message: { text: aiResponse } },
              { headers: { Authorization: `Bearer ${process.env.MESSENGER_PAGE_TOKEN}` } }
            );

            await strapi.entityService.create('api::chat.chat', {
              data: { sender: 'Kira', message: aiResponse, timestamp: new Date(), publishedAt: new Date(), users_permissions_user: user.id },
            });

          } catch (e) { console.error("❌ Error Proceso Redes:", e.message); }
        }
      } catch (globalError) {
        console.error("❌ Error Crítico Webhook:", globalError.message);
      }
    });
  }
};