'use strict';

module.exports = {
  register(/*{ strapi }*/) {},

  bootstrap({ strapi }) {
    // 1. MANTENEMOS TUS CONFIGURACIONES ACTUALES (No tocar)
    strapi.contentType('plugin::users-permissions.user').attributes.whatsapp_id.configurable = true;
    strapi.contentType('plugin::users-permissions.user').attributes.is_founder.configurable = true;

    // 2. AGREGAMOS EL MOTOR DE SOCKETS PARA EL OMNICHANNEL
    const { Server } = require('socket.io');

    // Usamos process.nextTick para asegurar que el servidor HTTP ya inició
    process.nextTick(() => {
      const io = new Server(strapi.server.httpServer, {
        cors: {
          origin: "*",
          methods: ["GET", "POST"],
          credentials: true
        }
      });

      strapi.io = io;

      io.on('connection', (socket) => {
        console.log('✅ Dashboard Koky conectado (Socket ID):', socket.id);
        socket.on('disconnect', () => {
          console.log('❌ Dashboard Koky desconectado');
        });
      });
    });

    // 3. ACTUALIZAR AUTOMÁTICAMENTE LOS SLIDES DEL HERO DE LA WEB (VENTAS ABIERTAS)
    process.nextTick(async () => {
      try {
        const uid = "api::home-hero-message.home-hero-message";
        const existing = await strapi.db.query(uid).findMany({
          orderBy: { order: 'asc' }
        });

        const newSlides = [
          {
            order: 1,
            h1Prefix: "El tofu artesanal",
            h1HighlightedText: "más fresco",
            h1_suffix: " de Bogotá",
            subtitle: "Elaborado a mano cada noche bajo pedido.",
            description: "Disfruta de un tofu premium, 100% natural y sin conservantes. Haz tu pedido hoy antes de las 4 p.m. y recíbelo fresco mañana.",
            linkText: "VER PRODUCTOS",
            linkUrl: "#product"
          },
          {
            order: 2,
            h1Prefix: "Como una",
            h1HighlightedText: "panadería de tofu",
            h1_suffix: ".",
            subtitle: "Tofu recién hecho directo a tu mesa.",
            description: "No almacenamos stock. Cada pieza de tofu que compras se prepara de forma artesanal durante la noche para entregártela fresquísima al día siguiente.",
            linkText: "COMPRAR AHORA",
            linkUrl: "#product"
          },
          {
            order: 3,
            h1Prefix: "Prueba nuestra",
            h1HighlightedText: "leche de soya",
            h1_suffix: " cremosa!",
            subtitle: "100% pura, natural y libre de aditivos.",
            description: "El complemento perfecto para tus desayunos, batidos o café. Una bebida vegetal ultra fresca, nutritiva y con el sabor auténtico de Koky Food.",
            linkText: "VER CATÁLOGO",
            linkUrl: "#product"
          }
        ];

        for (const slide of newSlides) {
          const matched = existing.find(e => e.order === slide.order);
          if (matched) {
            await strapi.documents(uid).update({
              documentId: matched.documentId,
              data: slide
            });
            await strapi.documents(uid).publish({
              documentId: matched.documentId
            });
            strapi.log.info(`[Bootstrap Slide Seed] Actualizado slide ${slide.order}`);
          } else {
            const created = await strapi.documents(uid).create({
              data: slide
            });
            await strapi.documents(uid).publish({
              documentId: created.documentId
            });
            strapi.log.info(`[Bootstrap Slide Seed] Creado slide ${slide.order}`);
          }
        }
      } catch (err) {
        strapi.log.error(`[Bootstrap Slide Seed] Error al actualizar slides: ${err.message}`);
      }
    });
  },
};
