// @ts-nocheck
"use strict";

module.exports = {
  // Función que ya tenías para probar la conexión
  async testConnection(ctx) {
    try {
      const result = await strapi
        .service("api::delivery.delivery")
        .testConnection();
      ctx.body = result;
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },

  // Nueva función para probar la creación de un envío
  async testCreateShipment(ctx) {
    try {
      const result = await strapi
        .service("api::delivery.delivery")
        .testCreateShipment();
      ctx.body = result;
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },
};
