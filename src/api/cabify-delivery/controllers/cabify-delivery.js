// @ts-nocheck
"use strict";

module.exports = {
  // 1. Corregido el servicio a 'api::cabify-delivery.cabify-delivery'
  async testConnection(ctx) {
    try {
      const result = await strapi
        .service("api::cabify-delivery.cabify-delivery")
        .testConnection();
      ctx.body = result;
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },

  // 2. Corregida la lógica de ejecución (faltaba el 'await' y el servicio estaba mal estructurado)
  async testEstimate(ctx) {
    try {
      const resultado = await strapi
        .service("api::cabify-delivery.cabify-delivery")
        .testMyParcel();
      ctx.body = { success: true, data: resultado };
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },

  // 3. Corregido el servicio
  async testCreateShipment(ctx) {
    try {
      const result = await strapi
        .service("api::cabify-delivery.cabify-delivery")
        .testCreateShipment();
      ctx.body = result;
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },

  // 4. Corregido el servicio
  async getPrice(ctx) {
    try {
      const parcelData = {
        pickup_location: { lat: 4.6976, lon: -74.0617 }, // Coordenadas KOKY (Calle 119a 57-40)
        dropoff_location: { lat: 4.7053, lon: -74.0688 },
        dimensions: { height: 10, length: 10, width: 10, unit: "cm" },
        weight: { value: 1000, unit: "g" },
      };

      const resultado = await strapi
        .service("api::cabify-delivery.cabify-delivery")
        .getPriceEstimate(parcelData);

      ctx.body = { success: true, data: resultado };
    } catch (err) {
      ctx.status = 500;
      ctx.body = { success: false, error: err.message };
    }
  },
};
