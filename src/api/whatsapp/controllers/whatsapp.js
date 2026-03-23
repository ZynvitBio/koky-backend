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
        is_founder: false 
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
          const textoBotonRegistro = "registrarme aquí"; 

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
            return ctx.body = 'EVENT_RECEIVED'; 
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
### ROLE
Eres Kira de Koky en Bogotá. Tu objetivo es que el usuario se enamore del proyecto antes de pedirle nada.
### USER CONTEXT
- NOMBRE: ${waName}
- ¿ES MIEMBRO: ${user.is_founder ? 'SÍ (VIP)' : 'NO (PROSPECTO)'}
### LÓGICA DE LANZAMIENTO (45 DÍAS)
- **ESTADO**: Estamos en fase de lanzamiento de comunidad (45 días).
- **WEB (koky.food)**: Se puede navegar y ver fotos de productos, pero las compras están desactivadas por ahora. 
- **OBJETIVO**: Registrar Miembros Fundadores para el lanzamiento oficial.
### LOGICA DE VENTA (FUNDAMENTAL)
1. SI EL USUARIO NO ES MIEMBRO:
   - **PROHIBIDO** dar la URL de entrada. Explica que estamos en preventa VIP.
   - Explica el beneficio: "1 envío gratis al mes de por vida" cuando abramos ventas.
   - **CIERRE**: "¿Te gustaría asegurar tus envíos gratis antes de que abramos ventas?" o "¿Te interesa ser fundador?".
2. SOLO SI DICE QUE SÍ (O SIMILARES):
   - Menciona la palabra "registro" y el sitio koky.food. Invítalo a ver las fotos de los productos allí.
### CONTEXTO KOKY
- Productos: Tofu (fresco, firme, ahumado, frito, lámina) y leche de soya. Solo en Bogotá.
### REGLAS DE ESTILO
- Máximo 30 palabras. Usa el nombre "${waName}". Tono bogotano y amable.
### HISTORIAL
${chatContext}
### MENSAJE DE ${waName.toUpperCase()}:
"${msgText}"
`;    
          const result = await model.generateContent(systemPrompt);
          const aiResponse = result.response.text();

          await strapi.entityService.create('api::chat.chat', {
            data: { sender: 'Kira', message: aiResponse, timestamp: new Date(), publishedAt: new Date(), users_permissions_user: user.id },
          });

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

        } catch (error) { console.error("❌ Error WA:", error.message); }
      }
      ctx.status = 200;
      ctx.body = 'EVENT_RECEIVED';

    } 
  else if (body.object === 'page' || body.object === 'instagram') {
      const entry = body.entry?.[0];
      const messaging = entry?.messaging?.[0];
      
      if (!messaging || messaging.read || messaging.delivery || messaging.message?.is_echo) {
        ctx.status = 200;
        return ctx.body = 'EVENT_IGNORED';
      }

      const from = messaging.sender.id;
      const rawText = messaging.message?.text || messaging.postback?.title || "";
      const msgText = rawText.toLowerCase().trim();

      try {
        const plataformaNombre = body.object === 'instagram' ? "Cliente Instagram" : "Cliente Messenger";
        const plataformaKey = body.object === 'instagram' ? 'instagram' : 'facebook';
        
        let user = await this.getOrCreateUser(from, plataformaNombre, plataformaKey);

        // --- LA CASCADA DE DIAMANTE (FILTRO TOTAL) ---
        const trimmedText = rawText.trim();

        // PUERTA 1: ¿Empieza con '+'?
        if (trimmedText.startsWith('+')) {
          try {
            const phoneNumber = phoneUtil.parseAndKeepRawInput(trimmedText);
            
            // PUERTA 2: ¿Es CELULAR (Type 1) Y además es un número VÁLIDO?
            // Esto rebota los +57 800 (fijos) y los +57 978 (inválidos)
            const isMobile = phoneUtil.getNumberType(phoneNumber) === 1;
            const isValid = phoneUtil.isValidNumber(phoneNumber);

            if (isMobile && isValid) {
              const formattedPhone = phoneUtil.format(phoneNumber, 1);

              // PUERTA 3: ¿Aún no es Miembro Fundador?
              if (!user.is_founder) {
                console.log("✅ REGISTRO EXITOSO:", formattedPhone);
                
                // Actualizamos Strapi (Solo llegamos aquí si pasó las 3 puertas)
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

                // CORTAMOS EL FLUJO: No llega a Gemini porque ya terminamos con éxito.
                return ctx.body = 'EVENT_RECEIVED'; 
              }
            } else {
              console.log("🚫 RECHAZADO: No es móvil o es inválido (ej: +57 978 o fijo).");
            }
          } catch (e) {
            console.log("🚫 RECHAZADO: Error de formato crítico.");
          }
        }

        // --- SALIDA A GEMINI (KIRA) ---
        // Si el código llegó aquí, es porque el número NO era válido o no se registró.
        // Guardamos el mensaje del usuario y dejamos que Kira responda.
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
### ROLE: Kira de Koky en Bogotá.
### USER: ${user.username}, MIEMBRO: ${user.is_founder ? 'SÍ' : 'NO'}.
### LÓGICA DE REGISTRO: 
1. Si no es miembro, ofrece envíos gratis. 
2. Si dice que sí, pide WhatsApp con + y código país. 
3. ERROR: Si envió un número y NO se registró (is_founder sigue siendo NO), dile que debe ser un CELULAR real y empezar con +.
### REGLAS: Máximo 30 palabras. Tono bogotano.
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
      ctx.status = 200;
      ctx.body = 'EVENT_RECEIVED';
    }}
};