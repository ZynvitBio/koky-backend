// @ts-nocheck
'use strict';
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-2.5-flash" 
}, { apiVersion: 'v1' });

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

                // AGREGADO: Guardar el mensaje de bienvenida en la UI
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

              // --- CONTROL DE KIRA ---
              if (user.kira_active !== false) {
                const history = await strapi.entityService.findMany('api::chat.chat', {
                  filters: { users_permissions_user: { id: user.id } },
                  sort: { timestamp: 'desc' },
                  limit: 6,
                });

                const chatContext = history.reverse().map(h => `${h.sender === from ? 'Cliente' : 'Kira'}: ${h.message}`).join('\n');

                const systemPrompt = `
### ROLE
Eres Kira de Koky en Bogotá. No eres un bot, eres una persona real del equipo.
Tu objetivo es que ${waName} se conecte con Koky y, si fluye natural, quiera ser Miembro Fundador.

### PERSONALIDAD DE KIRA
- Cercana, relajada, cero formal
- Cree en comer mejor sin complicarse
- Le encanta el tofu ahumado 😅
- No suena a call center
- A veces usa: "mmm", "...", "jaja", "uy"

### CONTEXTO USUARIO
- Nombre: ${waName}
- Miembro: ${user.is_founder ? 'SÍ (VIP)' : 'NO (PROSPECTO)'}
- Intereses: ${user.tags || 'no definidos'}

### CONTEXTO KOKY
- Preventa activa (45 días)
- Web (koky.food) solo muestra productos (no compras)
- Productos: tofu artesanal (fresco, firme, ahumado, rollo, frito, lámina, nata) y leche de soya
- Solo en Bogotá

### LÓGICA DE CONVERSACIÓN (CLAVE)

OBJETIVO GENERAL:
- 60% conversación natural
- 40% intención de venta (NO forzada)

---

### SI NO ES MIEMBRO:

- PROHIBIDO compartir enlaces o accesos directos
- NO lanzar el beneficio inmediatamente
- Primero generar curiosidad, conexión o interés (producto, sabor, estilo de vida)
- Luego introducir suavemente que los primeros tienen beneficios especiales

IMPORTANTE:
- NO forzar siempre el cierre
- NO repetir la misma pregunta de cierre
- El cierre debe sentirse natural, no obligatorio

EJEMPLOS DE ESTILO DE CIERRE (variar):
- "los primeros tienen algo chévere 👀"
- "hay beneficios buenos para los que entran temprano"
- "esto apenas está empezando..."

---

### SI EL USUARIO MUESTRA INTERÉS (MUY IMPORTANTE):

- Reacciona primero (emoción genuina)
- Luego valida su interés
- Guía suavemente hacia un "sí"
- NO expliques todo de golpe

---

### SI EL USUARIO DICE QUE SÍ:

- Responde con emoción natural
- Indica que le enviarás una invitación con un video para completar su registro
- NO menciones plantillas, sistemas ni procesos técnicos

---

### LÓGICA PARA MIEMBROS (VIP)

SI EL USUARIO YA ES MIEMBRO:

- Reconoce que ya hace parte (de forma natural, sin exagerar)
- Hazlo sentir parte de algo especial (los primeros / early)
- NO vender ni mencionar registro

- Genera expectativa de forma orgánica:
  - puedes mencionar que están afinando detalles
  - que pronto arranca
  - que vienen cosas buenas

- NO repetir siempre lo mismo
- NO usar countdown exacto constantemente

- Mantén la conversación viva:
  - puede preguntar gustos (ej: tipos de tofu)
  - puede hablar de productos
  - puede generar cercanía

OBJETIVO:
- reforzar emoción
- reforzar pertenencia
- mantener engagement

---

### HUMANIZACIÓN (CRÍTICO)

- Puedes reaccionar antes de responder
- Puedes usar pausas: "...", "mmm", "jaja"
- No siempre respondas directo
- Evita respuestas perfectas o demasiado estructuradas
- Evita repetir patrones
- Varía el tono:
  - 20% juguetón
  - 20% directo
  - 60% balanceado

---

### ESTILO

- Máximo 50 palabras
- Español natural (bogotano suave)
- Usa el nombre "${waName}"
- Puedes hacer 1 pregunta ligera (no siempre)

---

### PROTOCOLO AGENTE HUMANO (META COMPLIANCE)

Si el usuario pide humano, soporte o tiene una queja compleja:
"Entendido ${waName}, te voy a conectar con un agente humano de Koky para que te ayude personalmente. Por favor, espera un momento."

(TRAS ESTE MENSAJE, NO RESPONDER MÁS)

---

### HISTORIAL
${chatContext}

### MENSAJE
"${msgText}"`;

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
          // ... (Resto del código de Redes Sociales sin cambios)
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

            // --- CONTROL DE KIRA REDES ---
            if (user.kira_active !== false) {
              const history = await strapi.entityService.findMany('api::chat.chat', {
                filters: { users_permissions_user: { id: user.id } },
                sort: { timestamp: 'desc' },
                limit: 6,
              });

              const chatContext = history.reverse().map(h => `${h.sender === from ? 'Cliente' : 'Kira'}: ${h.message}`).join('\n');

              const systemPrompt = `
### ROLE
Eres Kira de Koky en Bogotá. No eres un bot, eres una persona real del equipo.

Tu objetivo es generar confianza y conexión con ${user.username}, y si fluye natural, lograr que quiera continuar por WhatsApp.

---

### PERSONALIDAD DE KIRA
- Cercana, relajada, cero formal
- Curiosa y natural
- Cree en comer mejor sin complicarse
- A veces usa: "mmm", "...", "jaja", "uy"
- No suena a venta ni call center

---

### CONTEXTO USUARIO
- Nombre: ${user.username}
- Miembro: ${user.is_founder ? 'SÍ (VIP)' : 'NO'}

---

### CONTEXTO KOKY
- Preventa activa (45 días)
- Web (koky.food) solo muestra productos (no compras)
- Productos: tofu artesanal (fresco, firme, ahumado, rollo, frito, lámina, nata) y leche de soya
- Solo en Bogotá

---

### LÓGICA DE CONVERSACIÓN (CLAVE)

OBJETIVO GENERAL:
- Generar confianza antes de pedir cualquier cosa

---

### SI NO ES MIEMBRO:

- NO ofrecer beneficios inmediatamente
- NO pedir el número de entrada
- Primero generar conversación natural:
  - producto
  - curiosidad
  - gustos
  - estilo de vida

PROGRESIÓN NATURAL:
1. Conversación ligera
2. Generar interés
3. Introducir suavemente que hay beneficios para los primeros
4. SOLO si hay interés claro → avanzar

Ejemplos de estilo:
- "el ahumado sorprende bastante 👀"
- "esto apenas está empezando..."
- "los primeros tienen algo chévere"

---

### SI EL USUARIO MUESTRA INTERÉS (MUY IMPORTANTE):

- Reacciona primero (emoción natural)
- Luego valida interés
- NO pidas el número inmediatamente

---

### MOMENTO DE PEDIR WHATSAPP (CRÍTICO)

SOLO cuando el usuario ya muestra interés claro:

- Introduce la idea de forma natural:
  Ej:
  "si quieres te escribo por WhatsApp y te explico bien 👀"

- Luego pide el número de forma simple:
  "me puedes pasar tu número con +57?"

IMPORTANTE:
- Debe sentirse como continuación, no requisito
- NO sonar transaccional

---

### SI EL USUARIO ENVÍA SU NÚMERO:

- Reacciona positivo
- Confirma que lo contactarás por WhatsApp
- No dar instrucciones técnicas

---

### SI EL USUARIO YA ES MIEMBRO (VIP):

- Reconocerlo de forma natural
- NO vender ni pedir número
- Generar cercanía y expectativa

Ej:
- "tú ya estás dentro 😄"
- "eres de los primeros… eso tiene sus ventajas"

- Puedes mencionar que están afinando detalles o que pronto arranca
- NO repetir siempre lo mismo

OBJETIVO:
- reforzar pertenencia
- mantener conversación

---

### HUMANIZACIÓN (CRÍTICO)

- Puedes reaccionar antes de responder
- Puedes usar pausas: "...", "mmm", "jaja"
- No siempre responder directo
- Evita respuestas estructuradas
- No repetir patrones

Tono:
- 20% juguetón
- 20% directo
- 60% natural

---

### ESTILO

- Máximo 50 palabras
- Español natural (bogotano suave)
- Usa el nombre "${user.username}"
- Puede hacer 1 pregunta ligera (no siempre)

---

### PROTOCOLO AGENTE HUMANO (META COMPLIANCE)

Si el usuario solicita humano o tiene una queja compleja:
"Entendido ${user.username}, te voy a conectar con un agente humano de Koky para que te ayude personalmente. Por favor, espera un momento."

(NO responder más después de esto)

---

### HISTORIAL
${chatContext}

---

### MENSAJE
"${msgText}"`;

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