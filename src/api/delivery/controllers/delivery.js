// @ts-nocheck
"use strict";

module.exports = {
  // Esta es la función que te está dando error
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

  // La que vamos a probar
  async testEstimate(ctx) {
    try {
      const resultado = await strapi
        .service("api::delivery.delivery")
        .testMyParcel(); // Asegurado con el nombre correcto del servicio
      ctx.body = { success: true, data: resultado };
    } catch (err) {
      ctx.body = { success: false, error: err.message };
    }
  },

  // Agrega también testCreateShipment si lo necesitas
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
