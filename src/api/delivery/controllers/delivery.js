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
  async getPrice(ctx) {
    try {
      // Aquí estamos simulando los datos que Cabify necesita para estimar.
      // En el futuro, estos datos vendrán del pedido de tu usuario.
      const parcelData = {
        pickup_location: { lat: 4.7053, lon: -74.0688 },
        dropoff_location: { lat: 4.7053, lon: -74.0688 },
        dimensions: { height: 10, length: 10, width: 10, unit: "cm" },
        weight: { value: 1000, unit: "g" },
      };

      const resultado = await strapi
        .service("api::delivery.delivery")
        .getPriceEstimate(parcelData);

      ctx.body = { success: true, data: resultado };
    } catch (err) {
      ctx.body = { success: false, error: err.message };
    }
  },
};
