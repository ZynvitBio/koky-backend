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
  },
};
