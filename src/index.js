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

    // 3. SEED INITIAL GOOGLE REVIEWS IF EMPTY
    process.nextTick(async () => {
      try {
        const count = await strapi.documents('api::google-review.google-review').count({
          status: 'published'
        });
        
        if (count === 0) {
          strapi.log.info('🌱 No google reviews found. Seeding initial 4 reviews...');
          const initialReviews = [
            {
              author: 'Sara Arias',
              comment: 'Brutal el tofu ahumado de Kökÿ! Textura firme, sabor increíble y la proteína limpia perfecta para recuperarme después de entrenar.',
              rating: 5,
              relative_time: 'Hace unos días',
              avatar_color: '#EA4335',
              avatar_initials: 'SA',
              featured: true,
              publishedAt: new Date()
            },
            {
              author: 'Camila Isabel Abonce Giraldo',
              comment: 'Siempre le había tenido pereza al tofu artesanal porque los que probaba antes me quedaban simples o con una textura extraña. Pero el de Koky Food es otra cosa. Súper fresco, con la consistencia perfecta y delicioso. ¡Se nota la diferencia desde el primer bocado!',
              rating: 5,
              relative_time: 'Hace unos días',
              avatar_color: '#FBBC05',
              avatar_initials: 'CA',
              featured: true,
              publishedAt: new Date()
            },
            {
              author: 'Carlos Caripe',
              comment: 'El tofu es muy fresco y fácil de preparar.',
              rating: 5,
              relative_time: 'Hace unos días',
              avatar_color: '#34A853',
              avatar_initials: 'CC',
              featured: true,
              publishedAt: new Date()
            },
            {
              author: 'Asoonaz Etransfer',
              comment: 'Buen tofu. El servicio de entrega en Bogotá fue de diez.',
              rating: 5,
              relative_time: 'Hace unos días',
              avatar_color: '#4285F4',
              avatar_initials: 'AE',
              featured: true,
              publishedAt: new Date()
            }
          ];

          for (const review of initialReviews) {
            await strapi.documents('api::google-review.google-review').create({
              data: review,
              status: 'published'
            });
          }
          strapi.log.info('🌱 Successfully seeded 4 google reviews.');
        }
      } catch (err) {
        strapi.log.error('❌ Error seeding google reviews:', err.message);
      }
    });

    // 4. SEED INITIAL FAQS IF EMPTY
    process.nextTick(async () => {
      try {
        const count = await strapi.documents('api::faq.faq').count({
          status: 'published'
        });
        
        if (count === 0) {
          strapi.log.info('🌱 No FAQs found. Seeding initial FAQs...');
          const initialFaqs = [
            {
              topic: 'Duración y conservación del tofu',
              information: 'Nuestro tofu es súper fresco y artesanal (sin conservantes). Para que te dure fresco hasta por 5 días, debes guardarlo en la nevera sumergido en agua limpia dentro de un recipiente cerrado. ¡Es muy importante que le cambies el agua todos los días!',
              active: true,
              publishedAt: new Date()
            },
            {
              topic: 'Contenido de proteína de los tofus y leche de soya',
              information: 'Aquí tienes el contenido de proteína de nuestros productos artesanales por cada 100g:\n- Tofu Firme: 15g de proteína por cada 100g.\n- Tofu Semiduro: 12g de proteína por cada 100g.\n- Tofú Seco Ahumado: 16g de proteína por cada 100g.\n- Tofú Hoja: 18g de proteína por cada 100g.\n- Nata de Soya (Yuba): 22g de proteína por cada 100g.\n- Leche de Soya: 4g de proteína por cada 100ml.\nTodos nuestros productos son 100% de origen vegetal, libres de gluten, lactosa y conservantes.',
              active: true,
              publishedAt: new Date()
            }
          ];

          for (const faq of initialFaqs) {
            await strapi.documents('api::faq.faq').create({
              data: faq,
              status: 'published'
            });
          }
          strapi.log.info('🌱 Successfully seeded initial FAQs.');
        }
      } catch (err) {
        strapi.log.error('❌ Error seeding FAQs:', err.message);
      }
    });

  },
};
