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

    // RESTAURAR LOS MENSAJES ORIGINALES DE LA PREVENTA EN LA BASE DE DATOS
    process.nextTick(async () => {
      try {
        const uid = "api::home-hero-message.home-hero-message";
        const existing = await strapi.db.query(uid).findMany({
          orderBy: { order: 'asc' }
        });

        const originalSlides = [
          {
            order: 1,
            h1Prefix: "¡Solo 30 días,",
            h1HighlightedText: "Miembro Fundador",
            h1_suffix: "!",
            subtitle: "Asegura 1 delivery GRATIS al mes DE POR VIDA.",
            description: "Sé parte de nuestra preventa exclusiva. Cupos limitados para quienes buscan el tofu más puro de Colombia.",
            linkText: "¡ASEGURAR MI CUPO!",
            linkUrl: "trigger:coming-soon"
          },
          {
            order: 2,
            h1Prefix: "Buscamos",
            h1HighlightedText: "100 Fundadores",
            h1_suffix: ".",
            subtitle: "Tofu artesanal, beneficios vitalicios.",
            description: "Queremos premiar a quienes creen en lo natural desde el inicio. Únete al club de los 100 y recibe delivery gratis mensual para siempre.",
            linkText: "RESERVAR MI LUGAR",
            linkUrl: "trigger:coming-soon"
          },
          {
            order: 3,
            h1Prefix: "Sé 1 de los",
            h1HighlightedText: "100 Elegidos",
            h1_suffix: "!",
            subtitle: "Revoluciona tu alimentación con Koky.",
            description: "Forma parte de la comunidad exclusiva que cambiará la forma de comer tofu en Colombia. Acceso VIP y sorpresas solo para fundadores.",
            linkText: "¡QUIERO SER FUNDADOR!",
            linkUrl: "trigger:coming-soon"
          }
        ];

        for (const slide of originalSlides) {
          const matched = existing.find(e => e.order === slide.order);
          if (matched) {
            await strapi.documents(uid).update({
              documentId: matched.documentId,
              data: slide
            });
            await strapi.documents(uid).publish({
              documentId: matched.documentId
            });
            strapi.log.info(`[Restaurador Slides] Restaurado slide original ${slide.order}`);
          }
        }
      } catch (err) {
        strapi.log.error(`[Restaurador Slides] Error al restaurar: ${err.message}`);
      }
    });
  },
};
